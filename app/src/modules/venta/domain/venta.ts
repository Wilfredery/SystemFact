/**
 * Venta domain — pure business rules for the draft-only sale engine (5b).
 *
 * ADR-013: this module imports NOTHING from Next.js, React, Prisma or Supabase.
 * Money and quantities cross the boundary as `Decimal`-compatible strings
 * (`Decimal(12,2)` amounts, `Decimal(12,3)` quantities); `decimal.js` is the same
 * pure library the producto/compra/inventario domains use, so arithmetic is exact
 * and DB-free.
 *
 * Scope guard: the 5b lifecycle is DRAFT-FIRST. `BORRADOR → CANCELADA` is the
 * only reachable transition here. `CONFIRMADA` is part of the persisted enum (the
 * ERD already carries it) but is a FROZEN seam with NO reachable 5b code path —
 * confirmation, NCF consumption and inventory debit are reserved for 5c.
 */

/**
 * Sale states as persisted by the (frozen) `EstadoVenta` enum. `CONFIRMADA` is
 * declared for DB-mapping completeness only; no 5b use case ever transitions to
 * it (spec "Reserved 5c seam").
 */
export const ESTADO_VENTA = {
  BORRADOR: "BORRADOR",
  CANCELADA: "CANCELADA",
  CONFIRMADA: "CONFIRMADA",
} as const;
export type EstadoVenta = (typeof ESTADO_VENTA)[keyof typeof ESTADO_VENTA];

/** States a 5b draft may actually reach: `BORRADOR` or `CANCELADA` only. */
export type EstadoVentaDraft =
  | typeof ESTADO_VENTA.BORRADOR
  | typeof ESTADO_VENTA.CANCELADA;

/**
 * Typed runtime failure for a persisted sale state with NO domain
 * representation. A data-integrity guard, not a normal business error, so it is
 * NOT a `VentaErrorCode` catalog entry — it must never be silently coerced
 * (spec R-V13 "Unknown stored state fails loud").
 */
export class EstadoVentaNoRepresentableError extends Error {
  readonly valor: string;
  constructor(valor: string) {
    super(`Estado de venta no representable en el dominio: ${valor}`);
    this.name = "EstadoVentaNoRepresentableError";
    this.valor = valor;
  }
}

/**
 * Total DB→domain mapper for the persisted `EstadoVenta` enum, expressed over its
 * string values so the domain stays pure (no Prisma import). Every known enum
 * value is handled explicitly; any other/unknown value fails LOUD rather than
 * coercing. The repository feeds it the raw enum string read from the DB.
 */
export function estadoVentaDesdeDb(valor: string): EstadoVenta {
  switch (valor) {
    case ESTADO_VENTA.BORRADOR:
      return ESTADO_VENTA.BORRADOR;
    case ESTADO_VENTA.CANCELADA:
      return ESTADO_VENTA.CANCELADA;
    case ESTADO_VENTA.CONFIRMADA:
      return ESTADO_VENTA.CONFIRMADA;
    default:
      throw new EstadoVentaNoRepresentableError(valor);
  }
}

/** Edits (replace-all-lines, client swap) are allowed only while `BORRADOR`. */
export function puedeEditar(estado: EstadoVenta): boolean {
  return estado === ESTADO_VENTA.BORRADOR;
}

/** Cancellation is reachable only from `BORRADOR`; `CANCELADA` is terminal. */
export function puedeCancelar(estado: EstadoVenta): boolean {
  return estado === ESTADO_VENTA.BORRADOR;
}

// --- Discount vocabulary (frozen per ERD v4.7: no second money column) ---

/** Authorization form of a discount. Zero discount is always `PORCENTAJE`/`0.00`. */
export const DESCUENTO_TIPO = {
  PORCENTAJE: "PORCENTAJE",
  MONTO: "MONTO",
} as const;
export type DescuentoTipo = (typeof DESCUENTO_TIPO)[keyof typeof DESCUENTO_TIPO];

/**
 * A discount as submitted/stored: the authorization `tipo` plus its `valor`.
 * `valor` is a percentage number for `PORCENTAJE` (e.g. "3", "10") or a money
 * string for `MONTO` (e.g. "5.00"), always `Decimal`-compatible. The persisted
 * `descuento`/`descuentoLinea` columns store the RESOLVED MONEY (2dp), never this
 * raw input (spec R-V7).
 */
export interface Descuento {
  readonly descuentoTipo: DescuentoTipo;
  readonly descuentoValor: string;
}

/**
 * Canonical zero discount: PORCENTAJE with money 0.00. A draft saved with no
 * discount stores this shape on the header and every line, with a NULL
 * `descuentoAutorizadoPor` (spec R-V7 "Zero-discount convention").
 */
export const DESCUENTO_CERO: Descuento = {
  descuentoTipo: DESCUENTO_TIPO.PORCENTAJE,
  descuentoValor: "0.00",
};

/** True when a discount carries no effect (PORCENTAJE 0.00). MONTO 0.00 is NOT zero-valid. */
export function esDescuentoCero(d: Descuento): boolean {
  return (
    d.descuentoTipo === DESCUENTO_TIPO.PORCENTAJE &&
    /^0(\.0+)?$/.test(d.descuentoValor.trim())
  );
}

// --- Line contracts ---

/** A sale line exactly as submitted for a draft (rate frozen separately at save). */
export interface VentaLineaInput {
  readonly productoId: number;
  /** Base-unit quantity as a `Decimal(12,3)` string; MUST be > 0. */
  readonly cantidad: string;
  /** Unit price as a `Decimal(12,2)` string; ITBIS-EXCLUSIVE net price; MUST be >= 0. */
  readonly precioUnitario: string;
  /** Per-line discount; zero for a line without one. */
  readonly descuento: Descuento;
}

/**
 * A line after the pure pre-header computation: gross subtotal, resolved line
 * discount money, the net base (after the line discount), and the ITBIS on that
 * base at the line's frozen rate. When a header discount exists the final base
 * is further reduced by its prorated share (see `calcularTotalesVenta`); this
 * value is the intermediate `baseLinea` the proration operates on.
 */
export interface VentaLineaCalculada {
  readonly productoId: number;
  readonly cantidad: string;
  readonly precioUnitario: string;
  /** ITBIS rate frozen at save time ("18" | "16" | "0"). */
  readonly tasaItbis: string;
  /** `round2(cantidad × precioUnitario)` — gross before any discount. */
  readonly subtotalBruto: string;
  readonly descuentoTipo: DescuentoTipo;
  /** Resolved line discount money (2dp), never the raw percentage. */
  readonly descuentoLinea: string;
  /** Net base after the LINE discount: `subtotalBruto − descuentoLinea`. */
  readonly baseLinea: string;
  /** ITBIS on `baseLinea` at `tasaItbis` (pre-header; recomputed in totals). */
  readonly itbisLinea: string;
}

/** Mixed-rate fiscal totals (all `Decimal(12,2)` strings). */
export interface TotalesVenta {
  /** Σ gross subtotals (never stored after discount; identity term). */
  readonly subtotal: string;
  /** Resolved header discount money (2dp). */
  readonly descuentoCabecera: string;
  /** Σ line discounts + header money — the persisted `descuento`. */
  readonly descuento: string;
  /** Σ per-line ITBIS on the final (post-proration) bases. */
  readonly itbis: string;
  /** Σ final bases where rate > 0 — RETURNED only, never stored (spec R-V6). */
  readonly subtotalGravado: string;
  /** Σ final bases where rate = 0 — RETURNED only, never stored (spec R-V6). */
  readonly subtotalExento: string;
  /** `subtotal − descuento + itbis`; the identity MUST hold exactly. */
  readonly total: string;
}
