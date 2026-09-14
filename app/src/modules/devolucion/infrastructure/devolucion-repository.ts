/**
 * Devolucion repository — the ONLY place in the devolucion module that touches
 * Prisma (besides the inventario seam, design D5, which owns the stock effect).
 *
 * Tenant isolation (frozen ERD v4.7, RLS already enable+FORCE on NOTA_CREDITO /
 * DETALLE_NOTA_CREDITO): every read/write pins `empresaId` (+ `sucursalId`)
 * in the Prisma `where` AND runs inside `withTenantTransaction` (the GUCs are
 * set there). `DETALLE_NOTA_CREDITO` has no own tenant column, so detail reads
 * navigate via the `notaCredito` relation.
 *
 * CRITICAL CAP (task 1.3): the cumulative returned quantity per
 * (factura, producto) — the sum of every prior VIGENTE NC line for the same
 * factura+producto — MUST be read INSIDE the devolucion transaction and MUST
 * be serialized. The serialization point is deliberately NOT the NCF row lock:
 * `consumirNcfEnTx` runs AFTER this read, so it alone cannot stop two
 * concurrent returns of the same product from both reading the same stale
 * prior total under READ COMMITTED. Instead `crear-devolucion` acquires the
 * INVENTARIO row lock (`leerStockSucursalEnTx`, FOR UPDATE, ascending
 * product-id) BEFORE `leerPriorNCsPorFacturaEnTx`, so the second
 * transaction blocks on the stock row until the first commits and its
 * post-block read observes the freshly committed NC.
 *
 * Audit is append-only (`MOVIMIENTO_AUDITORIA`) and always runs in the same
 * transaction: a rollback removes the NC and its event together.
 */

import {
  Prisma,
  AccionAuditoria,
  EstadoDocumento,
  TipoReposicion,
} from "@/generated/prisma/client";
import { Decimal } from "decimal.js";
import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import { bloquearInventarioSucursalEnTx } from "@/modules/inventario/infrastructure/inventario-repository";

/**
 * The cumulative prior returned quantity per (factura, producto): the sum of
 * `cantidad` over every line of every VIGENTE `NOTA_CREDITO` referencing the
 * original factura at `ctx.sucursalId`, batched over all distinct product ids
 * in ONE grouped query (no N+1). The caller compares each total against the
 * ORIGINAL sale-line quantity (`validarCantidadDevuelta`) so the running total
 * can never exceed what was sold.
 *
 * Serialization contract: only race-free when the caller locked the product's
 * INVENTARIO row FIRST (`leerStockSucursalEnTx`); the NCF lock consumed later
 * is NOT a substitute (see module doc). Branch-scoped: returns happen at the
 * sale's own branch (the guarded venta read forces `ctx.sucursalId`), so only
 * NCs emitted at that branch can cap this factura+producto.
 *
 * @returns a map of productId → cumulative returned `Decimal(12,3)`; a product
 *          with no prior VIGENTE NC line is OMITTED (the caller defaults it to
 *          zero — "0" for a fresh product).
 */
export async function leerPriorNCsPorFacturaEnTx(
  tx: PrismaTx,
  ctx: TenantCtx,
  facturaId: number,
  productoIds: readonly number[],
): Promise<Map<number, Decimal>> {
  const ids = [...new Set(productoIds)];
  if (ids.length === 0) return new Map();
  const filas = await tx.detalleNotaCredito.groupBy({
    by: ["productoId"],
    where: {
      notaCredito: {
        empresaId: ctx.empresaId,
        sucursalId: ctx.sucursalId,
        facturaOriginalId: facturaId,
        estado: EstadoDocumento.VIGENTE,
      },
      productoId: { in: ids },
    },
    _sum: { cantidad: true },
  });
  return new Map(
    filas.map((f) => [f.productoId, new Decimal(f._sum.cantidad?.toString() ?? "0")]),
  );
}

/** One branch stock snapshot after the locking read. */
export interface StockBloqueadoSucursal {
  readonly productoId: number;
  readonly inventarioId: number;
  /** Locked `Decimal(12,3)` quantity — authoritative until the tx commits. */
  readonly cantidad: Decimal;
}

/**
 * Lock the session branch's INVENTARIO rows for every distinct product, in
 * ASCENDING product-id order (the shared lock order across confirm/exit/
 * devolucion — a devolucion can never deadlock against a concurrent confirm).
 *
 * THIS IS THE SERIALIZATION POINT FOR THE CUMULATIVE CAP: each returned
 * product's stock row is held `FOR UPDATE` from here until the enclosing
 * devolucion transaction ends, so a concurrent return of the SAME product
 * blocks at this read and re-reads the cumulative total AFTER the winner
 * committed (never stale). Re-locking the same rows later inside
 * `registrarDevolucionEnTx` is a no-op within the same transaction.
 *
 * @param productoIds distinct-or-not product ids; de-duplicated internally.
 */
export async function leerStockSucursalEnTx(
  tx: PrismaTx,
  ctx: TenantCtx,
  productoIds: readonly number[],
): Promise<StockBloqueadoSucursal[]> {
  const ids = [...new Set(productoIds)].sort((a, b) => a - b);
  const bloqueados: StockBloqueadoSucursal[] = [];
  for (const productoId of ids) {
    const { inventarioId, cantidad } = await bloquearInventarioSucursalEnTx(
      tx,
      ctx,
      productoId,
    );
    bloqueados.push({ productoId, inventarioId, cantidad });
  }
  return bloqueados;
}

/** Header write payload for the emitted credit note (all `Decimal(12,2)` strings). */
export interface CrearNotaCreditoInput {
  /** The original invoice this credit corrects (B04 → B01/B02 factura). */
  readonly facturaOriginalId: number;
  readonly clienteId: number;
  /** The consumed B04 sequence value (empresa-scoped unique). */
  readonly ncf: string;
  /** Non-empty audit/print reason (VarChar 255). */
  readonly motivo: string;
  readonly monto: string;
  readonly itbis: string;
  readonly fechaEmision: Date;
}

/**
 * Insert the `NOTA_CREDITO` header. The B04 sequence was already consumed by
 * the caller (`consumirNcfEnTx`), so the row-isolation happens BEFORE this
 * write: `@@unique([empresaId, ncf])` makes a double-consume impossible and
 * any race would fail this insert instead of duplicating a fiscal document.
 * The note is created `VIGENTE` — devolucion creates fiscal truth in one
 * atomic step (no draft state for NCs).
 */
export async function crearNotaCreditoEnTx(
  tx: PrismaTx,
  ctx: TenantCtx,
  input: CrearNotaCreditoInput,
): Promise<{ id: number }> {
  const created = await tx.notaCredito.create({
    data: {
      facturaOriginalId: input.facturaOriginalId,
      empresaId: ctx.empresaId,
      sucursalId: ctx.sucursalId,
      clienteId: input.clienteId,
      usuarioId: ctx.usuarioId,
      ncf: input.ncf,
      estado: EstadoDocumento.VIGENTE,
      motivo: input.motivo,
      monto: new Prisma.Decimal(input.monto),
      itbis: new Prisma.Decimal(input.itbis),
      fechaEmision: input.fechaEmision,
    },
    select: { id: true },
  });
  return { id: created.id };
}

/** One credit-note detail line (money frozen from the ORIGINAL sale line). */
export interface CrearDetalleNotaCreditoInput {
  readonly productoId: number;
  /** Returned quantity `Decimal(12,3)` string. */
  readonly cantidad: string;
  /** Unit price frozen from the original sale line (`Decimal(12,2)`). */
  readonly precioUnitario: string;
  /** ITBIS rate frozen from the original sale line ("18" | "16" | "0"). */
  readonly tasaItbis: string;
  readonly itbis: string;
  readonly subtotalLinea: string;
  readonly tipoReposicion: TipoReposicion;
}

/**
 * Insert every `DETALLE_NOTA_CREDITO` line in ONE batch (all-or-nothing with
 * the enclosing transaction). Each line freezes unit price, ITBIS rate, line
 * ITBIS and net base from the ORIGINAL sale line — the credit mirrors exactly
 * what the factura charged, so reversing it is fiscally exact.
 */
export async function crearDetalleNotaCreditoEnTx(
  tx: PrismaTx,
  notaCreditoId: number,
  lineas: readonly CrearDetalleNotaCreditoInput[],
): Promise<void> {
  await tx.detalleNotaCredito.createMany({
    data: lineas.map((l) => ({
      notaCreditoId,
      productoId: l.productoId,
      cantidad: new Prisma.Decimal(l.cantidad),
      precioUnitario: new Prisma.Decimal(l.precioUnitario),
      tasaItbis: new Prisma.Decimal(l.tasaItbis),
      itbis: new Prisma.Decimal(l.itbis),
      subtotalLinea: new Prisma.Decimal(l.subtotalLinea),
      tipoReposicion: l.tipoReposicion,
    })),
  });
}

/** Append-only audit row for the emitted credit note (mirrors the venta shape). */
export async function registrarAuditNotaCreditoEnTx(
  tx: PrismaTx,
  ctx: TenantCtx,
  notaCreditoId: number,
  nuevo: {
    readonly estado: string;
    readonly ncf: string;
    readonly monto: string;
    readonly itbis: string;
  },
  motivo: string,
): Promise<void> {
  await tx.movimientoAuditoria.create({
    data: {
      empresaId: ctx.empresaId,
      sucursalId: ctx.sucursalId,
      usuarioId: ctx.usuarioId,
      fechaHora: new Date(),
      accion: AccionAuditoria.CREAR,
      entidad: "NotaCredito",
      idEntidad: String(notaCreditoId),
      valorAnterior: null,
      valorNuevo: JSON.stringify(nuevo),
      motivo,
    },
  });
}