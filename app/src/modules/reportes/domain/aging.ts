/**
 * Reportes domain — the CxC aging buckets (FIN-2, slice C).
 *
 * ADR-013: pure TypeScript, no DB. This module owns ONLY the classification of an OPEN
 * receivable into the four aging buckets — **Al día / Vencido 1–30 / 31–60 / 60+ días** —
 * and the Decimal reduction of a bucket's totals. It REUSES the ratified pure mora rule
 * {@link diasVencidoEnSD} (cobros `en-mora.ts`) rather than re-deriving the due date, and
 * never touches the balance math: the per-invoice `saldoPendiente` is produced by the single
 * canonical `consultarSaldoCxcEnTx` aggregate (ADR-017, FIN-1) and merely consumed here. The
 * due-date credit term is resolved by the caller (client `plazoCreditoDias`, else the DB
 * `PLAZO_CREDITO` parameter — FIN-2) and passed in, so no company term is hardcoded here.
 *
 * Bucket boundaries use the SAME Santo-Domingo calendar-day count `diasVencidoEnSD` returns
 * (0 when not yet due / due today):
 *   - 0            → AL_DIA
 *   - 1 .. 30      → VENCIDO_1_30
 *   - 31 .. 60     → VENCIDO_31_60
 *   - 61+ (> 60)   → MAYOR_60
 * The 31–60 bucket ends at 60 inclusive, so "60+" is strictly more than 60 days past due —
 * no overlap, and the boundaries match the wireframe labels verbatim.
 */

import { Decimal } from "decimal.js";
import { diasVencidoEnSD, fechaVencimiento } from "@/modules/cobros/domain/en-mora";

/** The four aging buckets (FIN-2). Stable codes rendered by the panel/CSV. */
export const BUCKET_AGING = {
  AL_DIA: "AL_DIA",
  VENCIDO_1_30: "VENCIDO_1_30",
  VENCIDO_31_60: "VENCIDO_31_60",
  MAYOR_60: "MAYOR_60",
} as const;
export type BucketAging = (typeof BUCKET_AGING)[keyof typeof BUCKET_AGING];

/** Every bucket in report order (Al día first, most overdue last) — drives the summary grid. */
export const ORDEN_BUCKETS: readonly BucketAging[] = [
  BUCKET_AGING.AL_DIA,
  BUCKET_AGING.VENCIDO_1_30,
  BUCKET_AGING.VENCIDO_31_60,
  BUCKET_AGING.MAYOR_60,
];

/**
 * Spanish display label per aging bucket. Presentation copy lives with the pure classification so
 * the panel and the CSV render the SAME human-readable name for a given stable code (no drift).
 */
export const ETIQUETA_BUCKET_AGING: Readonly<Record<BucketAging, string>> = {
  [BUCKET_AGING.AL_DIA]: "Al día",
  [BUCKET_AGING.VENCIDO_1_30]: "Vencido 1-30",
  [BUCKET_AGING.VENCIDO_31_60]: "Vencido 31-60",
  [BUCKET_AGING.MAYOR_60]: "Vencido 60+",
};

/**
 * Classify a past-due day count into its aging bucket. `diasVencido` is the value
 * {@link diasVencidoEnSD} already produced (≥ 0; 0 = not yet due). Any non-negative integer is
 * valid; a negative is a defect and clamps to AL_DIA (defensive, never mis-buckets real data).
 */
export function clasificarBucketAging(diasVencido: number): BucketAging {
  const dias = diasVencido > 0 ? diasVencido : 0;
  if (dias === 0) return BUCKET_AGING.AL_DIA;
  if (dias <= 30) return BUCKET_AGING.VENCIDO_1_30;
  if (dias <= 60) return BUCKET_AGING.VENCIDO_31_60;
  return BUCKET_AGING.MAYOR_60;
}

/**
 * One open receivable as the aging view needs it. `saldoPendiente` is the canonical derived
 * balance (`Decimal(12,2)` string) already computed by `consultarSaldoCxcEnTx`; `plazoCreditoDias`
 * is the RESOLVED credit term (client value, else the DB `PLAZO_CREDITO` parameter), supplied by
 * the application so this pure layer never hardcodes a term.
 */
export interface FilaCxcAbierta {
  readonly facturaId: number;
  readonly clienteId: number;
  /** Canonical derived pending balance, `Decimal(12,2)` string (never a float). */
  readonly saldoPendiente: string;
  /** Raw invoice emission instant the mora/aging rule resolves in SD. */
  readonly fechaEmision: Date;
  /** Resolved credit term (days) for this invoice's client. */
  readonly plazoCreditoDias: number;
}

/** One aged receivable: the canonical row enriched with its SD due date + bucket. */
export interface CxcAgingFila {
  readonly facturaId: number;
  readonly clienteId: number;
  /** Canonical derived pending balance, `Decimal(12,2)` string. */
  readonly saldoPendiente: string;
  /** SD calendar due date (`YYYY-MM-DD`) = `fechaEmision + plazoCreditoDias` (reused mora rule). */
  readonly vencimiento: string;
  /** Full SD calendar days past due (0 = Al día). */
  readonly diasVencido: number;
  /** The aging bucket the invoice falls into. */
  readonly bucket: BucketAging;
}

/**
 * Enrich one open receivable with its SD due date, past-due day count and aging bucket, reusing
 * the ratified `diasVencidoEnSD` / `fechaVencimiento` mora rules (the due date and "today" both
 * resolve in America/Santo_Domingo — never a raw UTC comparison, R-B3 discipline inherited).
 */
export function construirFilaAging(
  fila: FilaCxcAbierta,
  now: Date,
): CxcAgingFila {
  const diasVencido = diasVencidoEnSD({
    fechaEmision: fila.fechaEmision,
    plazoCreditoDias: fila.plazoCreditoDias,
    now,
  });
  return {
    facturaId: fila.facturaId,
    clienteId: fila.clienteId,
    saldoPendiente: fila.saldoPendiente,
    // The SD calendar due date (emission + resolved credit term) comes from the SAME ratified
    // mora rule the day count uses, so bucket and displayed date can never disagree.
    vencimiento: fechaVencimiento(fila.fechaEmision, fila.plazoCreditoDias),
    diasVencido,
    bucket: clasificarBucketAging(diasVencido),
  };
}

/** The Σ pending balance and invoice count per aging bucket (Decimal-string money). */
export interface ResumenAging {
  /** Σ `saldoPendiente` over every open invoice, `Decimal(12,2)` string. */
  readonly saldoTotal: string;
  /** Open (saldoPendiente > 0) invoice count. */
  readonly facturasAbiertas: number;
  /** Per-bucket Σ saldo, `Decimal(12,2)` string, every bucket present (0 when empty). */
  readonly porBucket: Readonly<Record<BucketAging, string>>;
  /** Per-bucket invoice count. */
  readonly conteoPorBucket: Readonly<Record<BucketAging, number>>;
}

/**
 * Reduce already-aged rows to the bucket totals with `decimal.js` — a DISPLAY aggregate over
 * per-invoice facts that the canonical query already derived, never a fetch-then-sum over raw
 * documents and never a JS float (AGENTS.md "Money = Decimal"; same reduction discipline the
 * dashboard CxC tile uses via `resumirCxC`). Empty input yields all-zero totals with every
 * bucket key present (a stable summary shape for the panel and the CSV footer).
 */
export function resumirAging(filas: readonly CxcAgingFila[]): ResumenAging {
  const montos: Record<BucketAging, Decimal> = {
    [BUCKET_AGING.AL_DIA]: new Decimal(0),
    [BUCKET_AGING.VENCIDO_1_30]: new Decimal(0),
    [BUCKET_AGING.VENCIDO_31_60]: new Decimal(0),
    [BUCKET_AGING.MAYOR_60]: new Decimal(0),
  };
  const conteos: Record<BucketAging, number> = {
    [BUCKET_AGING.AL_DIA]: 0,
    [BUCKET_AGING.VENCIDO_1_30]: 0,
    [BUCKET_AGING.VENCIDO_31_60]: 0,
    [BUCKET_AGING.MAYOR_60]: 0,
  };
  let total = new Decimal(0);
  for (const f of filas) {
    const saldo = new Decimal(f.saldoPendiente);
    // Only genuinely outstanding receivables age; a 0/negative balance nets out (never negative).
    if (saldo.lte(0)) continue;
    total = total.plus(saldo);
    montos[f.bucket] = montos[f.bucket].plus(saldo);
    conteos[f.bucket] += 1;
  }
  const porBucket = Object.fromEntries(
    ORDEN_BUCKETS.map((b) => [b, montos[b].toDecimalPlaces(2).toFixed(2)]),
  ) as Record<BucketAging, string>;
  const conteoPorBucket = Object.fromEntries(
    ORDEN_BUCKETS.map((b) => [b, conteos[b]]),
  ) as Record<BucketAging, number>;
  return {
    saldoTotal: total.toDecimalPlaces(2).toFixed(2),
    facturasAbiertas: filas.filter((f) => new Decimal(f.saldoPendiente).gt(0)).length,
    porBucket,
    conteoPorBucket,
  };
}
