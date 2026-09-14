/**
 * Use case: confirmed-sale stock exit + cancellation reposition (fase-5c pr5c3).
 *
 * These realize the previously-reserved `InventoryExitPort` seam from the
 * inventario side. Both are DB-effecting INSIDE the CALLER's `PrismaTx` (no new
 * transaction — the surrounding `withTenantTransaction` owns atomicity) and both
 * are THROW-ON-REJECT: the sale exit is the authoritative post-consume block in
 * `confirmarVenta`, so a shortage MUST throw (never return) to roll back the
 * flip, the invoice, the NCF and every already-debited line together. Returning a
 * typed failure there would let a confirm "succeed" while the sequence stays
 * burned and stock stays short.
 *
 *   - `registrarSalidasVenta` — one `SALIDA_VENTA` movement per line carrying
 *     `ventaId`, a deterministic ascending-product-id lock order, an ownership
 *     guard, and a HARD `STOCK_INSUFICIENTE_BLOQUEO` block so stock can never go
 *     negative. `costoPromedio` is untouched (exits never reweight average cost).
 *
 *   - `registrarReposicionCancelacion` — the cancel-time inverse: positive deltas
 *     under the SAME lock order, one `REPOSICION_CANCELACION` movement per line
 *     with a NON-EMPTY reason, average cost again untouched (replenish only).
 *
 * The batch mechanics (dedupe, locks, movements, audit) live in the repository;
 * this layer validates the domain boundary (well-formed positive magnitudes, the
 * mandatory reposition reason) and derives the movement reason text.
 */

import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import { Decimal } from "decimal.js";
import {
  CANTIDAD_INVALIDA,
  InventarioDomainError,
} from "../domain/errors";
import {
  validateAdjustmentQuantity,
  validateMotivo,
} from "../domain/inventario";
import {
  registrarSalidasVentaEnTx,
  registrarReposicionCancelacionEnTx,
  registrarDevolucionEnTx,
  type DevolucionLineaEnTx,
  type SalidaMovimientoAplicado,
  type SalidaVentaLinea,
} from "../infrastructure/inventario-repository";

/** A single sale-exit line pushed through the exit port. */
export interface SalidasVentaLinea {
  readonly productoId: number;
  /** Positive requested quantity as a `Decimal(12,3)` string. */
  readonly cantidad: string;
}

export interface RegistrarSalidasVentaInput {
  /** The confirmed sale causing the exit (written to `MovimientoInventario.ventaId`). */
  readonly ventaId: number;
  readonly lineas: readonly SalidasVentaLinea[];
}

export interface RegistrarReposicionCancelacionInput {
  /** The cancelled sale whose lines are being restored. */
  readonly ventaId: number;
  /** NON-EMPTY audit reason — a reposition without a reason is rejected. */
  readonly motivo: string;
  readonly lineas: readonly SalidasVentaLinea[];
}

/**
 * Validate one line's magnitude at the domain boundary WITHOUT touching the DB:
 * a well-formed non-negative `Decimal(12,3)` shape AND a strictly positive
 * quantity (an exit or reposition of zero units would pollute the ledger).
 */
function validarCantidadPositiva(linea: SalidasVentaLinea): void {
  const forma = validateAdjustmentQuantity(linea.cantidad);
  if (forma !== null) {
    throw new InventarioDomainError(forma, { productoId: linea.productoId });
  }
  // lessThanOrEqualTo(0), not !isPositive(): decimal.js isPositive() is
  // sign-based and accepts zero (devolucion domain documents this gotcha).
  if (new Decimal(linea.cantidad).lessThanOrEqualTo(0)) {
    throw new InventarioDomainError(CANTIDAD_INVALIDA, {
      productoId: linea.productoId,
    });
  }
}

/**
 * Debit the session branch's stock for a confirmed sale — the authoritative
 * exit batch. Any rejected line (foreign product, non-positive magnitude, or a
 * shortage) THROWS `InventarioDomainError` so the caller's transaction rolls
 * back every prior line's stock/movement.
 *
 * @throws InventarioDomainError(STOCK_INSUFICIENTE_BLOQUEO | INVENTARIO_NO_ENCONTRADO | CANTIDAD_INVALIDA)
 */
export async function registrarSalidasVenta(
  tx: PrismaTx,
  ctx: TenantCtx,
  input: RegistrarSalidasVentaInput,
): Promise<SalidaMovimientoAplicado[]> {
  const lineas: SalidaVentaLinea[] = input.lineas.map((l) => {
    validarCantidadPositiva(l);
    return { productoId: l.productoId, cantidad: l.cantidad };
  });
  return registrarSalidasVentaEnTx(tx, ctx, {
    ventaId: input.ventaId,
    motivo: `Salida de inventario por venta ${String(input.ventaId)}`,
    lineas,
  });
}

/**
 * Restore the session branch's stock on confirmed-sale cancellation — the
 * reposition batch. Runs under the SAME lock order as the exit path and appends
 * one `REPOSICION_CANCELACION` movement per line. A blank/whitespace reason is
 * rejected with `MOTIVO_VACIO`; a foreign product with `INVENTARIO_NO_ENCONTRADO`.
 * Never touches `costoPromedio`.
 *
 * @throws InventarioDomainError(MOTIVO_VACIO | INVENTARIO_NO_ENCONTRADO | CANTIDAD_INVALIDA)
 */
export async function registrarReposicionCancelacion(
  tx: PrismaTx,
  ctx: TenantCtx,
  input: RegistrarReposicionCancelacionInput,
): Promise<SalidaMovimientoAplicado[]> {
  const motivoError = validateMotivo(input.motivo);
  if (motivoError !== null) {
    throw new InventarioDomainError(motivoError);
  }

  const lineas: SalidaVentaLinea[] = input.lineas.map((l) => {
    validarCantidadPositiva(l);
    return { productoId: l.productoId, cantidad: l.cantidad };
  });

  return registrarReposicionCancelacionEnTx(tx, ctx, {
    ventaId: input.ventaId,
    motivo: input.motivo.trim(),
    lineas,
  });
}

// ---------------------------------------------------------------------------
// fase-5d — devolucion seam (design D5): the B04 credit-note stock effect.
// One `TipoReposicion`-classified line per returned unit; the repository maps
// VENDIBLE → ENTRADA_DEVOLUCION (+stock) and DANADO → SALIDA_MERMA (−stock,
// hard shortage block). Runs INSIDE the caller's devolucion transaction and is
// THROW-ON-REJECT for the same reason as the exit batch: the NC + its NCF are
// already written when this runs, so a returned line that cannot be applied
// MUST throw to roll the whole devolucion back — never return a partial credit.
// ---------------------------------------------------------------------------

/** One returned unit line pushed through the devolucion seam. */
export interface RegistrarDevolucionLinea {
  readonly productoId: number;
  /** Positive returned quantity as a `Decimal(12,3)` string. */
  readonly cantidad: string;
  /** `VENDIBLE` restocks; `DANADO` is disposed as merma (frozen enum). */
  readonly tipoReposicion: "VENDIBLE" | "DANADO";
}

export interface RegistrarDevolucionInput {
  /** The NC backing this return (written to `MovimientoInventario.notaCreditoId`). */
  readonly notaCreditoId: number;
  /** NON-EMPTY audit reason — the NC motivo, reused on every movement. */
  readonly motivo: string;
  readonly lineas: readonly RegistrarDevolucionLinea[];
}

/**
 * Persist the stock effect of a B04 credit note: one `ENTRADA_DEVOLUCION` /
 * `SALIDA_MERMA` movement per line under the shared ascending lock order. A
 * blank/whitespace reason is rejected with `MOTIVO_VACIO`; a foreign product
 * with `INVENTARIO_NO_ENCONTRADO`; a `DANADO` line beyond available stock with
 * `STOCK_INSUFICIENTE_BLOQUEO` (rolling the caller's transaction back).
 * Never touches `costoPromedio`.
 *
 * @throws InventarioDomainError(MOTIVO_VACIO | INVENTARIO_NO_ENCONTRADO | STOCK_INSUFICIENTE_BLOQUEO | CANTIDAD_INVALIDA)
 */
export async function registrarDevolucion(
  tx: PrismaTx,
  ctx: TenantCtx,
  input: RegistrarDevolucionInput,
): Promise<SalidaMovimientoAplicado[]> {
  const motivoError = validateMotivo(input.motivo);
  if (motivoError !== null) {
    throw new InventarioDomainError(motivoError);
  }

  const lineas: DevolucionLineaEnTx[] = input.lineas.map((l) => {
    validarCantidadPositiva(l);
    return {
      productoId: l.productoId,
      cantidad: l.cantidad,
      tipoReposicion: l.tipoReposicion,
    };
  });

  return registrarDevolucionEnTx(tx, ctx, {
    notaCreditoId: input.notaCreditoId,
    motivo: input.motivo.trim(),
    lineas,
  });
}
