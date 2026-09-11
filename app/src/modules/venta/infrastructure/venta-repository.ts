/**
 * Venta repository — the ONLY place in the venta module that touches Prisma.
 *
 * Tenant isolation (frozen ERD v4.7, RLS already enable+FORCE on VENTA /
 * DETALLE_VENTA): every read/write pins `empresaId` in the Prisma `where` AND
 * runs inside `withTenantTransaction` (the GUCs are set there). `VENTA` carries
 * a direct `empresaId` (primary tenant anchor) plus `sucursalId` (acting branch);
 * `DETALLE_VENTA` has no own tenant column, so line reads/writes navigate via
 * the `venta` relation.
 *
 * Concurrency (design "Guarded transitions"): `VENTA` has NO `version` column, so
 * a guarded `UPDATE ... WHERE id AND empresaId AND estado='BORRADOR'` with an
 * affected-rows check IS the optimistic lock — the compra precedent. A loser
 * updates zero rows and the caller returns `CONCURRENCIA_CONFLICTO` with no side
 * effect (no lines replaced, no audit appended).
 *
 * 5b scope guard: nothing here confirms, consumes NCF, or writes
 * `MOVIMIENTO_INVENTARIO` / `INVENTARIO` — stock is READ only, to emit a
 * non-blocking `STOCK_INSUFICIENTE` warning (spec R-V9). The authoritative debit
 * + block is reserved for 5c.
 *
 * Audit is append-only (`MOVIMIENTO_AUDITORIA`) and always runs in the same
 * transaction: a rollback removes the mutation and its event together.
 */

import {
  Prisma,
  AccionAuditoria,
  EstadoVenta,
  DescuentoTipo,
  EstadoDocumento,
  TipoNcfFactura,
} from "@/generated/prisma/client";
import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import {
  ESTADO_VENTA,
  estadoVentaDesdeDb,
  type DescuentoTipo as DescuentoTipoCore,
  type EstadoVenta as EstadoVentaCore,
} from "../domain/venta";

/** Product classification for line validation, rate freeze and validity check. */
export interface ProductoParaLineaVenta {
  readonly id: number;
  readonly activo: boolean;
  /** Frozen ITBIS rate string ("18" | "16" | "0"). */
  readonly tasaItbis: string;
  readonly itbisVigenteDesde: Date;
  /** `null` = open-ended (no upper bound). */
  readonly itbisVigenteHasta: Date | null;
  readonly nombre: string;
}

/** Branch stock for a single product at the acting sucursal. */
export interface StockSucursal {
  readonly productoId: number;
  /** `Decimal(12,3)` string; `"0.000"` when the product has no row at branch. */
  readonly disponible: string;
}

/** A persisted sale line: fully-computed, ready to write (all Decimal strings). */
export interface VentaLineaPersistir {
  readonly productoId: number;
  readonly cantidad: string;
  readonly precioUnitario: string;
  /** Line discount money (2dp), never the raw percentage (R-V7). */
  readonly descuentoLinea: string;
  readonly descuentoTipo: DescuentoTipoCore;
  /** Admin actor for this line's discount; `null` when no discount. */
  readonly descuentoAutorizadoPor: number | null;
  /** Frozen per-line ITBIS rate. */
  readonly tasaItbis: string;
  /** ITBIS on the final post-proration base (calculator output). */
  readonly itbisLinea: string;
  /** Final net base (calculator output) — the persisted `subtotalLinea`. */
  readonly subtotalLinea: string;
}

/** Header totals write payload (all `Decimal(12,2)` strings). */
export interface VentaTotalesWrite {
  readonly subtotal: string;
  readonly descuento: string;
  readonly descuentoTipo: DescuentoTipoCore;
  readonly descuentoAutorizadoPor: number | null;
  readonly itbis: string;
  readonly total: string;
}

/** Create payload: header fields + already-frozen computed lines. */
export interface CrearVentaPersistencia {
  readonly sucursalId: number;
  readonly clienteId: number;
  readonly usuarioId: number;
  readonly fecha: Date;
  readonly lineas: readonly VentaLineaPersistir[];
  readonly totales: VentaTotalesWrite;
}

/** A sale header with the fields core logic needs, tenant-checked. */
export interface VentaLeida {
  readonly id: number;
  readonly estado: EstadoVentaCore;
  readonly sucursalId: number;
  readonly clienteId: number;
  /**
   * The row's current `updatedAt`, used as the optimistic-lock token for draft
   * edits. `VENTA` has no `version` column, and a draft edit leaves `estado` at
   * `BORRADOR`, so `estado` alone cannot make two concurrent edits conflict — the
   * guarded update additionally pins the `updatedAt` read at the pre-check so the
   * affected-rows check is meaningful (see `actualizarVentaBorradorEnTx`).
   */
  readonly updatedAt: Date;
}

/** Compact list row (header projection) for paginated "mis borradores". */
export interface VentaListRow {
  readonly id: number;
  readonly fecha: Date;
  readonly estado: string;
  readonly total: string;
  readonly descuento: string;
  readonly clienteNombre: string;
  readonly usuarioNombre: string;
}

/** Detail projection with client name and full lines (same-tenant only). */
export interface VentaDetalle {
  readonly id: number;
  readonly empresaId: number;
  readonly sucursalId: number;
  readonly clienteId: number;
  readonly clienteNombre: string;
  readonly usuarioId: number;
  readonly fecha: Date;
  readonly estado: string;
  readonly subtotal: string;
  readonly descuento: string;
  readonly descuentoTipo: string;
  readonly descuentoAutorizadoPor: number | null;
  readonly itbis: string;
  readonly total: string;
  readonly lineas: readonly {
    readonly productoId: number;
    readonly productoNombre: string;
    readonly cantidad: string;
    readonly precioUnitario: string;
    readonly tasaItbis: string;
    readonly descuentoLinea: string;
    readonly descuentoTipo: string;
    readonly itbisLinea: string;
    readonly subtotalLinea: string;
  }[];
}

/**
 * Total, exhaustive WRITE-direction mapper domain→DB for the states 5b can
 * write. Every `EstadoVentaCore` is handled explicitly with NO default, so the
 * compiler rejects a state that lacks a case. The READ direction uses the pure
 * `estadoVentaDesdeDb` domain mapper (fail-loud on unknown states).
 */
function aPrismaEstado(estado: EstadoVentaCore): EstadoVenta {
  switch (estado) {
    case ESTADO_VENTA.BORRADOR:
      return EstadoVenta.BORRADOR;
    case ESTADO_VENTA.CANCELADA:
      return EstadoVenta.CANCELADA;
    case ESTADO_VENTA.CONFIRMADA:
      return EstadoVenta.CONFIRMADA;
  }
}

function aPrismaDescuentoTipo(tipo: DescuentoTipoCore): DescuentoTipo {
  switch (tipo) {
    case "PORCENTAJE":
      return DescuentoTipo.PORCENTAJE;
    case "MONTO":
      return DescuentoTipo.MONTO;
  }
}

// --- reads for line preparation / resolver / stock ---

/**
 * Batch product lookup scoped to the empresa (never a foreign company's product).
 * Returns each requested id's active flag, frozen rate and ITBIS validity window;
 * omits ids that do not belong to the tenant so the caller rejects them.
 */
export async function leerProductosParaLineasVentaEnTx(
  tx: PrismaTx,
  empresaId: number,
  productoIds: readonly number[],
): Promise<ProductoParaLineaVenta[]> {
  if (productoIds.length === 0) return [];
  const rows = await tx.producto.findMany({
    where: { empresaId, id: { in: [...productoIds] } },
    select: {
      id: true,
      activo: true,
      nombre: true,
      tasaItbis: true,
      itbisVigenteDesde: true,
      itbisVigenteHasta: true,
    },
  });
  return rows.map((r) => ({
    id: r.id,
    activo: r.activo,
    nombre: r.nombre,
    tasaItbis: new Prisma.Decimal(r.tasaItbis).toString(),
    itbisVigenteDesde: r.itbisVigenteDesde,
    itbisVigenteHasta: r.itbisVigenteHasta,
  }));
}

/**
 * Branch stock for the requested products at `sucursalId`. A product with no
 * INVENTARIO row at that branch is reported with `disponible = "0.000"` so the
 * caller can still emit a shortage warning (never a hard block in 5b).
 */
export async function leerStockSucursalEnTx(
  tx: PrismaTx,
  sucursalId: number,
  productoIds: readonly number[],
): Promise<StockSucursal[]> {
  if (productoIds.length === 0) return [];
  const rows = await tx.inventario.findMany({
    where: { sucursalId, productoId: { in: [...productoIds] } },
    select: { productoId: true, cantidad: true },
  });
  const disponibles = new Map(
    rows.map((r) => [r.productoId, new Prisma.Decimal(r.cantidad).toFixed(3)]),
  );
  return [...new Set(productoIds)].map((productoId) => ({
    productoId,
    disponible: disponibles.get(productoId) ?? "0.000",
  }));
}

/**
 * Empresa-scoped client header for the venta resolver. Returns the id's active
 * flag and CF membership, or `null` for an id that is not the tenant's (a
 * cross-tenant id is indistinguishable from a missing one — no existence leak).
 */
export async function leerClienteParaVentaEnTx(
  tx: PrismaTx,
  empresaId: number,
  clienteId: number,
): Promise<{ id: number; activo: boolean; esConsumidorFinal: boolean } | null> {
  const row = await tx.cliente.findFirst({
    where: { id: clienteId, empresaId },
    select: { id: true, activo: true, esConsumidorFinal: true },
  });
  return row;
}

/**
 * Role-based authorization for venta Server Actions and the server-side discount
 * gate. Prisma access stays in infrastructure; only the boolean crosses back.
 * Same provenance as the compra/producto/cliente copies (centralization deferred
 * — YAGNI).
 */
export async function tieneRolPermitidoEnTx(
  tx: PrismaTx,
  usuarioId: number,
  empresaId: number,
  rolesPermitidos: readonly string[],
): Promise<boolean> {
  const usuario = await tx.usuario.findUnique({
    where: { id: usuarioId, empresaId },
    select: { roles: { select: { rol: { select: { nombre: true } } } } },
  });
  if (usuario === null) return false;
  return usuario.roles.some((r) => rolesPermitidos.includes(r.rol.nombre));
}

// --- writes ---

/** Insert a new BORRADOR sale and its lines in one guarded step. Returns the id. */
export async function crearVentaConLineasEnTx(
  tx: PrismaTx,
  ctx: TenantCtx,
  input: CrearVentaPersistencia,
): Promise<{ id: number }> {
  const created = await tx.venta.create({
    data: {
      empresaId: ctx.empresaId,
      sucursalId: input.sucursalId,
      clienteId: input.clienteId,
      usuarioId: input.usuarioId,
      fecha: input.fecha,
      estado: EstadoVenta.BORRADOR,
      subtotal: new Prisma.Decimal(input.totales.subtotal),
      descuento: new Prisma.Decimal(input.totales.descuento),
      descuentoTipo: aPrismaDescuentoTipo(input.totales.descuentoTipo),
      descuentoAutorizadoPor: input.totales.descuentoAutorizadoPor,
      itbis: new Prisma.Decimal(input.totales.itbis),
      total: new Prisma.Decimal(input.totales.total),
      detalles: {
        create: input.lineas.map((l) => ({
          productoId: l.productoId,
          cantidad: new Prisma.Decimal(l.cantidad),
          precioUnitario: new Prisma.Decimal(l.precioUnitario),
          descuentoLinea: new Prisma.Decimal(l.descuentoLinea),
          descuentoTipo: aPrismaDescuentoTipo(l.descuentoTipo),
          descuentoAutorizadoPor: l.descuentoAutorizadoPor,
          tasaItbis: new Prisma.Decimal(l.tasaItbis),
          itbisLinea: new Prisma.Decimal(l.itbisLinea),
          subtotalLinea: new Prisma.Decimal(l.subtotalLinea),
        })),
      },
    },
    select: { id: true },
  });
  return { id: created.id };
}

/**
 * Tenant/branch-scoped header read (with lines) for the update/cancel
 * preconditions. `null` for a foreign tenant/branch id (behaves as not-found).
 */
export async function leerVentaEnTx(
  tx: PrismaTx,
  ctx: TenantCtx,
  ventaId: number,
): Promise<VentaLeida | null> {
  const row = await tx.venta.findFirst({
    where: { id: ventaId, empresaId: ctx.empresaId, sucursalId: ctx.sucursalId },
    select: {
      id: true,
      estado: true,
      sucursalId: true,
      clienteId: true,
      updatedAt: true,
    },
  });
  if (row === null) return null;
  return {
    id: row.id,
    // Total, exhaustive DB→domain mapping; unknown states fail loud (never coerce).
    estado: estadoVentaDesdeDb(row.estado),
    sucursalId: row.sucursalId,
    clienteId: row.clienteId,
    updatedAt: row.updatedAt,
  };
}

/**
 * Guarded draft edit: update the header (client + totals + discount shape) only
 * while the row is STILL `BORRADOR` for this empresa/branch AND still carries the
 * `updatedAt` snapshot the caller read (`expectedUpdatedAt`). A zero-row result
 * means a concurrent edit (or a cancel) changed the row first — mapped to
 * `CONCURRENCIA_CONFLICTO` upstream with NO line replacement and NO audit. There
 * is no `version` column and a draft edit leaves `estado='BORRADOR'`, so the
 * `updatedAt` token is what makes two parallel edits genuinely conflict (the
 * `@updatedAt` trigger advances it on the winner's commit, so the loser's pinned
 * value no longer matches). This is the guarded-predicate optimistic lock.
 */
export async function actualizarVentaBorradorEnTx(
  tx: PrismaTx,
  ctx: TenantCtx,
  ventaId: number,
  expectedUpdatedAt: Date,
  patch: { readonly clienteId: number; readonly totales: VentaTotalesWrite },
): Promise<{ updated: boolean }> {
  const result = await tx.venta.updateMany({
    where: {
      id: ventaId,
      empresaId: ctx.empresaId,
      sucursalId: ctx.sucursalId,
      estado: EstadoVenta.BORRADOR,
      updatedAt: expectedUpdatedAt,
    },
    data: {
      clienteId: patch.clienteId,
      subtotal: new Prisma.Decimal(patch.totales.subtotal),
      descuento: new Prisma.Decimal(patch.totales.descuento),
      descuentoTipo: aPrismaDescuentoTipo(patch.totales.descuentoTipo),
      descuentoAutorizadoPor: patch.totales.descuentoAutorizadoPor,
      itbis: new Prisma.Decimal(patch.totales.itbis),
      total: new Prisma.Decimal(patch.totales.total),
    },
  });
  return { updated: result.count > 0 };
}

/**
 * Replace a draft's lines atomically: delete existing `DETALLE_VENTA` rows (only
 * reachable after a guarded header update proved the sale was still `BORRADOR`)
 * and insert the recomputed ones.
 */
export async function reemplazarLineasVentaEnTx(
  tx: PrismaTx,
  ventaId: number,
  lineas: readonly VentaLineaPersistir[],
): Promise<void> {
  await tx.detalleVenta.deleteMany({ where: { ventaId } });
  if (lineas.length === 0) return;
  await tx.detalleVenta.createMany({
    data: lineas.map((l) => ({
      ventaId,
      productoId: l.productoId,
      cantidad: new Prisma.Decimal(l.cantidad),
      precioUnitario: new Prisma.Decimal(l.precioUnitario),
      descuentoLinea: new Prisma.Decimal(l.descuentoLinea),
      descuentoTipo: aPrismaDescuentoTipo(l.descuentoTipo),
      descuentoAutorizadoPor: l.descuentoAutorizadoPor,
      tasaItbis: new Prisma.Decimal(l.tasaItbis),
      itbisLinea: new Prisma.Decimal(l.itbisLinea),
      subtotalLinea: new Prisma.Decimal(l.subtotalLinea),
    })),
  });
}

/**
 * Guarded `BORRADOR → CANCELADA` cancel: ONE `UPDATE ... WHERE id AND empresaId
 * AND sucursalId AND estado='BORRADOR'` with an affected-rows check. A second
 * cancel or a losing concurrent race matches zero rows (`cancelled:false`) — the
 * caller returns `CONCURRENCIA_CONFLICTO` and appends NO second audit row. Stock,
 * NCF and payments are untouched (none exist in 5b).
 */
export async function cancelarVentaEnTx(
  tx: PrismaTx,
  ctx: TenantCtx,
  ventaId: number,
): Promise<{ cancelled: boolean }> {
  const result = await tx.venta.updateMany({
    where: {
      id: ventaId,
      empresaId: ctx.empresaId,
      sucursalId: ctx.sucursalId,
      estado: EstadoVenta.BORRADOR,
    },
    data: { estado: EstadoVenta.CANCELADA },
  });
  return { cancelled: result.count > 0 };
}

// --- confirm / FACTURA emission (5c Phase 2) ------------------------------

/**
 * A sale header + persisted lines, read branch-scoped for `confirmarVenta`. The
 * `WHERE empresaId AND sucursalId` predicate makes a foreign-branch sale a `null`
 * (behaves exactly like not-found — zero disclosure of another branch's data,
 * R-V15 "Foreign-branch sale not confirmable"). Line values cross as Decimal
 * strings so the application layer recomputes the invoice without any float.
 */
export interface VentaParaConfirmar {
  readonly id: number;
  readonly estado: EstadoVentaCore;
  readonly sucursalId: number;
  readonly clienteId: number;
  /** Server-frozen header money (identity terms for the invoice total). */
  readonly subtotal: string;
  readonly descuento: string;
  readonly lineas: readonly {
    readonly productoId: number;
    readonly cantidad: string;
    readonly tasaItbis: string;
    /** Final net base persisted at draft (post line + header discounts). */
    readonly subtotalLinea: string;
    readonly itbisLinea: string;
  }[];
}

/**
 * Branch-guarded read of everything `confirmarVenta` needs: the current state
 * (idempotency gate) plus persisted lines (hard stock preview + invoice
 * re-derivation). `null` for a foreign tenant/branch id or a missing sale.
 */
export async function leerVentaParaConfirmarEnTx(
  tx: PrismaTx,
  ctx: TenantCtx,
  ventaId: number,
): Promise<VentaParaConfirmar | null> {
  const row = await tx.venta.findFirst({
    where: { id: ventaId, empresaId: ctx.empresaId, sucursalId: ctx.sucursalId },
    select: {
      id: true,
      estado: true,
      sucursalId: true,
      clienteId: true,
      subtotal: true,
      descuento: true,
      detalles: {
        select: {
          productoId: true,
          cantidad: true,
          tasaItbis: true,
          subtotalLinea: true,
          itbisLinea: true,
        },
      },
    },
  });
  if (row === null) return null;
  const money = (v: Prisma.Decimal): string => new Prisma.Decimal(v).toFixed(2);
  return {
    id: row.id,
    estado: estadoVentaDesdeDb(row.estado),
    sucursalId: row.sucursalId,
    clienteId: row.clienteId,
    subtotal: money(row.subtotal),
    descuento: money(row.descuento),
    lineas: row.detalles.map((l) => ({
      productoId: l.productoId,
      cantidad: new Prisma.Decimal(l.cantidad).toFixed(3),
      tasaItbis: new Prisma.Decimal(l.tasaItbis).toString(),
      subtotalLinea: money(l.subtotalLinea),
      itbisLinea: money(l.itbisLinea),
    })),
  };
}

/** `Empresa.facturaAutomatica` — the emission gate (R-F1). Missing row → false. */
export async function leerFacturaAutomaticaDeEmpresaEnTx(
  tx: PrismaTx,
  empresaId: number,
): Promise<boolean> {
  const empresa = await tx.empresa.findFirst({
    where: { id: empresaId },
    select: { facturaAutomatica: true },
  });
  return empresa?.facturaAutomatica ?? false;
}

/**
 * Client facts for NCF type eligibility (R-F2): the CF flag and the stored fiscal
 * id. Empresa-scoped so a foreign id yields `null`.
 */
export async function leerClienteParaElegibilidadEnTx(
  tx: PrismaTx,
  empresaId: number,
  clienteId: number,
): Promise<
  { readonly esConsumidorFinal: boolean; readonly identificacionFiscal: string | null } | null
> {
  const row = await tx.cliente.findFirst({
    where: { id: clienteId, empresaId },
    select: { esConsumidorFinal: true, identificacionFiscal: true },
  });
  return row;
}

/**
 * Guarded `BORRADOR → CONFIRMADA` flip — the single-flip optimistic lock. Runs as
 * ONE `UPDATE ... WHERE id AND empresaId AND sucursalId AND estado='BORRADOR'`
 * (the compra cancel precedent). A zero-row result means a concurrent confirm
 * already flipped the row: the caller MUST throw (never return) because the flip
 * sits AFTER the NCF consume, so aborting the transaction un-burns the loser's
 * sequence number and leaves exactly one invoice (R-V15 "Double-click is
 * idempotent").
 */
export async function confirmarVentaFlipEnTx(
  tx: PrismaTx,
  ctx: TenantCtx,
  ventaId: number,
): Promise<{ flipUpdated: boolean }> {
  const result = await tx.venta.updateMany({
    where: {
      id: ventaId,
      empresaId: ctx.empresaId,
      sucursalId: ctx.sucursalId,
      estado: EstadoVenta.BORRADOR,
    },
    data: { estado: EstadoVenta.CONFIRMADA },
  });
  return { flipUpdated: result.count > 0 };
}

/** Invoice write payload: eligibility + recomputed Decimal-string amounts + NCF. */
export interface FacturaPersistencia {
  readonly ventaId: number;
  readonly clienteId: number;
  readonly usuarioId: number;
  readonly sucursalId: number;
  readonly tipoNcf: "B01" | "B02";
  readonly ncf: string;
  readonly correlativoInterno: string;
  readonly subtotalGravado: string;
  readonly subtotalExento: string;
  readonly itbis: string;
  readonly descuento: string;
  readonly total: string;
  readonly fechaEmision: Date;
}

/**
 * Allocate the next per-empresa invoice correlativo `FAC-%06d` (R-F3 "Correlativo
 * allocation is atomic"), mirroring the compra `CMP-%06d` precedent:
 *   1. `SELECT ... FOR UPDATE` the EMPRESA row — the durable company-wide anchor.
 *   2. Temporarily clear ONLY the sucursal GUC so the `MAX` spans every branch of
 *      this empresa; the empresa boundary (`app.current_empresa_id`) stays pinned.
 *   3. Read the company-wide MAX of the trailing digits and add one.
 *   4. Restore the acting branch GUC in a `finally` — BEFORE the caller performs
 *      the branch-scoped FACTURA write. The restore lives in `finally` (not inline)
 *      so a failure inside the MAX read can never leak the cleared sucursal GUC
 *      into a subsequent branch-scoped write (design RLS-restore risk, task 2.9).
 * Integers cast `::int` so Prisma returns JS numbers (the ES2020 target cannot emit
 * BigInt literals), matching `asignarCorrelativoSiguienteEnTx` in compra.
 */
export async function asignarCorrelativoFacturaEnTx(
  tx: PrismaTx,
  empresaId: number,
  sucursalId: number,
): Promise<string> {
  await tx.$executeRaw`SELECT "id" FROM "EMPRESA" WHERE "id" = ${empresaId} FOR UPDATE`;
  await tx.$executeRaw`SELECT set_config('app.current_sucursal_id', '', true)`;
  try {
    const rows = await tx.$queryRaw<{ next: number }[]>`
      SELECT (COALESCE(MAX(CAST(SUBSTRING("correlativoInterno" FROM '([0-9]+)$') AS BIGINT)), 0) + 1)::int AS next
      FROM "FACTURA"
      WHERE "empresaId" = ${empresaId}`;
    const next = rows[0]?.next ?? 1;
    return `FAC-${next.toString().padStart(6, "0")}`;
  } finally {
    // Always restore the acting branch before any downstream branch-scoped write.
    await tx.$executeRaw`SELECT set_config('app.current_sucursal_id', ${String(
      sucursalId,
    )}, true)`;
  }
}

/**
 * Insert the emission `FACTURA` (R-F1/R-F3/R-F4). `estado=VIGENTE`, linked 1:1 to
 * the sale via the unique `ventaId`; `sucursalId` carries the acting branch (the
 * sucursal GUC was restored by the allocator before this write). NO paid/balance
 * column is written — payment state stays derived (ADR-017). Any failure here
 * propagates as a throw (post-consume), rolling back the flip and the NCF too.
 */
export async function crearFacturaEnTx(
  tx: PrismaTx,
  ctx: TenantCtx,
  input: FacturaPersistencia,
): Promise<{ id: number }> {
  const created = await tx.factura.create({
    data: {
      ventaId: input.ventaId,
      empresaId: ctx.empresaId,
      sucursalId: input.sucursalId,
      clienteId: input.clienteId,
      usuarioId: input.usuarioId,
      tipoNcf:
        input.tipoNcf === "B01" ? TipoNcfFactura.B01 : TipoNcfFactura.B02,
      ncf: input.ncf,
      correlativoInterno: input.correlativoInterno,
      estado: EstadoDocumento.VIGENTE,
      subtotalGravado: new Prisma.Decimal(input.subtotalGravado),
      subtotalExento: new Prisma.Decimal(input.subtotalExento),
      itbis: new Prisma.Decimal(input.itbis),
      descuento: new Prisma.Decimal(input.descuento),
      total: new Prisma.Decimal(input.total),
      fechaEmision: input.fechaEmision,
    },
    select: { id: true },
  });
  return { id: created.id };
}

/** The sale's already-existing invoice (idempotent-retry read), or `null`. */
export async function leerFacturaDeVentaEnTx(
  tx: PrismaTx,
  ctx: TenantCtx,
  ventaId: number,
): Promise<
  | {
      readonly id: number;
      readonly ncf: string;
      readonly tipoNcf: string;
      readonly correlativoInterno: string;
      readonly total: string;
    }
  | null
> {
  const row = await tx.factura.findFirst({
    where: { ventaId, empresaId: ctx.empresaId, sucursalId: ctx.sucursalId },
    select: {
      id: true,
      ncf: true,
      tipoNcf: true,
      correlativoInterno: true,
      total: true,
    },
  });
  if (row === null) return null;
  return {
    id: row.id,
    ncf: row.ncf,
    tipoNcf: row.tipoNcf,
    correlativoInterno: row.correlativoInterno,
    total: new Prisma.Decimal(row.total).toFixed(2),
  };
}

// --- confirmed-sale cancellation (5c Phase 3) ------------------------------

/**
 * Guarded `CONFIRMADA → CANCELADA` flip — the confirmed-cancel optimistic lock
 * (R-V16). ONE `UPDATE ... WHERE id AND empresaId AND sucursalId AND
 * estado='CONFIRMADA'` with an affected-rows check. Zero rows means either a
 * concurrent cancel already flipped the sale or a confirm raced it; the caller
 * returns `CONCURRENCIA_CONFLICTO` and touches neither the invoice nor stock.
 * Distinct from the draft `cancelarVentaEnTx` (which pins `estado='BORRADOR'`),
 * so the two cancel paths can never cross-apply.
 */
export async function cancelarVentaConfirmadaEnTx(
  tx: PrismaTx,
  ctx: TenantCtx,
  ventaId: number,
): Promise<{ cancelled: boolean }> {
  const result = await tx.venta.updateMany({
    where: {
      id: ventaId,
      empresaId: ctx.empresaId,
      sucursalId: ctx.sucursalId,
      estado: EstadoVenta.CONFIRMADA,
    },
    data: { estado: EstadoVenta.CANCELADA },
  });
  return { cancelled: result.count > 0 };
}

/**
 * Guarded `VIGENTE → ANULADA` annul of the sale's emitted invoice (R-V16, 608
 * semantics — the document is NEVER deleted, only annulled; "unused" NCF keeps
 * fiscal reporting). One `UPDATE ... WHERE ventaId AND empresaId AND sucursalId
 * AND estado='VIGENTE'` with an affected-rows check. A zero-row result means the
 * invoice is not in a VIGENTE state (already ANULADA/CANCELADA) — the caller MUST
 * NOT double-annul and instead aborts, so the sale flip rolls back with it.
 */
export async function anularFacturaDeVentaEnTx(
  tx: PrismaTx,
  ctx: TenantCtx,
  ventaId: number,
): Promise<{ annulled: boolean }> {
  const result = await tx.factura.updateMany({
    where: {
      ventaId,
      empresaId: ctx.empresaId,
      sucursalId: ctx.sucursalId,
      estado: EstadoDocumento.VIGENTE,
    },
    data: { estado: EstadoDocumento.ANULADA },
  });
  return { annulled: result.count > 0 };
}

/**
 * Append-only audit row for the invoice state change (the sale flip has its own
 * `Venta` audit). Mirrors `registrarAuditVentaEnTx` but with `entidad: "Factura"`
 * and the `ANULAR` action, so a reviewer sees both reversals in 608 terms.
 */
export async function registrarAuditFacturaEnTx(
  tx: PrismaTx,
  ctx: TenantCtx,
  facturaId: number,
  valoresAnteriores: Record<string, unknown> | null,
  valoresNuevos: Record<string, unknown> | null,
  motivo: string | null = null,
): Promise<void> {
  await tx.movimientoAuditoria.create({
    data: {
      empresaId: ctx.empresaId,
      sucursalId: ctx.sucursalId,
      usuarioId: ctx.usuarioId,
      fechaHora: new Date(),
      accion: AccionAuditoria.ANULAR,
      entidad: "Factura",
      idEntidad: String(facturaId),
      valorAnterior:
        valoresAnteriores === null ? null : JSON.stringify(valoresAnteriores),
      valorNuevo:
        valoresNuevos === null ? null : JSON.stringify(valoresNuevos),
      motivo,
    },
  });
}

/** The sale's VIGENTE invoice id (for the cancel annul + audit), or `null`. */
export async function leerFacturaVigenteDeVentaEnTx(
  tx: PrismaTx,
  ctx: TenantCtx,
  ventaId: number,
): Promise<{ id: number } | null> {
  const row = await tx.factura.findFirst({
    where: {
      ventaId,
      empresaId: ctx.empresaId,
      sucursalId: ctx.sucursalId,
      estado: EstadoDocumento.VIGENTE,
    },
    select: { id: true },
  });
  return row;
}

// --- listing / detail ---

export interface ListarVentasFiltro {
  readonly page: number;
  readonly limit: number;
  readonly estado?: EstadoVentaCore;
  readonly soloMios?: boolean;
}

function buildListWhere(
  ctx: TenantCtx,
  query: ListarVentasFiltro,
): Prisma.VentaWhereInput {
  const where: Prisma.VentaWhereInput = {
    empresaId: ctx.empresaId,
    sucursalId: ctx.sucursalId,
  };
  if (query.estado !== undefined) {
    where.estado = aPrismaEstado(query.estado);
  }
  if (query.soloMios) {
    where.usuarioId = ctx.usuarioId;
  }
  return where;
}

/** Deterministic, tenant+branch-scoped paginated listing (fecha desc, id desc). */
export async function listarVentasEnTx(
  tx: PrismaTx,
  ctx: TenantCtx,
  query: ListarVentasFiltro,
): Promise<VentaListRow[]> {
  const rows = await tx.venta.findMany({
    where: buildListWhere(ctx, query),
    select: {
      id: true,
      fecha: true,
      estado: true,
      total: true,
      descuento: true,
      cliente: { select: { nombre: true } },
      usuario: { select: { nombre: true } },
    },
    orderBy: [{ fecha: "desc" }, { id: "desc" }],
    skip: (query.page - 1) * query.limit,
    take: query.limit,
  });
  return rows.map((r) => ({
    id: r.id,
    fecha: r.fecha,
    estado: r.estado,
    total: new Prisma.Decimal(r.total).toString(),
    descuento: new Prisma.Decimal(r.descuento).toString(),
    clienteNombre: r.cliente.nombre,
    usuarioNombre: r.usuario.nombre,
  }));
}

/** Total sales matching the listing filter (empresa + branch bounded). */
export async function contarVentasEnTx(
  tx: PrismaTx,
  ctx: TenantCtx,
  query: ListarVentasFiltro,
): Promise<number> {
  return tx.venta.count({ where: buildListWhere(ctx, query) });
}

/** Same-tenant/branch detail with client name and full lines, or `null`. */
export async function obtenerVentaDetalleEnTx(
  tx: PrismaTx,
  ctx: TenantCtx,
  ventaId: number,
): Promise<VentaDetalle | null> {
  const row = await tx.venta.findFirst({
    where: { id: ventaId, empresaId: ctx.empresaId, sucursalId: ctx.sucursalId },
    select: {
      id: true,
      empresaId: true,
      sucursalId: true,
      clienteId: true,
      usuarioId: true,
      fecha: true,
      estado: true,
      subtotal: true,
      descuento: true,
      descuentoTipo: true,
      descuentoAutorizadoPor: true,
      itbis: true,
      total: true,
      cliente: { select: { nombre: true } },
      detalles: {
        select: {
          productoId: true,
          producto: { select: { nombre: true } },
          cantidad: true,
          precioUnitario: true,
          tasaItbis: true,
          descuentoLinea: true,
          descuentoTipo: true,
          itbisLinea: true,
          subtotalLinea: true,
        },
      },
    },
  });
  if (row === null) return null;
  const d = (v: Prisma.Decimal | null): string =>
    v === null ? "0.00" : new Prisma.Decimal(v).toString();
  return {
    id: row.id,
    empresaId: row.empresaId,
    sucursalId: row.sucursalId,
    clienteId: row.clienteId,
    clienteNombre: row.cliente.nombre,
    usuarioId: row.usuarioId,
    fecha: row.fecha,
    // Detail surfaces the raw stored state; mapping to the enum is exhaustive so
    // an unknown persisted value fails loud rather than leaking a stray string.
    estado: estadoVentaDesdeDb(row.estado),
    subtotal: d(row.subtotal),
    descuento: d(row.descuento),
    descuentoTipo: row.descuentoTipo,
    descuentoAutorizadoPor: row.descuentoAutorizadoPor,
    itbis: d(row.itbis),
    total: d(row.total),
    lineas: row.detalles.map((l) => ({
      productoId: l.productoId,
      productoNombre: l.producto.nombre,
      cantidad: new Prisma.Decimal(l.cantidad).toString(),
      precioUnitario: d(l.precioUnitario),
      tasaItbis: d(l.tasaItbis),
      descuentoLinea: d(l.descuentoLinea),
      descuentoTipo: l.descuentoTipo,
      itbisLinea: d(l.itbisLinea),
      subtotalLinea: d(l.subtotalLinea),
    })),
  };
}

/**
 * Append-only audit row for a sale mutation, in the same tenant transaction.
 * Reuses the frozen `AccionAuditoria` enum (CREAR / ACTUALIZAR / CANCELAR). The
 * payloads stay VARCHAR(255)-safe: ids + a couple of scalar fields only, never
 * full-row JSON.
 */
export async function registrarAuditVentaEnTx(
  tx: PrismaTx,
  ctx: TenantCtx,
  accion: AccionAuditoria,
  ventaId: number,
  valoresAnteriores: Record<string, unknown> | null,
  valoresNuevos: Record<string, unknown> | null,
  motivo: string | null = null,
): Promise<void> {
  await tx.movimientoAuditoria.create({
    data: {
      empresaId: ctx.empresaId,
      sucursalId: ctx.sucursalId,
      usuarioId: ctx.usuarioId,
      fechaHora: new Date(),
      accion,
      entidad: "Venta",
      idEntidad: String(ventaId),
      valorAnterior:
        valoresAnteriores === null ? null : JSON.stringify(valoresAnteriores),
      valorNuevo:
        valoresNuevos === null ? null : JSON.stringify(valoresNuevos),
      motivo,
    },
  });
}
