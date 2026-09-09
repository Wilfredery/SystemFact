/**
 * Compra repository — the ONLY place in the module that touches Prisma.
 *
 * Tenant isolation (frozen schema, RLS on): every read/write pins `empresaId`
 * in the Prisma `where` AND relies on the `COMPRA` / `DETALLE_COMPRA` RLS
 * policies (the surrounding `withTenantTransaction` sets the GUCs). `Compra`
 * carries a direct `empresaId`, so it is the primary tenant anchor; `sucursalId`
 * comes from the acting context.
 *
 * Concurrency / correlativo (design "Internal correlativo"): confirming a
 * purchase locks the tenant `EMPRESA` row with `SELECT ... FOR UPDATE`, then
 * allocates `CMP-%06d` as `MAX(numeric suffix) + 1`. The `COMPRA` RLS policy
 * also filters by `sucursalId`, so to compute a genuinely PER-EMPRESA counter
 * the single aggregate `SELECT` runs with `app.current_sucursal_id` locally
 * cleared (the empresa boundary — `app.current_empresa_id` — stays enforced);
 * the branch GUC is immediately restored before the guarded `UPDATE`. The
 * empresa lock serializes all confirms for the company, so two racing confirms
 * cannot reuse a value.
 *
 * Idempotency (design "Transition idempotency"): `CONFIRM` and `CANCEL` are a
 * single guarded `UPDATE ... WHERE id AND empresaId AND estado=<expected>` plus
 * an affected-rows check; a loser updates zero rows and produces no audit or
 * correlativo side effect. `Compra` has no `version` column, so the guarded
 * state predicate IS the optimistic-lock mechanism.
 *
 * Audit is append-only (`MOVIMIENTO_AUDITORIA`) and always runs in the same
 * transaction: a rollback removes the mutation and its event together.
 */

import {
  Prisma,
  AccionAuditoria,
  EstadoCompra,
  TipoCompra,
  TipoNcfCompra,
} from "@/generated/prisma/client";
import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import { NFC_DUPLICADO, CompraDomainError } from "../domain/errors";
import type {
  ClaseProveedor,
  CompraLineaCalculada,
  EstadoCompraCore,
  TipoNcfCompra as TipoNcfCompraCore,
  TipoCompra as TipoCompraCore,
  TipoPersona,
} from "../domain/compra";
import { ESTADO_COMPRA } from "../domain/compra";

/** A stored purchase line, quantities/costs/rates as Decimal strings. */
export interface CompraLineaPersistida {
  readonly productoId: number;
  readonly cantidad: string;
  readonly costoUnitario: string;
  readonly tasaItbis: string;
}

/** A purchase header with the fields core logic needs, tenant-checked. */
export interface CompraLeida {
  readonly id: number;
  readonly estado: EstadoCompraCore;
  readonly correlativoInterno: string;
  readonly tipoCompra: TipoCompraCore;
  readonly ncf: string | null;
  readonly tipoNcf: TipoNcfCompraCore | null;
  readonly proveedorId: number;
  readonly lineas: readonly CompraLineaPersistida[];
}

/** Supplier classification needed by the retention matrix. */
export interface ProveedorClasificado {
  readonly id: number;
  readonly activo: boolean;
  readonly tipoProveedor: ClaseProveedor;
  readonly tipoPersona: TipoPersona;
}

/** Product lookup result for line validation and frozen rate. */
export interface ProductoParaLinea {
  readonly id: number;
  readonly activo: boolean;
  readonly tasaItbis: string;
}

/** A compact list row (header projection) for paginated listing. */
export interface CompraListRow {
  readonly id: number;
  readonly correlativoInterno: string;
  readonly tipoCompra: string;
  readonly estado: string;
  readonly ncf: string | null;
  readonly total: string;
  readonly fecha: Date;
  readonly proveedorNombre: string;
}

/** A detail projection with supplier name and full lines. */
export interface CompraDetalle {
  readonly id: number;
  readonly empresaId: number;
  readonly sucursalId: number;
  readonly correlativoInterno: string;
  readonly tipoCompra: string;
  readonly estado: string;
  readonly ncf: string | null;
  readonly tipoNcf: string | null;
  readonly fecha: Date;
  readonly subtotal: string;
  readonly subtotalGravado: string;
  readonly subtotalExento: string;
  readonly itbis: string;
  readonly retencionIsr: string;
  readonly retencionItbis: string;
  readonly total: string;
  readonly proveedor: { readonly id: number; readonly nombre: string };
  readonly lineas: readonly {
    readonly productoId: number;
    readonly productoNombre: string;
    readonly cantidad: string;
    readonly costoUnitario: string;
    readonly tasaItbis: string;
    readonly itbisLinea: string;
    readonly subtotalLinea: string;
  }[];
}

/** Header write payload shared by create/update/confirm. */
export interface CompraTotalesWrite {
  readonly subtotalGravado: string;
  readonly itbis: string;
  readonly subtotalExento: string;
  readonly subtotal: string;
  readonly retencionIsr: string;
  readonly retencionItbis: string;
  readonly total: string;
}

/** Create payload: header + already-frozen computed lines. */
export interface CrearCompraPersistencia {
  readonly sucursalId: number;
  readonly proveedorId: number;
  readonly usuarioId: number;
  readonly tipoCompra: TipoCompraCore;
  readonly fecha: Date;
  readonly ncf: string | null;
  readonly tipoNcf: TipoNcfCompraCore | null;
  readonly correlativoInterno: string;
  readonly lineas: readonly CompraLineaCalculada[];
  readonly totales: CompraTotalesWrite;
}

// --- enum mapping helpers (domain string ↔ frozen Prisma enum) ---
function aPrismaEstado(estado: EstadoCompraCore): EstadoCompra {
  switch (estado) {
    case ESTADO_COMPRA.BORRADOR:
      return EstadoCompra.BORRADOR;
    case ESTADO_COMPRA.PENDIENTE:
      return EstadoCompra.PENDIENTE;
    case ESTADO_COMPRA.CANCELADA:
      return EstadoCompra.CANCELADA;
  }
}

function esDuplicadoNcf(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002"
  );
}

/**
 * Active, tenant-scoped supplier read for the retention matrix and the
 * "active supplier" precondition. `null` when the id is not the company's.
 */
export async function leerProveedorClasificadoEnTx(
  tx: PrismaTx,
  empresaId: number,
  proveedorId: number,
): Promise<ProveedorClasificado | null> {
  const row = await tx.proveedor.findFirst({
    where: { id: proveedorId, empresaId },
    select: {
      id: true,
      activo: true,
      tipoProveedor: true,
      tipoPersona: true,
    },
  });
  if (row === null) return null;
  return {
    id: row.id,
    activo: row.activo,
    tipoProveedor: row.tipoProveedor as ClaseProveedor,
    tipoPersona: row.tipoPersona as TipoPersona,
  };
}

/**
 * Batch product lookup scoped to the empresa (never a foreign company's
 * product). Returns each requested id's active flag and frozen ITBIS rate, or
 * omits ids that do not belong to the tenant so the caller can reject them.
 */
export async function leerProductosParaLineasEnTx(
  tx: PrismaTx,
  empresaId: number,
  productoIds: readonly number[],
): Promise<ProductoParaLinea[]> {
  if (productoIds.length === 0) return [];
  const rows = await tx.producto.findMany({
    where: { empresaId, id: { in: [...productoIds] } },
    select: { id: true, activo: true, tasaItbis: true },
  });
  return rows.map((r) => ({
    id: r.id,
    activo: r.activo,
    tasaItbis: new Prisma.Decimal(r.tasaItbis).toString(),
  }));
}

/** Tenant-scoped purchase header + lines, or `null` when not the company's. */
export async function leerCompraEnTx(
  tx: PrismaTx,
  ctx: TenantCtx,
  compraId: number,
): Promise<CompraLeida | null> {
  const row = await tx.compra.findFirst({
    where: { id: compraId, empresaId: ctx.empresaId },
    select: {
      id: true,
      estado: true,
      correlativoInterno: true,
      tipoCompra: true,
      ncf: true,
      tipoNcf: true,
      proveedorId: true,
      detalles: {
        select: {
          productoId: true,
          cantidad: true,
          costoUnitario: true,
          tasaItbis: true,
        },
      },
    },
  });
  if (row === null) return null;
  return {
    id: row.id,
    estado: row.estado as EstadoCompraCore,
    correlativoInterno: row.correlativoInterno,
    tipoCompra: row.tipoCompra as TipoCompraCore,
    ncf: row.ncf,
    tipoNcf: row.tipoNcf as TipoNcfCompraCore | null,
    proveedorId: row.proveedorId,
    lineas: row.detalles.map((d) => ({
      productoId: d.productoId,
      cantidad: new Prisma.Decimal(d.cantidad).toString(),
      costoUnitario: new Prisma.Decimal(d.costoUnitario).toString(),
      tasaItbis: new Prisma.Decimal(d.tasaItbis).toString(),
    })),
  };
}

/**
 * Insert a new BORRADOR purchase and its lines in one guarded step. A duplicate
 * `ncf` within the empresa surfaces as the stable `NFC_DUPLICADO` domain error
 * (the `(empresaId, ncf)` unique is the real TOCTOU guard). Returns the new id.
 */
export async function crearCompraConLineasEnTx(
  tx: PrismaTx,
  ctx: TenantCtx,
  input: CrearCompraPersistencia,
): Promise<{ id: number }> {
  try {
    const created = await tx.compra.create({
      data: {
        empresaId: ctx.empresaId,
        sucursalId: input.sucursalId,
        proveedorId: input.proveedorId,
        usuarioId: input.usuarioId,
        tipoCompra: input.tipoCompra as TipoCompra,
        fecha: input.fecha,
        ncf: input.ncf,
        tipoNcf: input.tipoNcf ? (input.tipoNcf as TipoNcfCompra) : null,
        estado: EstadoCompra.BORRADOR,
        correlativoInterno: input.correlativoInterno,
        subtotal: new Prisma.Decimal(input.totales.subtotal),
        subtotalGravado: new Prisma.Decimal(input.totales.subtotalGravado),
        itbis: new Prisma.Decimal(input.totales.itbis),
        subtotalExento: new Prisma.Decimal(input.totales.subtotalExento),
        retencionIsr: new Prisma.Decimal(input.totales.retencionIsr),
        retencionItbis: new Prisma.Decimal(input.totales.retencionItbis),
        total: new Prisma.Decimal(input.totales.total),
        detalles: {
          create: input.lineas.map((l) => ({
            productoId: l.productoId,
            cantidad: new Prisma.Decimal(l.cantidad),
            costoUnitario: new Prisma.Decimal(l.costoUnitario),
            tasaItbis: new Prisma.Decimal(l.tasaItbis),
            itbisLinea: new Prisma.Decimal(l.itbisLinea),
            subtotalLinea: new Prisma.Decimal(l.subtotalLinea),
          })),
        },
      },
      select: { id: true },
    });
    return { id: created.id };
  } catch (err) {
    if (esDuplicadoNcf(err)) {
      throw new CompraDomainError(NFC_DUPLICADO, { ncf: input.ncf });
    }
    throw err;
  }
}

/**
 * Replace a draft's lines atomically: delete the existing `DETALLE_COMPRA` rows
 * and insert the recomputed ones. Only ever called after a guarded header
 * update proved the purchase was still a `BORRADOR` (see actualizar).
 */
export async function reemplazarLineasEnTx(
  tx: PrismaTx,
  compraId: number,
  lineas: readonly CompraLineaCalculada[],
): Promise<void> {
  await tx.detalleCompra.deleteMany({ where: { compraId } });
  if (lineas.length === 0) return;
  await tx.detalleCompra.createMany({
    data: lineas.map((l) => ({
      compraId,
      productoId: l.productoId,
      cantidad: new Prisma.Decimal(l.cantidad),
      costoUnitario: new Prisma.Decimal(l.costoUnitario),
      tasaItbis: new Prisma.Decimal(l.tasaItbis),
      itbisLinea: new Prisma.Decimal(l.itbisLinea),
      subtotalLinea: new Prisma.Decimal(l.subtotalLinea),
    })),
  });
}

/**
 * Guarded draft edit: update header + ncf/tipoNcf only while the row is still
 * `BORRADOR` for this empresa. A zero-row result means a concurrent confirm or
 * cancel won the race (mapped to `CONCURRENCIA_CONFLICTO` upstream). A
 * duplicate NCF surfaces as `NFC_DUPLICADO`.
 */
export async function actualizarCompraBorradorEnTx(
  tx: PrismaTx,
  ctx: TenantCtx,
  compraId: number,
  patch: {
    readonly ncf: string | null;
    readonly tipoNcf: TipoNcfCompraCore | null;
    readonly totales: CompraTotalesWrite;
  },
): Promise<{ updated: boolean }> {
  try {
    const result = await tx.compra.updateMany({
      where: {
        id: compraId,
        empresaId: ctx.empresaId,
        estado: EstadoCompra.BORRADOR,
      },
      data: {
        ncf: patch.ncf,
        tipoNcf: patch.tipoNcf ? (patch.tipoNcf as TipoNcfCompra) : null,
        subtotal: new Prisma.Decimal(patch.totales.subtotal),
        subtotalGravado: new Prisma.Decimal(patch.totales.subtotalGravado),
        itbis: new Prisma.Decimal(patch.totales.itbis),
        subtotalExento: new Prisma.Decimal(patch.totales.subtotalExento),
        retencionIsr: new Prisma.Decimal(patch.totales.retencionIsr),
        retencionItbis: new Prisma.Decimal(patch.totales.retencionItbis),
        total: new Prisma.Decimal(patch.totales.total),
      },
    });
    return { updated: result.count > 0 };
  } catch (err) {
    if (esDuplicadoNcf(err)) {
      throw new CompraDomainError(NFC_DUPLICADO, { ncf: patch.ncf });
    }
    throw err;
  }
}

/**
 * Allocate the next `CMP-%06d` for the empresa. MUST be called while the
 * `EMPRESA` row is locked. Reads the company-wide maximum numeric suffix (the
 * sucursal GUC is temporarily cleared so cross-branch purchases are all
 * counted — the empresa GUC still bounds the read); draft rows carry an empty
 * correlativo and are ignored by the trailing-digits regex.
 */
async function asignarCorrelativoSiguienteEnTx(
  tx: PrismaTx,
  empresaId: number,
  sucursalId: number,
): Promise<string> {
  // The empresa row is the durable serialization anchor for the whole company.
  await tx.$executeRaw`SELECT "id" FROM "EMPRESA" WHERE "id" = ${empresaId} FOR UPDATE`;

  // Clear ONLY the sucursal filter locally so the MAX spans every branch of
  // this empresa; the empresa boundary (app.current_empresa_id) stays enforced.
  await tx.$executeRaw`SELECT set_config('app.current_sucursal_id', '', true)`;
  const rows = await tx.$queryRaw<{ max: bigint | null }[]>`
    SELECT MAX(CAST(SUBSTRING("correlativoInterno" FROM '([0-9]+)$') AS BIGINT)) AS max
    FROM "COMPRA"
    WHERE "empresaId" = ${empresaId}`;
  // Restore the acting branch context before any further tenant-scoped write.
  await tx.$executeRaw`SELECT set_config('app.current_sucursal_id', ${String(
    sucursalId,
  )}, true)`;

  const current = rows[0]?.max ?? null;
  const next = (current === null ? 0n : BigInt(current)) + 1n;
  return `CMP-${next.toString().padStart(6, "0")}`;
}

/**
 * Guarded `BORRADOR → PENDIENTE` confirm. Allocates the correlativo (under the
 * empresa row lock), then performs ONE `UPDATE ... WHERE id AND empresaId AND
 * estado='BORRADOR'` writing `PENDIENTE`, the correlativo and the recomputed
 * totals + frozen retentions. Returns `{ confirmed: false }` when the guarded
 * predicate matched no row (a concurrent confirm/cancel won).
 */
export async function confirmarCompraEnTx(
  tx: PrismaTx,
  ctx: TenantCtx,
  compraId: number,
  totales: CompraTotalesWrite,
): Promise<{ confirmed: boolean; correlativo: string }> {
  const correlativo = await asignarCorrelativoSiguienteEnTx(
    tx,
    ctx.empresaId,
    ctx.sucursalId,
  );
  const result = await tx.compra.updateMany({
    where: {
      id: compraId,
      empresaId: ctx.empresaId,
      estado: EstadoCompra.BORRADOR,
    },
    data: {
      estado: EstadoCompra.PENDIENTE,
      correlativoInterno: correlativo,
      subtotal: new Prisma.Decimal(totales.subtotal),
      subtotalGravado: new Prisma.Decimal(totales.subtotalGravado),
      itbis: new Prisma.Decimal(totales.itbis),
      subtotalExento: new Prisma.Decimal(totales.subtotalExento),
      retencionIsr: new Prisma.Decimal(totales.retencionIsr),
      retencionItbis: new Prisma.Decimal(totales.retencionItbis),
      total: new Prisma.Decimal(totales.total),
    },
  });
  if (result.count === 0) {
    // Losing the race releases the empresa lock at commit; nothing persisted.
    return { confirmed: false, correlativo };
  }
  return { confirmed: true, correlativo };
}

/**
 * Guarded cancel to `CANCELADA` from either `BORRADOR` or `PENDIENTE`. The
 * `estado` predicate is the caller-supplied current state, so a concurrent
 * transition wins exactly once. Never frees the NCF uniqueness slot.
 */
export async function cancelarCompraEnTx(
  tx: PrismaTx,
  ctx: TenantCtx,
  compraId: number,
  desdeEstado: EstadoCompraCore,
): Promise<{ cancelled: boolean }> {
  const result = await tx.compra.updateMany({
    where: {
      id: compraId,
      empresaId: ctx.empresaId,
      estado: aPrismaEstado(desdeEstado),
    },
    data: { estado: EstadoCompra.CANCELADA },
  });
  return { cancelled: result.count > 0 };
}

/** Deterministic, tenant-scoped paginated listing (id desc tie-break). */
export async function listarComprasEnTx(
  tx: PrismaTx,
  ctx: TenantCtx,
  query: { readonly page: number; readonly limit: number },
): Promise<CompraListRow[]> {
  const rows = await tx.compra.findMany({
    where: { empresaId: ctx.empresaId },
    select: {
      id: true,
      correlativoInterno: true,
      tipoCompra: true,
      estado: true,
      ncf: true,
      total: true,
      fecha: true,
      proveedor: { select: { nombre: true } },
    },
    orderBy: [{ fecha: "desc" }, { id: "desc" }],
    skip: (query.page - 1) * query.limit,
    take: query.limit,
  });
  return rows.map((r) => ({
    id: r.id,
    correlativoInterno: r.correlativoInterno,
    tipoCompra: r.tipoCompra,
    estado: r.estado,
    ncf: r.ncf,
    total: new Prisma.Decimal(r.total).toString(),
    fecha: r.fecha,
    proveedorNombre: r.proveedor.nombre,
  }));
}

/** Total purchases for the empresa, matching the listing filter. */
export async function contarComprasEnTx(
  tx: PrismaTx,
  ctx: TenantCtx,
): Promise<number> {
  return tx.compra.count({ where: { empresaId: ctx.empresaId } });
}

/** Same-empresa detail with supplier and lines, or `null`. */
export async function obtenerCompraDetalleEnTx(
  tx: PrismaTx,
  ctx: TenantCtx,
  compraId: number,
): Promise<CompraDetalle | null> {
  const row = await tx.compra.findFirst({
    where: { id: compraId, empresaId: ctx.empresaId },
    select: {
      id: true,
      empresaId: true,
      sucursalId: true,
      correlativoInterno: true,
      tipoCompra: true,
      estado: true,
      ncf: true,
      tipoNcf: true,
      fecha: true,
      subtotal: true,
      subtotalGravado: true,
      subtotalExento: true,
      itbis: true,
      retencionIsr: true,
      retencionItbis: true,
      total: true,
      proveedor: { select: { id: true, nombre: true } },
      detalles: {
        select: {
          productoId: true,
          producto: { select: { nombre: true } },
          cantidad: true,
          costoUnitario: true,
          tasaItbis: true,
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
    correlativoInterno: row.correlativoInterno,
    tipoCompra: row.tipoCompra,
    estado: row.estado,
    ncf: row.ncf,
    tipoNcf: row.tipoNcf,
    fecha: row.fecha,
    subtotal: d(row.subtotal),
    subtotalGravado: d(row.subtotalGravado),
    subtotalExento: d(row.subtotalExento),
    itbis: d(row.itbis),
    retencionIsr: d(row.retencionIsr),
    retencionItbis: d(row.retencionItbis),
    total: d(row.total),
    proveedor: { id: row.proveedor.id, nombre: row.proveedor.nombre },
    lineas: row.detalles.map((l) => ({
      productoId: l.productoId,
      productoNombre: l.producto.nombre,
      cantidad: d(l.cantidad),
      costoUnitario: d(l.costoUnitario),
      tasaItbis: d(l.tasaItbis),
      itbisLinea: d(l.itbisLinea),
      subtotalLinea: d(l.subtotalLinea),
    })),
  };
}

/**
 * Append-only audit row for a purchase mutation. Runs inside the same tenant
 * transaction as the mutation. Reuses the frozen `AccionAuditoria` enum
 * (CREAR / ACTUALIZAR / CANCELAR); no migration for a new value.
 */
export async function registrarAuditCompraEnTx(
  tx: PrismaTx,
  ctx: TenantCtx,
  accion: AccionAuditoria,
  compraId: number,
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
      entidad: "Compra",
      idEntidad: String(compraId),
      // VarChar(255) columns — keep the JSON projections small.
      valorAnterior:
        valoresAnteriores === null ? null : JSON.stringify(valoresAnteriores),
      valorNuevo:
        valoresNuevos === null ? null : JSON.stringify(valoresNuevos),
      motivo,
    },
  });
}
