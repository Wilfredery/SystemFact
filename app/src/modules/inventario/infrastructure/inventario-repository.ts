/**
 * Inventario repository — the ONLY place in the module that touches Prisma.
 *
 * Tenant isolation strategy (frozen schema, no migration):
 *   - `INVENTARIO` has no own `empresaId`; its only tenant anchor is
 *     `sucursalId`. Every read/write therefore filters through the
 *     `sucursal.empresaId` navigation AND the current `sucursalId`, per the
 *     convention documented in `tenant/domain/tenant.ts`.
 *   - `MOVIMIENTO_INVENTARIO` is a child of a single inventory row, so it is
 *     scoped implicitly via its `inventarioId` (already tenant-checked).
 *
 * Concurrency (design "Concurrent mutation"): the manual adjustment locks the
 * exact `(sucursalId, productoId)` row with `SELECT ... FOR UPDATE`, reads the
 * authoritative quantity, applies a verified non-negative update, then appends
 * the movement + audit rows — all inside the caller's single `PrismaTx`, so the
 * whole effect commits or rolls back atomically.
 */

import {
  Prisma,
  AccionAuditoria,
  TipoMovimiento,
  TipoReposicion,
} from "@/generated/prisma/client";
import { Decimal } from "decimal.js";
import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import {
  CANTIDAD_INVALIDA,
  INVENTARIO_NO_ENCONTRADO,
  STOCK_INSUFICIENTE,
  STOCK_INSUFICIENTE_BLOQUEO,
  InventarioDomainError,
} from "../domain/errors";
import { calcularNuevoCostoPromedioPorValor } from "../domain/costo-promedio";
import type {
  InventarioStockRow,
  InventorySource,
} from "../domain/inventario";

export interface ListarInventarioQuery {
  readonly page: number;
  readonly limit: number;
}

/** Shape of the atomic manual-adjustment request handed to the repository. */
export interface AjustarStockEnTxInput {
  readonly productoId: number;
  /** Signed delta as a decimal string (negative reduces stock). */
  readonly delta: string;
  readonly motivo: string;
  readonly source: InventorySource;
}

/** Authoritative before/after snapshot after a movement commits. */
export interface MovimientoAplicado {
  readonly inventoryId: number;
  readonly previousQuantity: string;
  readonly newQuantity: string;
}

/**
 * Tenant-scoped `where` for `INVENTARIO`: company via `sucursal.empresaId`
 * navigation plus the concrete branch. `MOVIMIENTO_INVENTARIO` history reuses
 * the same anchor through its `inventario` relation.
 */
function inventarioTenantWhere(ctx: TenantCtx): Prisma.InventarioWhereInput {
  return {
    sucursalId: ctx.sucursalId,
    sucursal: { empresaId: ctx.empresaId },
  };
}

const inventarioRowSelect = {
  id: true,
  productoId: true,
  cantidad: true,
  producto: { select: { codigo: true, nombre: true, stockMinimo: true } },
} satisfies Prisma.InventarioSelect;

type InventarioRow = Prisma.InventarioGetPayload<{
  select: typeof inventarioRowSelect;
}>;

function toStockRow(row: InventarioRow): InventarioStockRow {
  return {
    inventarioId: row.id,
    productoId: row.productoId,
    codigo: row.producto.codigo,
    nombre: row.producto.nombre,
    cantidad: new Prisma.Decimal(row.cantidad).toString(),
    stockMinimo: row.producto.stockMinimo,
  };
}

/**
 * Paginated, tenant-scoped stock listing. Stable ordering: product code asc,
 * tie-broken by the inventory id so two rows with an identical code across
 * branches cannot interleave differently between pages.
 */
export async function listarInventarioEnTx(
  tx: PrismaTx,
  ctx: TenantCtx,
  query: ListarInventarioQuery,
): Promise<InventarioStockRow[]> {
  const rows = await tx.inventario.findMany({
    where: inventarioTenantWhere(ctx),
    select: inventarioRowSelect,
    orderBy: [{ producto: { codigo: "asc" } }, { id: "asc" }],
    skip: (query.page - 1) * query.limit,
    take: query.limit,
  });
  return rows.map(toStockRow);
}

/** Total rows for the branch's tenant scope, matching the listing filter. */
export async function contarInventarioEnTx(
  tx: PrismaTx,
  ctx: TenantCtx,
): Promise<number> {
  return tx.inventario.count({ where: inventarioTenantWhere(ctx) });
}

/**
 * Tenant-scoped single-inventory fetch by product. Returns the row id and its
 * current quantity, or `null` when no inventory exists for that product in the
 * caller's branch. Used to confirm an inventory belongs to the tenant before
 * any adjustment.
 */
export async function obtenerInventarioPorProductoEnTx(
  tx: PrismaTx,
  ctx: TenantCtx,
  productoId: number,
): Promise<{ inventarioId: number; cantidad: string } | null> {
  const row = await tx.inventario.findFirst({
    where: { ...inventarioTenantWhere(ctx), productoId },
    select: { id: true, cantidad: true },
  });
  if (row === null) return null;
  return { inventarioId: row.id, cantidad: new Prisma.Decimal(row.cantidad).toString() };
}

/**
 * Product ownership guard: a PRODUCTO row must belong to the caller's company
 * before an adjustment may create or touch its inventory. This blocks a
 * cross-tenant `productoId` from producing an inventory row under a foreign
 * product (which would otherwise satisfy only the FK, not the tenant).
 */
async function productoExisteEnEmpresa(
  tx: PrismaTx,
  empresaId: number,
  productoId: number,
): Promise<boolean> {
  const row = await tx.producto.findFirst({
    where: { id: productoId, empresaId },
    select: { id: true },
  });
  return row !== null;
}

/**
 * Shared Phase-A ownership guard for every batch path: each product id must
 * belong to `ctx.empresaId` before any lock or write. The FIRST foreign product
 * throws `INVENTARIO_NO_ENCONTRADO`, so a cross-tenant batch persists zero
 * changes. Read-only with respect to the ledger — it never mutates stock, so a
 * batch may call it freely before its own lock/write phases. Only this shared
 * read is deduplicated: each batch (entrada / salida / reposición / devolución)
 * keeps its OWN skeleton and ordering; entrances vs exits are never merged
 * (R-QC-05). The single-product adjustment reuses it with a one-element list so
 * the throw context (`{ productoId }`) stays byte-identical.
 */
async function guardarPertenenciaProductosEnTx(
  tx: PrismaTx,
  ctx: TenantCtx,
  productoIds: readonly number[],
): Promise<void> {
  for (const productoId of productoIds) {
    const existe = await productoExisteEnEmpresa(tx, ctx.empresaId, productoId);
    if (!existe) {
      throw new InventarioDomainError(INVENTARIO_NO_ENCONTRADO, { productoId });
    }
  }
}

/**
 * Append-only audit row for ANY inventory stock change, the single emit shared
 * by the three former per-path helpers. `accion` is the only variable: the
 * manual adjustment logs `AJUSTAR`, a purchase entry logs `CREAR` (a new
 * inbound), and a sale-exit / reposition / devolución logs `ACTUALIZAR`. Runs
 * inside the same transaction as the mutation, so a rolled-back change rolls
 * this back too. `entidad`/`idEntidad` are fixed to the Inventario row.
 */
async function registrarAuditoriaStockEnTx(
  tx: PrismaTx,
  ctx: TenantCtx,
  inventarioId: number,
  anterior: string,
  nueva: string,
  motivo: string,
  accion: AccionAuditoria,
): Promise<void> {
  await tx.movimientoAuditoria.create({
    data: {
      empresaId: ctx.empresaId,
      sucursalId: ctx.sucursalId,
      usuarioId: ctx.usuarioId,
      fechaHora: new Date(),
      accion,
      entidad: "Inventario",
      idEntidad: String(inventarioId),
      valorAnterior: anterior,
      valorNuevo: nueva,
      motivo,
    },
  });
}

/**
 * Atomic, row-locked manual adjustment. Steps — all inside the supplied tx:
 *   1. reject a product outside the tenant (`INVENTARIO_NO_ENCONTRADO`);
 *   2. guarantee the branch's inventory row exists (upsert a zero row);
 *   3. `SELECT ... FOR UPDATE` to serialize concurrent same-row adjustments;
 *   4. compute next = current + delta and reject an exit below zero
 *      (`STOCK_INSUFICIENTE`);
 *   5. update the quantity, then append the immutable `AJUSTE` movement and the
 *      audit row.
 *
 * `costoPromedio` is never read or written here (3.4a boundary).
 *
 * @throws InventarioDomainError(STOCK_INSUFICIENTE | INVENTARIO_NO_ENCONTRADO)
 */
export async function ajustarStockEnTx(
  tx: PrismaTx,
  ctx: TenantCtx,
  input: AjustarStockEnTxInput,
): Promise<MovimientoAplicado> {
  await guardarPertenenciaProductosEnTx(tx, ctx, [input.productoId]);

  // Ensure the per-branch row exists before locking it; a first-time
  // adjustment on a fresh product starts from a zero quantity.
  const ensured = await tx.inventario.upsert({
    where: {
      sucursalId_productoId: {
        sucursalId: ctx.sucursalId,
        productoId: input.productoId,
      },
    },
    update: {},
    create: {
      sucursalId: ctx.sucursalId,
      productoId: input.productoId,
      cantidad: new Prisma.Decimal(0),
    },
    select: { id: true },
  });

  // Serialize on the exact row and read the authoritative current quantity.
  const locked = await tx.$queryRaw<
    { cantidad: Prisma.Decimal }[]
  >`SELECT "cantidad" FROM "INVENTARIO" WHERE "id" = ${ensured.id} FOR UPDATE`;

  if (locked.length === 0) {
    throw new InventarioDomainError(INVENTARIO_NO_ENCONTRADO, {
      inventarioId: ensured.id,
    });
  }

  const anterior = new Decimal(locked[0].cantidad.toString());
  const delta = new Decimal(input.delta);
  const nueva = anterior.plus(delta);

  // Non-negative invariant — reject the exit WITHOUT writing anything; the
  // surrounding transaction rolls back the upsert of a freshly-created row too.
  if (nueva.isNegative()) {
    throw new InventarioDomainError(STOCK_INSUFICIENTE, {
      inventarioId: ensured.id,
      disponible: anterior.toFixed(3),
      pretendida: delta.toString(),
    });
  }

  await tx.inventario.update({
    where: { id: ensured.id },
    data: { cantidad: new Prisma.Decimal(nueva) },
  });

  await tx.movimientoInventario.create({
    data: {
      inventarioId: ensured.id,
      tipoMovimiento: TipoMovimiento.AJUSTE,
      motivo: input.motivo,
      cantidadMovida: new Prisma.Decimal(delta),
      cantidadAnterior: new Prisma.Decimal(anterior),
      cantidadNueva: new Prisma.Decimal(nueva),
      usuarioId: ctx.usuarioId,
      fecha: new Date(),
    },
  });

  await registrarAuditoriaStockEnTx(
    tx,
    ctx,
    ensured.id,
    anterior.toFixed(3),
    nueva.toFixed(3),
    input.motivo,
    AccionAuditoria.AJUSTAR,
  );

  return {
    inventoryId: ensured.id,
    previousQuantity: anterior.toFixed(3),
    newQuantity: nueva.toFixed(3),
  };
}

// ---------------------------------------------------------------------------
// 3.4b purchase-entry path — fase-3-4b PR-1 (inventario side realization).
// ---------------------------------------------------------------------------

/** One received purchase line for the entry batch. */
export interface EntradaCompraLinea {
  readonly productoId: number;
  /** Positive received quantity (a `Decimal(12,3)` string). */
  readonly cantidad: string;
  /** Unit cost EXCLUDING ITBIS (a `Decimal(12,2)` string), frozen at confirm. */
  readonly costoUnitarioSinItbis: string;
}

export interface RegistrarEntradasCompraInput {
  readonly compraId: number;
  readonly motivo: string;
  readonly lineas: readonly EntradaCompraLinea[];
}

/** A movement applied for one entry line, tagged with its product. */
export interface EntradaMovimientoAplicado extends MovimientoAplicado {
  readonly productoId: number;
}

/**
 * Company-wide (all-branch) stock for one product inside the tenant.
 *
 * RLS NARROWING NOTE: `PRODUCTO.costoPromedio` is a single company-wide column,
 * so the weighted-average DENOMINATOR must sum stock across ALL branches — but
 * the `INVENTARIO` RLS policy hides rows outside the session branch while
 * `app.current_sucursal_id` is bound. We widen the SUCURSAL GUC *transaction-
 * locally for this aggregate READ ONLY* (`set_config(..., true)`, immediately
 * restored), still anchored on the SAME `empresaId` so a cross-tenant row is
 * never visible. Every subsequent ENTRY WRITE keeps the session-branch GUC, so
 * stock is still landed only at `ctx.sucursalId` (spec: "entries target only
 * the session-authorized branch"). This read-scoping does not redirect any
 * entry to another branch; the alternative (a SECURITY DEFINER aggregate) is a
 * schema migration, which this change forbids.
 *
 * RATIFIED against the shipped RLS design: the `inventario_isolation` policy
 * (migration 20260902120000_enable_rls) deliberately allows an EMPTY sucursal
 * GUC — `COALESCE(...,'') = '' OR s.id = ...` — while always pinning
 * `app.current_empresa_id`. This transaction-local widen only enters that
 * intended all-branches-within-empresa case for a read-only aggregate and is
 * restored in `finally` before any branch-scoped write, so no unanchored
 * window exists.
 */
async function stockTotalEmpresaEnTx(
  tx: PrismaTx,
  ctx: TenantCtx,
  productoId: number,
): Promise<Decimal> {
  await tx.$executeRaw`SELECT set_config('app.current_sucursal_id', '', true)`;
  try {
    const rows = await tx.$queryRaw<{ total: string | null }[]>`
      SELECT SUM(i."cantidad")::text AS total
      FROM "INVENTARIO" i
      JOIN "SUCURSAL" s ON s."id" = i."sucursalId"
      WHERE i."productoId" = ${productoId}
        AND s."empresaId" = ${ctx.empresaId}`;
    return new Decimal(rows[0]?.total ?? "0");
  } finally {
    await tx.$executeRaw`SELECT set_config('app.current_sucursal_id', ${String(ctx.sucursalId)}, true)`;
  }
}

/**
 * Lock the PRODUCTO row (`SELECT ... FOR UPDATE`, empresa-scoped) and return its
 * current `costoPromedio`. The lock serializes competing receipts of the same
 * product so the final cost equals sequential application (no lost update).
 *
 * @throws InventarioDomainError(INVENTARIO_NO_ENCONTRADO) if the product is
 *   outside the tenant (also the cross-tenant rejection for this path).
 */
async function bloquearProductoEnTx(
  tx: PrismaTx,
  ctx: TenantCtx,
  productoId: number,
): Promise<Decimal> {
  const rows = await tx.$queryRaw<{ costoPromedio: string }[]>`
    SELECT "costoPromedio"::text AS "costoPromedio"
    FROM "PRODUCTO"
    WHERE "id" = ${productoId} AND "empresaId" = ${ctx.empresaId}
    FOR UPDATE`;
  if (rows.length === 0) {
    throw new InventarioDomainError(INVENTARIO_NO_ENCONTRADO, { productoId });
  }
  return new Decimal(rows[0].costoPromedio);
}

/**
 * Add one positive quantity to the session branch's inventory row, append the
 * immutable `ENTRADA_COMPRA` movement (carrying `compraId`) and the audit row.
 * The branch row is guaranteed to exist (upsert a zero row) and locked with
 * `SELECT ... FOR UPDATE` before the write, mirroring the manual-adjust path.
 */
async function aplicarEntradaStockLineaEnTx(
  tx: PrismaTx,
  ctx: TenantCtx,
  linea: EntradaCompraLinea,
  compraId: number,
  motivo: string,
): Promise<MovimientoAplicado> {
  const ensured = await tx.inventario.upsert({
    where: {
      sucursalId_productoId: { sucursalId: ctx.sucursalId, productoId: linea.productoId },
    },
    update: {},
    create: {
      sucursalId: ctx.sucursalId,
      productoId: linea.productoId,
      cantidad: new Prisma.Decimal(0),
    },
    select: { id: true },
  });

  const locked = await tx.$queryRaw<{ cantidad: Prisma.Decimal }[]>`
    SELECT "cantidad" FROM "INVENTARIO" WHERE "id" = ${ensured.id} FOR UPDATE`;
  if (locked.length === 0) {
    throw new InventarioDomainError(INVENTARIO_NO_ENCONTRADO, {
      inventarioId: ensured.id,
    });
  }

  const anterior = new Decimal(locked[0].cantidad.toString());
  const recibida = new Decimal(linea.cantidad);
  // An entry is always additive; only strictly positive quantities may touch
  // the ledger — a zero quantity is not a stock change and a negative line
  // would corrupt it. Checks `lessThanOrEqualTo(0)` explicitly: decimal.js
  // `isPositive()` is sign-based and returns true for zero, so `!isPositive()`
  // would NOT reject `"0.000"` (see devolucion/domain/devolucion.ts note).
  // Rejected before any write (the manual non-negative invariant never applies
  // here because entries only ever increase stock).
  if (recibida.lessThanOrEqualTo(0)) {
    throw new InventarioDomainError(CANTIDAD_INVALIDA, {
      productoId: linea.productoId,
    });
  }
  const nueva = anterior.plus(recibida);

  await tx.inventario.update({
    where: { id: ensured.id },
    data: { cantidad: new Prisma.Decimal(nueva) },
  });

  await tx.movimientoInventario.create({
    data: {
      inventarioId: ensured.id,
      tipoMovimiento: TipoMovimiento.ENTRADA_COMPRA,
      compraId,
      motivo,
      cantidadMovida: new Prisma.Decimal(recibida),
      cantidadAnterior: new Prisma.Decimal(anterior),
      cantidadNueva: new Prisma.Decimal(nueva),
      usuarioId: ctx.usuarioId,
      fecha: new Date(),
    },
  });

  await registrarAuditoriaStockEnTx(
    tx,
    ctx,
    ensured.id,
    anterior.toFixed(3),
    nueva.toFixed(3),
    motivo,
    AccionAuditoria.CREAR,
  );

  return {
    inventoryId: ensured.id,
    previousQuantity: anterior.toFixed(3),
    newQuantity: nueva.toFixed(3),
  };
}

/**
 * Atomic purchase-receipt entry for a batch of lines, all inside the caller's
 * `PrismaTx` (the surrounding `withTenantTransaction` supplies rollback). Three
 * ordered phases guarantee that a rejected line changes NOTHING:
 *
 *   A. TENANT GUARD — every distinct product must belong to `ctx.empresaId`;
 *      the first foreign product throws `INVENTARIO_NO_ENCONTRADO` before any
 *      write, so a cross-tenant batch produces zero changes.
 *   B. COST — per product in ASCENDING product-id order (deterministic, avoids
 *      cross-tx deadlock): lock `PRODUCTO` (`FOR UPDATE`), read the company-wide
 *      (all-branch) pre-receipt stock, and write ONE `costoPromedio` update per
 *      product using the aggregate received quantity + ITBIS-exclusive value
 *      (duplicate lines accumulate into a single, drift-free cost reweight).
 *   C. STOCK — per original line, add the positive quantity at the session
 *      branch (row-locked), append one `ENTRADA_COMPRA` movement carrying
 *      `compraId` (before/after), and the audit row. One movement per line.
 *
 * `costoPromedio` is updated HERE and ONLY here on the purchase path; the manual
 * adjustment path (`ajustarStockEnTx`) still never touches it (3.4a boundary).
 */
export async function registrarEntradasCompraEnTx(
  tx: PrismaTx,
  ctx: TenantCtx,
  input: RegistrarEntradasCompraInput,
): Promise<EntradaMovimientoAplicado[]> {
  if (input.lineas.length === 0) {
    return [];
  }

  // Aggregate received quantity and ITBIS-exclusive VALUE per product for the
  // single cost update; reject a negative line magnitude up front (pure check,
  // no DB touch).
  const porProducto = new Map<
    number,
    { cantidad: Decimal; valor: Decimal }
  >();
  for (const linea of input.lineas) {
    const cantidad = new Decimal(linea.cantidad);
    // lessThanOrEqualTo(0), not !isPositive(): decimal.js isPositive() is
    // sign-based and accepts zero (devolucion domain documents this gotcha).
    if (cantidad.lessThanOrEqualTo(0)) {
      throw new InventarioDomainError(CANTIDAD_INVALIDA, {
        productoId: linea.productoId,
      });
    }
    const previo =
      porProducto.get(linea.productoId) ??
      { cantidad: new Decimal(0), valor: new Decimal(0) };
    porProducto.set(linea.productoId, {
      cantidad: previo.cantidad.plus(cantidad),
      valor: previo.valor.plus(cantidad.times(new Decimal(linea.costoUnitarioSinItbis))),
    });
  }

  const idsOrdenados = [...porProducto.keys()].sort((a, b) => a - b);

  // Phase A: ownership guard for every product BEFORE any write.
  await guardarPertenenciaProductosEnTx(tx, ctx, idsOrdenados);

  // Phase B: locked, company-wide weighted-average cost — one update per product.
  for (const productoId of idsOrdenados) {
    const cpActual = await bloquearProductoEnTx(tx, ctx, productoId);
    const stockPrevio = await stockTotalEmpresaEnTx(tx, ctx, productoId);
    const acc = porProducto.get(productoId)!;
    const nuevoCP = calcularNuevoCostoPromedioPorValor({
      stockTotalEmpresa: stockPrevio.toFixed(3),
      costoPromedio: cpActual.toFixed(2),
      cantidadRecibida: acc.cantidad.toFixed(3),
      valorRecibidoSinItbis: acc.valor.toFixed(2),
    });
    await tx.producto.update({
      where: { id: productoId },
      data: { costoPromedio: new Prisma.Decimal(nuevoCP) },
    });
  }

  // Phase C: per-line branch stock + ENTRADA_COMPRA movement + audit.
  const resultados: EntradaMovimientoAplicado[] = [];
  for (const linea of input.lineas) {
    const mov = await aplicarEntradaStockLineaEnTx(
      tx,
      ctx,
      linea,
      input.compraId,
      input.motivo,
    );
    resultados.push({ ...mov, productoId: linea.productoId });
  }
  return resultados;
}

// ---------------------------------------------------------------------------
// 5c Phase 3 — confirmed-sale exit batch and cancellation reposition batch.
// Both mirror the three-phase purchase-entry ordering (ownership guard →
// deterministic ascending-product-id row locks → per-line movement + audit)
// but operate on the session branch's INVENTARIO row directly and NEVER touch
// `costoPromedio` (exits and reposition are replenish-only; average cost is a
// purchase-path concern — inventario spec "Schema and cost boundary").
// ---------------------------------------------------------------------------

/** One sale-exit / reposition line: which product and how many units. */
export interface SalidaVentaLinea {
  readonly productoId: number;
  /** Positive magnitude (a `Decimal(12,3)` string); the sign is the port's job. */
  readonly cantidad: string;
}

export interface RegistrarSalidasVentaEnTxInput {
  readonly ventaId: number;
  /** Audit reason carried on every generated movement. */
  readonly motivo: string;
  readonly lineas: readonly SalidaVentaLinea[];
}

/** A movement applied for one exit/reposition line, tagged with its product. */
export interface SalidaMovimientoAplicado extends MovimientoAplicado {
  readonly productoId: number;
}

/**
 * Upsert the session branch's INVENTARIO row for a product (zero row if new)
 * and lock it with `SELECT ... FOR UPDATE`, returning the authoritative current
 * quantity. The lock is held to the end of the transaction, so the running
 * balance maintained by the batch is race-free against a concurrent confirm
 * touching the SAME product/branch.
 *
 * Exported so the devolucion module (task 1.3) can acquire the SAME row lock
 * as its pre-cumulative-read serialization point: the credit-note cumulative
 * cap is only race-free if the stock row is locked BEFORE the prior-NC read,
 * and re-locking in `registrarDevolucionEnTx` is a no-op inside the same
 * transaction. Lock order stays ascending-product-id everywhere, so a
 * concurrent confirm and a concurrent devolucion can never deadlock.
 */
export async function bloquearInventarioSucursalEnTx(
  tx: PrismaTx,
  ctx: TenantCtx,
  productoId: number,
): Promise<{ inventarioId: number; cantidad: Decimal }> {
  const ensured = await tx.inventario.upsert({
    where: {
      sucursalId_productoId: { sucursalId: ctx.sucursalId, productoId },
    },
    update: {},
    create: {
      sucursalId: ctx.sucursalId,
      productoId,
      cantidad: new Prisma.Decimal(0),
    },
    select: { id: true },
  });

  const locked = await tx.$queryRaw<{ cantidad: Prisma.Decimal }[]>`
    SELECT "cantidad" FROM "INVENTARIO" WHERE "id" = ${ensured.id} FOR UPDATE`;
  if (locked.length === 0) {
    throw new InventarioDomainError(INVENTARIO_NO_ENCONTRADO, {
      inventarioId: ensured.id,
    });
  }
  return {
    inventarioId: ensured.id,
    cantidad: new Decimal(locked[0].cantidad.toString()),
  };
}

/** Aggregate requested quantity per product; reject a non-positive magnitude. */
function agruparDemandaPositiva(
  lineas: readonly SalidaVentaLinea[],
): Map<number, Decimal> {
  const porProducto = new Map<number, Decimal>();
  for (const l of lineas) {
    const q = new Decimal(l.cantidad);
    // lessThanOrEqualTo(0), not !isPositive(): decimal.js isPositive() is
    // sign-based and accepts zero (devolucion domain documents this gotcha).
    if (q.lessThanOrEqualTo(0)) {
      throw new InventarioDomainError(CANTIDAD_INVALIDA, { productoId: l.productoId });
    }
    porProducto.set(
      l.productoId,
      (porProducto.get(l.productoId) ?? new Decimal(0)).plus(q),
    );
  }
  return porProducto;
}

/**
 * Atomic confirmed-sale exit batch. Every effect rolls back with the caller's
 * confirm transaction (no nested transaction). Three ordered phases guarantee
 * that a shortage rejects the WHOLE batch and changes NOTHING:
 *
 *   A. TENANT GUARD — each distinct product must belong to `ctx.empresaId`; the
 *      first foreign product throws `INVENTARIO_NO_ENCONTRADO` before any lock
 *      or write, so a cross-tenant batch persists zero changes.
 *   B. HARD AVAILABILITY — per product in ASCENDING product-id order (same lock
 *      order as the entry batch, so a concurrent confirm and exit can never
 *      deadlock): upsert + `SELECT ... FOR UPDATE` the branch row and reject
 *      with `STOCK_INSUFICIENTE_BLOQUEO` {productoId, available, requested}
 *      when the aggregate requested exceeds the (now-locked) availability.
 *      Negatives are impossible by construction.
 *   C. DEBIT — per line, reduce the running balance, append ONE immutable
 *      `SALIDA_VENTA` movement carrying `ventaId` (negative delta, before/after)
 *      and the audit row. `costoPromedio` is never read or written here.
 *
 * @throws InventarioDomainError(INVENTARIO_NO_ENCONTRADO | STOCK_INSUFICIENTE_BLOQUEO | CANTIDAD_INVALIDA)
 */
export async function registrarSalidasVentaEnTx(
  tx: PrismaTx,
  ctx: TenantCtx,
  input: RegistrarSalidasVentaEnTxInput,
): Promise<SalidaMovimientoAplicado[]> {
  if (input.lineas.length === 0) return [];

  const demanda = agruparDemandaPositiva(input.lineas);
  const idsOrdenados = [...demanda.keys()].sort((a, b) => a - b);

  // Phase A: ownership guard for every product before any lock/write.
  await guardarPertenenciaProductosEnTx(tx, ctx, idsOrdenados);

  // Phase B: lock the branch row and HARD-verify availability (throw on reject).
  const bloqueados = new Map<number, { inventarioId: number; restante: Decimal }>();
  for (const productoId of idsOrdenados) {
    const { inventarioId, cantidad } = await bloquearInventarioSucursalEnTx(
      tx,
      ctx,
      productoId,
    );
    const pedida = demanda.get(productoId)!;
    if (cantidad.lessThan(pedida)) {
      throw new InventarioDomainError(STOCK_INSUFICIENTE_BLOQUEO, {
        productoId,
        available: cantidad.toFixed(3),
        requested: pedida.toFixed(3),
      });
    }
    bloqueados.set(productoId, { inventarioId, restante: cantidad });
  }

  // Phase C: per-line debit + one SALIDA_VENTA movement + audit. Never cost.
  const resultados: SalidaMovimientoAplicado[] = [];
  for (const linea of input.lineas) {
    const estado = bloqueados.get(linea.productoId)!;
    const pedida = new Decimal(linea.cantidad);
    const anterior = estado.restante;
    const nueva = anterior.minus(pedida);
    // Belt-and-suspenders: Phase B proved the aggregate fits; a negative here
    // would be a logic defect, so block rather than persist an impossible row.
    if (nueva.isNegative()) {
      throw new InventarioDomainError(STOCK_INSUFICIENTE_BLOQUEO, {
        productoId: linea.productoId,
        available: anterior.toFixed(3),
        requested: pedida.toFixed(3),
      });
    }
    estado.restante = nueva;

    await tx.inventario.update({
      where: { id: estado.inventarioId },
      data: { cantidad: new Prisma.Decimal(nueva) },
    });
    await tx.movimientoInventario.create({
      data: {
        inventarioId: estado.inventarioId,
        ventaId: input.ventaId,
        tipoMovimiento: TipoMovimiento.SALIDA_VENTA,
        motivo: input.motivo,
        cantidadMovida: new Prisma.Decimal(pedida.negated()),
        cantidadAnterior: new Prisma.Decimal(anterior),
        cantidadNueva: new Prisma.Decimal(nueva),
        usuarioId: ctx.usuarioId,
        fecha: new Date(),
      },
    });
    await registrarAuditoriaStockEnTx(
      tx,
      ctx,
      estado.inventarioId,
      anterior.toFixed(3),
      nueva.toFixed(3),
      input.motivo,
      AccionAuditoria.ACTUALIZAR,
    );
    resultados.push({
      inventoryId: estado.inventarioId,
      previousQuantity: anterior.toFixed(3),
      newQuantity: nueva.toFixed(3),
      productoId: linea.productoId,
    });
  }
  return resultados;
}

/**
 * Cancellation reposition batch — the inverse of {@link registrarSalidasVentaEnTx}
 * for a confirmed sale being cancelled. Same ownership guard and the SAME
 * ascending-product-id lock order (so a cancel can never deadlock against a
 * concurrent confirm on the same branch), but the delta is POSITIVE: stock is
 * credited and one `REPOSICION_CANCELACION` movement carrying `ventaId`
 * (before/after) is appended per line. There is no availability check — adding
 * stock cannot go negative. Like the exit path it NEVER touches `costoPromedio`
 * (replenish only). A reposition with zero lines is a no-op.
 *
 * @throws InventarioDomainError(INVENTARIO_NO_ENCONTRADO | CANTIDAD_INVALIDA)
 */
export async function registrarReposicionCancelacionEnTx(
  tx: PrismaTx,
  ctx: TenantCtx,
  input: RegistrarSalidasVentaEnTxInput,
): Promise<SalidaMovimientoAplicado[]> {
  if (input.lineas.length === 0) return [];

  const acumulada = agruparDemandaPositiva(input.lineas);
  const idsOrdenados = [...acumulada.keys()].sort((a, b) => a - b);

  // Phase A: ownership guard before any lock/write.
  await guardarPertenenciaProductosEnTx(tx, ctx, idsOrdenados);

  // Phase B/C: lock each branch row (ascending), then credit + movement per line.
  const bloqueados = new Map<number, { inventarioId: number; actual: Decimal }>();
  for (const productoId of idsOrdenados) {
    const { inventarioId, cantidad } = await bloquearInventarioSucursalEnTx(
      tx,
      ctx,
      productoId,
    );
    bloqueados.set(productoId, { inventarioId, actual: cantidad });
  }

  const resultados: SalidaMovimientoAplicado[] = [];
  for (const linea of input.lineas) {
    const estado = bloqueados.get(linea.productoId)!;
    const cantidad = new Decimal(linea.cantidad);
    const anterior = estado.actual;
    const nueva = anterior.plus(cantidad);
    estado.actual = nueva;

    await tx.inventario.update({
      where: { id: estado.inventarioId },
      data: { cantidad: new Prisma.Decimal(nueva) },
    });
    await tx.movimientoInventario.create({
      data: {
        inventarioId: estado.inventarioId,
        ventaId: input.ventaId,
        tipoMovimiento: TipoMovimiento.REPOSICION_CANCELACION,
        motivo: input.motivo,
        cantidadMovida: new Prisma.Decimal(cantidad),
        cantidadAnterior: new Prisma.Decimal(anterior),
        cantidadNueva: new Prisma.Decimal(nueva),
        usuarioId: ctx.usuarioId,
        fecha: new Date(),
      },
    });
    await registrarAuditoriaStockEnTx(
      tx,
      ctx,
      estado.inventarioId,
      anterior.toFixed(3),
      nueva.toFixed(3),
      input.motivo,
      AccionAuditoria.ACTUALIZAR,
    );
    resultados.push({
      inventoryId: estado.inventarioId,
      previousQuantity: anterior.toFixed(3),
      newQuantity: nueva.toFixed(3),
      productoId: linea.productoId,
    });
  }
  return resultados;
}

// ---------------------------------------------------------------------------
// fase-5d — B04 credit-note stock effect (devolucion seam, design D5).
// One movement per returned line under the SAME ascending-product-id lock
// order as the exit/entry batches: VENDIBLE restock is a positive
// ENTRADA_DEVOLUCION delta, DANADO disposal is a negative SALIDA_MERMA delta
// with the same hard shortage block as the sale exit. `notaCreditoId` links
// every movement to its NC; `costoPromedio` is untouched (replenish only).
// A product may appear in SEVERAL lines with MIXED reposicion — each line
// mutates the running balance in input order, and a DANADO shortage throws so
// the caller's transaction rolls back every prior line's movement with the NC.
// ---------------------------------------------------------------------------

/** One returned unit line: product, positive magnitude, disposal class. */
export interface DevolucionLineaEnTx {
  readonly productoId: number;
  /** Positive magnitude (a `Decimal(12,3)` string); the sign is the port's job. */
  readonly cantidad: string;
  /** `VENDIBLE` restocks stock; `DANADO` disposes it as merma (never re-sold). */
  readonly tipoReposicion: TipoReposicion;
}

export interface RegistrarDevolucionEnTxInput {
  /** The NC backing this return (written to `MovimientoInventario.notaCreditoId`). */
  readonly notaCreditoId: number;
  /** Audit reason carried on every generated movement. */
  readonly motivo: string;
  readonly lineas: readonly DevolucionLineaEnTx[];
}

/** The movement each reposicion class maps to (frozen enum to frozen enum). */
const MOVIMIENTO_POR_REPOSICION: Record<TipoReposicion, TipoMovimiento> = {
  [TipoReposicion.VENDIBLE]: TipoMovimiento.ENTRADA_DEVOLUCION,
  [TipoReposicion.DANADO]: TipoMovimiento.SALIDA_MERMA,
};

/**
 * B04 credit-note stock effect — the devolucion seam. One movement per line
 * under the SAME determinism as the other batches:
 *
 *   A. TENANT GUARD — every product must belong to `ctx.empresaId`; the first
 *      foreign product throws `INVENTARIO_NO_ENCONTRADO` before any lock/write.
 *   B. LOCKS — per DISTINCT product, ascending product-id order, upsert +
 *      `SELECT ... FOR UPDATE` (identical to the exit/entry lock order, so a
 *      devolucion can never deadlock against a concurrent confirm).
 *   C. APPLY — per line, `VENDIBLE` credits the running balance (positive
 *      `ENTRADA_DEVOLUCION` movement, cannot go negative) and `DANADO` debits it
 *      (negative `SALIDA_MERMA` movement, hard `STOCK_INSUFICIENTE_BLOQUEO`
 *      block so a damaged return of more units than held can never persist).
 *      Every movement carries `notaCreditoId` + before/after; a DANADO shortage
 *      THROWS so the enclosing devolucion transaction rolls back the NC, the
 *      NCF and every already-applied line together.
 *
 * Unlike the sale exit there is NO aggregate pre-check phase: mixed
 * VENDIBLE/DANADO lines for one product have no aggregate "demand", and the
 * per-line hard block inside the same transaction yields the same
 * all-or-nothing guarantee (a rejected line rolls back prior writes).
 *
 * @throws InventarioDomainError(INVENTARIO_NO_ENCONTRADO | STOCK_INSUFICIENTE_BLOQUEO | CANTIDAD_INVALIDA)
 */
export async function registrarDevolucionEnTx(
  tx: PrismaTx,
  ctx: TenantCtx,
  input: RegistrarDevolucionEnTxInput,
): Promise<SalidaMovimientoAplicado[]> {
  if (input.lineas.length === 0) return [];

  const idsOrdenados = [...new Set(input.lineas.map((l) => l.productoId))].sort(
    (a, b) => a - b,
  );

  // Phase A: ownership guard for every product before any lock/write.
  await guardarPertenenciaProductosEnTx(tx, ctx, idsOrdenados);

  // Phase B: lock each branch row (ascending).
  const bloqueados = new Map<number, { inventarioId: number; actual: Decimal }>();
  for (const productoId of idsOrdenados) {
    const { inventarioId, cantidad } = await bloquearInventarioSucursalEnTx(
      tx,
      ctx,
      productoId,
    );
    bloqueados.set(productoId, { inventarioId, actual: cantidad });
  }

  // Phase C: per-line credit/debit + one movement + audit. Never cost.
  const resultados: SalidaMovimientoAplicado[] = [];
  for (const linea of input.lineas) {
    const estado = bloqueados.get(linea.productoId)!;
    const cantidad = new Decimal(linea.cantidad);
    const movimiento = MOVIMIENTO_POR_REPOSICION[linea.tipoReposicion];
    if (movimiento === undefined) {
      // A reposicion class outside the frozen enum is an invalid line, never a
      // valid disposal: fail before persisting an impossible movement.
      throw new InventarioDomainError(CANTIDAD_INVALIDA, {
        productoId: linea.productoId,
      });
    }

    const anterior = estado.actual;
    const esMerma = movimiento === TipoMovimiento.SALIDA_MERMA;
    const delta = esMerma ? cantidad.negated() : cantidad;
    const nueva = anterior.plus(delta);
    if (nueva.isNegative()) {
      throw new InventarioDomainError(STOCK_INSUFICIENTE_BLOQUEO, {
        productoId: linea.productoId,
        available: anterior.toFixed(3),
        requested: cantidad.toFixed(3),
      });
    }
    estado.actual = nueva;

    await tx.inventario.update({
      where: { id: estado.inventarioId },
      data: { cantidad: new Prisma.Decimal(nueva) },
    });
    await tx.movimientoInventario.create({
      data: {
        inventarioId: estado.inventarioId,
        notaCreditoId: input.notaCreditoId,
        tipoMovimiento: movimiento,
        motivo: input.motivo,
        cantidadMovida: new Prisma.Decimal(delta),
        cantidadAnterior: new Prisma.Decimal(anterior),
        cantidadNueva: new Prisma.Decimal(nueva),
        usuarioId: ctx.usuarioId,
        fecha: new Date(),
      },
    });
    await registrarAuditoriaStockEnTx(
      tx,
      ctx,
      estado.inventarioId,
      anterior.toFixed(3),
      nueva.toFixed(3),
      input.motivo,
      AccionAuditoria.ACTUALIZAR,
    );
    resultados.push({
      inventoryId: estado.inventarioId,
      previousQuantity: anterior.toFixed(3),
      newQuantity: nueva.toFixed(3),
      productoId: linea.productoId,
    });
  }
  return resultados;
}

/**
 * Role authorization for the inventory actions, mirroring the producto /
 * categoria / proveedor repositories (third-party copy; centralization was
 * evaluated and deferred as YAGNI). Prisma access stays here; only the boolean
 * crosses back into `http/`. The user is resolved by id + empresaId so a
 * cross-tenant id collision can never authorize a role.
 */
export async function tieneRolPermitidoEnTx(
  tx: PrismaTx,
  usuarioId: number,
  empresaId: number,
  rolesPermitidos: readonly string[],
): Promise<boolean> {
  const usuario = await tx.usuario.findUnique({
    where: { id: usuarioId, empresaId },
    select: {
      roles: { select: { rol: { select: { nombre: true } } } },
    },
  });
  if (usuario === null) return false;
  return usuario.roles.some((r) => rolesPermitidos.includes(r.rol.nombre));
}
