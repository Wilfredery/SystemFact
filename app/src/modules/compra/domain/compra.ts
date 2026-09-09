/**
 * Compra domain — pure business rules: the reachable purchase state contract,
 * draft/line/totals contracts, guarded state transitions, and the 3.4b receipt
 * seams declared for future phases.
 *
 * ADR-013: this module imports NOTHING from Next.js, React, Prisma or Supabase.
 * Money and quantities cross the domain boundary as `Decimal`-compatible
 * strings (`Decimal(12,2)` amounts, `Decimal(12,3)` quantities); `decimal.js`
 * is the same pure numeric library the producto/inventario domains rely on, so
 * arithmetic is exact and DB-free.
 *
 * Scope guard (spec "3.4b receipt/payment seams preserved"): the core model is
 * DRAFT-FIRST. `BORRADOR → PENDIENTE → RECIBIDA` and cancel (`BORRADOR`/
 * `PENDIENTE → CANCELADA`) are reachable here. `RECIBIDA` was opened in
 * fase-3-4b via the guarded receipt transition {@link transicionarRecibir};
 * `PAGADA` and the B11 fiscal engine remain FROZEN seams with no reachable
 * path, and the internal correlativo is `CMP-%06d` (not a fiscal NCF).
 */

import {
  COMPRA_INMUTABLE,
  TRANSICION_INVALIDA,
  type CompraErrorCode,
} from "./errors";

/**
 * Purchase states reachable by compra-core. `CONFIRMADA` is NOT part of the
 * vocabulary (that is a Venta state): confirming a purchase uses `PENDIENTE`.
 *
 * `RECIBIDA` is reachable from fase-3-4b's receipt path (guarded
 * `PENDIENTE → RECIBIDA`, see {@link transicionarRecibir}). `PAGADA` remains
 * deliberately ABSENT: payments are a frozen later seam (no →`PAGADA` path
 * exists here), even though the schema enum carries it.
 */
export const ESTADO_COMPRA = {
  BORRADOR: "BORRADOR",
  PENDIENTE: "PENDIENTE",
  RECIBIDA: "RECIBIDA",
  CANCELADA: "CANCELADA",
} as const;
export type EstadoCompraCore =
  (typeof ESTADO_COMPRA)[keyof typeof ESTADO_COMPRA];

/** Fiscal classification of a purchase — drives the ISR/ITBIS retention matrix. */
export const TIPO_COMPRA = {
  MERCANCIA: "MERCANCIA",
  SERVICIO_PROFESIONAL: "SERVICIO_PROFESIONAL",
  SERVICIO_TECNICO: "SERVICIO_TECNICO",
  ALQUILER: "ALQUILER",
} as const;
export type TipoCompra = (typeof TIPO_COMPRA)[keyof typeof TIPO_COMPRA];

/** Purchase receipt NCF kind: B01 (formal) / B11 (informal). Optional text until received. */
export const TIPO_NCF_COMPRA = {
  B01: "B01",
  B11: "B11",
} as const;
export type TipoNcfCompra = (typeof TIPO_NCF_COMPRA)[keyof typeof TIPO_NCF_COMPRA];

/**
 * Supplier classification mirror. These literal unions match the frozen
 * `Proveedor` enum values (TipoProveedor / TipoPersona); they are re-declared
 * locally so the retention matrix stays self-contained and the compra domain
 * keeps zero coupling to another module's runtime shape.
 */
export const CLASE_PROVEEDOR = {
  FORMAL: "FORMAL",
  INFORMAL: "INFORMAL",
} as const;
export type ClaseProveedor = (typeof CLASE_PROVEEDOR)[keyof typeof CLASE_PROVEEDOR];

export const TIPO_PERSONA = {
  FISICA: "FISICA",
  JURIDICA: "JURIDICA",
} as const;
export type TipoPersona = (typeof TIPO_PERSONA)[keyof typeof TIPO_PERSONA];

/** A line exactly as submitted for a draft (rate frozen separately at save). */
export interface CompraLineaInput {
  readonly productoId: number;
  /** Base-unit quantity as a `Decimal(12,3)` string; MUST be > 0. */
  readonly cantidad: string;
  /** Unit cost as a `Decimal(12,2)` string; MUST be >= 0. */
  readonly costoUnitario: string;
}

/** A persisted line: the input plus the per-line frozen ITBIS rate and totals. */
export interface CompraLineaCalculada {
  readonly productoId: number;
  readonly cantidad: string;
  readonly costoUnitario: string;
  /** ITBIS rate frozen at save time (e.g. "18", "16", "0"). */
  readonly tasaItbis: string;
  readonly itbisLinea: string;
  readonly subtotalLinea: string;
}

/** Mixed-rate fiscal totals (all `Decimal(12,2)` strings). */
export interface TotalesCompra {
  readonly subtotalGravado: string;
  readonly itbis: string;
  readonly subtotalExento: string;
  readonly subtotal: string;
  /** Gross billed amount: subtotal + itbis. Payable is display-derived. */
  readonly total: string;
}

/** ISR/ITBIS retentions frozen at confirm (both `Decimal(12,2)` strings). */
export interface RetencionesCompra {
  readonly retencionIsr: string;
  readonly retencionItbis: string;
}

/**
 * Rate percentages read from `ConfiguracionEmpresa` (percent form, e.g. "15").
 * Never hardcoded — the caller supplies these from tenant configuration.
 */
export interface RetentionRates {
  readonly isr15: string;
  readonly isr2: string;
  readonly itbis100: string;
  readonly itbis30: string;
}

/**
 * A draft purchase as orchestrated by the application layer. `correlativoInterno`
 * is empty until confirm (the CMP counter is assigned atomically on the
 * `BORRADOR → PENDIENTE` transition); retentions are zero until confirm.
 */
export interface CompraDraft {
  readonly empresaId: number;
  readonly sucursalId: number;
  readonly proveedorId: number;
  readonly usuarioId: number;
  readonly tipoCompra: TipoCompra;
  readonly fecha: Date;
  readonly ncf: string | null;
  readonly tipoNcf: TipoNcfCompra | null;
  readonly estado: EstadoCompraCore;
  readonly correlativoInterno: string;
  readonly lineas: readonly CompraLineaCalculada[];
  readonly totales: TotalesCompra;
  readonly retenciones: RetencionesCompra;
}

/**
 * Typed use-case result: success data or a stable coded error (19-directivas §9).
 */
export type CompraResult<T> =
  | { readonly ok: true; readonly data: T }
  | {
      readonly ok: false;
      readonly code: CompraErrorCode;
      readonly message: string;
    };

/**
 * Typed runtime failure for a persisted purchase state that has NO domain
 * representation (currently only `PAGADA`, plus any future/unknown value). This
 * is a data-integrity guard, not a normal business error, so it is NOT a
 * `CompraErrorCode` catalog entry — it must never be silently coerced.
 */
export class EstadoCompraNoRepresentableError extends Error {
  readonly valor: string;
  constructor(valor: string) {
    super(`Estado de compra no representable en el dominio: ${valor}`);
    this.name = "EstadoCompraNoRepresentableError";
    this.valor = valor;
  }
}

/**
 * Total DB→domain mapper for the persisted `EstadoCompra` enum, expressed over
 * its string values so the domain stays pure (no Prisma import). Every one of
 * the five schema enum values is handled explicitly:
 *
 *   BORRADOR / PENDIENTE / RECIBIDA / CANCELADA → the matching core state.
 *   PAGADA                                      → fails LOUD (no reachable
 *                                                 domain path; payments frozen).
 *   <any other/unknown value>                   → fails LOUD (never a silent
 *                                                 coercion).
 *
 * The repository feeds it the raw enum string read from the DB, replacing the
 * previous unsafe `as EstadoCompraCore` cast (spec "Exhaustive purchase state
 * mapping").
 */
export function estadoCompraDesdeDb(valor: string): EstadoCompraCore {
  switch (valor) {
    case ESTADO_COMPRA.BORRADOR:
      return ESTADO_COMPRA.BORRADOR;
    case ESTADO_COMPRA.PENDIENTE:
      return ESTADO_COMPRA.PENDIENTE;
    case ESTADO_COMPRA.RECIBIDA:
      return ESTADO_COMPRA.RECIBIDA;
    case ESTADO_COMPRA.CANCELADA:
      return ESTADO_COMPRA.CANCELADA;
    case "PAGADA":
      throw new EstadoCompraNoRepresentableError(valor);
    default:
      throw new EstadoCompraNoRepresentableError(valor);
  }
}

/** A guarded transition is either legal (target state) or a coded rejection. */
export type TransicionResultado =
  | { readonly ok: true; readonly estado: EstadoCompraCore }
  | { readonly ok: false; readonly code: CompraErrorCode };

/** Edit is allowed only while the purchase is a draft. */
export function puedeEditar(estado: EstadoCompraCore): boolean {
  return estado === ESTADO_COMPRA.BORRADOR;
}

/** Confirm is only ever `BORRADOR → PENDIENTE` (never the CONFIRMADA vocabulary). */
export function puedeConfirmar(estado: EstadoCompraCore): boolean {
  return estado === ESTADO_COMPRA.BORRADOR;
}

/** Cancel is reachable from either `BORRADOR` or `PENDIENTE`; `CANCELADA` is terminal. */
export function puedeCancelar(estado: EstadoCompraCore): boolean {
  return estado === ESTADO_COMPRA.BORRADOR || estado === ESTADO_COMPRA.PENDIENTE;
}

/**
 * Guarded confirm transition. Returns `PENDIENTE` from a `BORRADOR`, or the
 * stable immutability code when the draft was already confirmed/cancelled.
 */
export function transicionarConfirmar(
  estado: EstadoCompraCore,
): TransicionResultado {
  if (estado === ESTADO_COMPRA.BORRADOR) {
    return { ok: true, estado: ESTADO_COMPRA.PENDIENTE };
  }
  if (estado === ESTADO_COMPRA.PENDIENTE) {
    return { ok: false, code: COMPRA_INMUTABLE };
  }
  return { ok: false, code: TRANSICION_INVALIDA };
}

/**
 * Guarded cancel transition. From `BORRADOR`/`PENDIENTE` yields `CANCELADA`; a
 * cancelled purchase is terminal (`TRANSICION_INVALIDA`), and no core state can
 * transition backwards.
 */
export function transicionarCancelar(
  estado: EstadoCompraCore,
): TransicionResultado {
  if (puedeCancelar(estado)) {
    return { ok: true, estado: ESTADO_COMPRA.CANCELADA };
  }
  return { ok: false, code: TRANSICION_INVALIDA };
}

/**
 * Receipt (full, no per-line quantities) is allowed only from `PENDIENTE`.
 * `BORRADOR` (unconfirmed), `CANCELADA` (terminal) and `RECIBIDA` (already
 * received) are all non-receivable states.
 */
export function puedeRecibir(estado: EstadoCompraCore): boolean {
  return estado === ESTADO_COMPRA.PENDIENTE;
}

/**
 * Guarded `PENDIENTE → RECIBIDA` receipt transition.
 *
 * - `PENDIENTE` → `RECIBIDA`.
 * - `RECIBIDA`  → `COMPRA_INMUTABLE`: an already-received purchase is idempotent;
 *   the use case surfaces this as the stable `CONCURRENCIA_CONFLICTO` conflict so
 *   a duplicate click reports "already received" with zero side effects.
 * - `BORRADOR` / `CANCELADA` → `TRANSICION_INVALIDA` (wrong state, zero writes).
 *
 * There is deliberately NO path from `RECIBIDA` back to `CANCELADA` (cancel of a
 * received purchase is {@link transicionarCancelar} → `TRANSICION_INVALIDA`): the
 * inventory/cost reversal for that is a FROZEN deferred seam (fase-3-4b).
 */
export function transicionarRecibir(
  estado: EstadoCompraCore,
): TransicionResultado {
  if (estado === ESTADO_COMPRA.PENDIENTE) {
    return { ok: true, estado: ESTADO_COMPRA.RECIBIDA };
  }
  if (estado === ESTADO_COMPRA.RECIBIDA) {
    return { ok: false, code: COMPRA_INMUTABLE };
  }
  return { ok: false, code: TRANSICION_INVALIDA };
}

// ---------------------------------------------------------------------------
// Inventory-entry seam — REALIZED by inventario in fase-3-4b.
//
// The contract lives in this domain so the cross-module seam is owned by the
// domain and stays frozen across modules; the concrete implementation and all
// stock/cost invariants live in inventario's `registrarEntradaCompra` /
// `registrarEntradasCompra` use cases, which the compra receipt use case calls
// (application → application over these published types). Compra itself never
// computes or writes stock, movements, or `costoPromedio`.
// ---------------------------------------------------------------------------

/**
 * Movement-origin vocabulary for the receipt entry. Mirrors the `INVENTORY_SOURCE`
 * seam in the inventario domain; the purchase path emits `PURCHASE`.
 */
export const INVENTORY_SOURCE = {
  PURCHASE: "purchase",
} as const;
export type InventorySource =
  (typeof INVENTORY_SOURCE)[keyof typeof INVENTORY_SOURCE];

/**
 * A single stock-entry line pushed through the receipt seam: the branch, the
 * originating purchase id (written to `MovimientoInventario.compraId`), the
 * product, the positive quantity, and the ITBIS-EXCLUSIVE net unit cost so the
 * company-wide average cost is weighted on the net basis.
 */
export interface InventoryEntryInput {
  readonly branchId: number;
  readonly purchaseId: number;
  readonly productId: number;
  readonly quantity: string;
  readonly unitCostWithoutItbis: string;
  readonly reason: string;
  readonly source: InventorySource;
}

/**
 * The frozen entry seam (single-line operation). `recibirCompra` persists every
 * line and drives the whole receipt inside ONE tenant transaction; the atomic
 * multi-line realization lives in inventario's `registrarEntradasCompra`. This
 * interface documents the per-line contract that the seam guarantees.
 */
export interface InventoryEntryPort {
  applyEntry(input: InventoryEntryInput): Promise<InventoryMovementResult>;
}

/** Before/after snapshot a movement carries back through the seam. */
export interface InventoryMovementResult {
  readonly inventoryId: number;
  readonly previousQuantity: string;
  readonly newQuantity: string;
}
