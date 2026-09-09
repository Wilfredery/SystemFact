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
 * intentionally DRAFT-FIRST. Only `BORRADOR → PENDIENTE → CANCELADA` is
 * reachable here. `RECIBIDA` / `PAGADA` are deliberately ABSENT from
 * {@link ESTADO_COMPRA}: the schema enum carries them for later receipt/payment
 * phases, and the internal correlativo is `CMP-%06d` (not a fiscal NCF).
 */

import {
  COMPRA_INMUTABLE,
  TRANSICION_INVALIDA,
  type CompraErrorCode,
} from "./errors";

/**
 * Purchase states reachable by compra-core. `CONFIRMADA` is NOT part of the
 * vocabulary (that is a Venta state): confirming a purchase uses `PENDIENTE`.
 */
export const ESTADO_COMPRA = {
  BORRADOR: "BORRADOR",
  PENDIENTE: "PENDIENTE",
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

// ---------------------------------------------------------------------------
// 3.4b seams — DECLARED ONLY, intentionally unconsumed by compra-core.
// ---------------------------------------------------------------------------

/**
 * Origin metadata reserved for the future purchase-receipt phase. `PURCHASE`
 * gives 3.4b a stable, compile-checked vocabulary; nothing in this change emits
 * it. It mirrors the `INVENTORY_SOURCE` seam already reserved in the inventario
 * domain and is never wired to any use case here (spec: unreachable states).
 */
export const INVENTORY_SOURCE = {
  PURCHASE: "purchase",
} as const;
export type InventorySource =
  (typeof INVENTORY_SOURCE)[keyof typeof INVENTORY_SOURCE];

/**
 * A stock entry request a future receipt flow would push through the seam.
 * Core compra never constructs or sends one.
 */
export interface InventoryEntryInput {
  readonly branchId: number;
  readonly productId: number;
  readonly quantity: string;
  readonly reason: string;
  readonly source: InventorySource;
}

/**
 * Typed inventory-entry seam. The 3.4b purchase-receipt phase will implement
 * and consume this (plus the `MovimientoInventario.compraId` and B11 seams) to
 * move stock atomically WITHOUT touching this core. Declared here so the
 * contract is owned by the domain and frozen across modules; NO implementation
 * or caller exists in fase-4-compra-core.
 */
export interface InventoryEntryPort {
  applyEntry(input: InventoryEntryInput): Promise<{
    readonly inventoryId: number;
    readonly previousQuantity: string;
    readonly newQuantity: string;
  }>;
}
