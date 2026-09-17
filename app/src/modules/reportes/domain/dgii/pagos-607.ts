/**
 * Reportes domain — Formato 607 payment-mode cross-foot and the B02 consumption threshold (FIS-3;
 * slice E, task 5.1).
 *
 * ADR-013: PURE TypeScript, Decimal-only money (never a JS float — AGENTS.md "Money = Decimal").
 * Two frozen fiscal rules the 607 exporter must satisfy exactly:
 *
 *   1. CROSS-FOOT (spec FIS-3 "D17–D23 (gross incl. ITBIS) MUST cross-foot to the invoice total
 *      exactly"; research §3 note: "ni un centavo más, ni uno menos"). The seven payment-form
 *      columns D17–D23 sum to the GROSS total incl. ITBIS. V1 knows only two real modes (the
 *      `MetodoPago` enum has a single `EFECTIVO` member and un-collected invoices are credit), so
 *      {@link distribuirFormasPago607} fills Efectivo (D17) = Σ applied cash cobros and Venta a
 *      Crédito (D20) = total − efectivo, with the other five at zero. The remainder is DEFINED as
 *      `total − Σ(the filled modes)`, so the cross-foot holds to the cent BY CONSTRUCTION — there
 *      is no rounding tail to lose.
 *
 *   2. B02 THRESHOLD (spec FIS-3 scenario / research §3: "consumption invoices (B02) are detailed
 *      only when total ≥ RD$250,000 (boundary INCLUSIVE)"). The threshold is a PERIOD PARAMETER
 *      read from `ConfiguracionEmpresa` (U-style: never a hardcoded constant, AGENTS.md
 *      "Parameters from DB"), passed IN by the caller; the domain predicate is pure and takes it
 *      as an argument. {@link debeDetallarseEn607} decides, per document, whether it earns a 607
 *      detail row: B01/B03/B04 always (fiscal-valid / note), B02 only at ≥ the threshold.
 */

import { Decimal } from "decimal.js";

/** The seven 607 payment-form columns D17–D23, each a `Decimal(12,2)` gross-incl-ITBIS string. */
export interface FormasPago607 {
  readonly efectivo: string; // D17
  readonly chequeTransferencia: string; // D18
  readonly tarjeta: string; // D19
  readonly ventaCredito: string; // D20
  readonly bonos: string; // D21
  readonly permuta: string; // D22
  readonly otrasFormas: string; // D23
}

/** One rounded money value (2 dp) as a fixed string — the `Decimal(12,2)` serialisation scale. */
function dinero(d: Decimal): string {
  return d.toDecimalPlaces(2).toFixed(2);
}

/**
 * Distribute an invoice's GROSS total (incl. ITBIS) across the seven payment-form columns so they
 * cross-foot EXACTLY (spec FIS-3). `efectivo` is the Σ of applied cash collections already
 * aggregated by the repository (a Decimal string); the remaining gross is reported as Venta a
 * Crédito (D20). A cash figure exceeding the total is clamped to the total (a data anomaly must
 * not push the credit column negative — the cross-foot still equals `total`). All other modes are
 * zero in V1. The result's seven values sum to `total` to the cent by construction.
 */
export function distribuirFormasPago607(params: {
  readonly totalBruto: string; // gross incl. ITBIS (Factura.total)
  readonly cobrosEfectivo: string; // Σ applied cash cobros (APLICADO, not reimbursed)
}): FormasPago607 {
  const total = new Decimal(params.totalBruto).toDecimalPlaces(2);
  const cobros = new Decimal(params.cobrosEfectivo).toDecimalPlaces(2);
  const cero = dinero(new Decimal(0));
  let efectivo: Decimal;
  let ventaCredito: Decimal;
  if (total.isNegative()) {
    // A reversal (B04 nota crédito) has NO cash payment; the whole negative gross is reported as
    // a credit adjustment (D20) so the seven columns still cross-foot to the negative total.
    efectivo = new Decimal(0);
    ventaCredito = total;
  } else {
    // A positive total: cash clamped into [0, total]; the remainder is credit (never negative).
    efectivo = cobros.isNegative() ? new Decimal(0) : cobros.gt(total) ? total : cobros;
    ventaCredito = total.minus(efectivo);
  }
  return {
    efectivo: dinero(efectivo),
    chequeTransferencia: cero,
    tarjeta: cero,
    ventaCredito: dinero(ventaCredito),
    bonos: cero,
    permuta: cero,
    otrasFormas: cero,
  };
}

/**
 * GUARD (used by the exporter and the unit tests): assert the seven payment columns sum to the
 * gross total exactly. Throws a plain `Error` (a DEFECT, never a user-facing catalog code) when a
 * row would break the DGII cross-foot rule — a fail-fast so a malformed split can never ship a
 * rejected file.
 */
export function verificarCrucePagos607(
  formas: FormasPago607,
  totalBruto: string,
): void {
  const suma = new Decimal(formas.efectivo)
    .plus(formas.chequeTransferencia)
    .plus(formas.tarjeta)
    .plus(formas.ventaCredito)
    .plus(formas.bonos)
    .plus(formas.permuta)
    .plus(formas.otrasFormas);
  const total = new Decimal(totalBruto).toDecimalPlaces(2);
  if (!suma.equals(total)) {
    throw new Error(
      `607 cross-foot broken: Σ(D17..D23)=${suma.toFixed(2)} ≠ total=${total.toFixed(2)}`,
    );
  }
}

/**
 * The 607 detail-scope predicate (spec FIS-3). Given a document's `tipoNcf` prefix, its GROSS
 * total and the tenant's B02 consumption threshold (from `ConfiguracionEmpresa`, INCLUSIVE),
 * returns whether it earns a 607 detail row:
 *   - B01 (crédito fiscal), B03 (nota débito), B04 (nota crédito): always detailed;
 *   - B02 (consumo): detailed ONLY when `total >= umbralB02` (boundary inclusive);
 *   - anything else (B11 is a purchase type, never a sales doc): NOT a 607 row.
 * The threshold arrives as a Decimal string so the ≥ compare is exact (a 250000.00 invoice is IN,
 * a 249999.99 one is OUT — spec FIS-3 scenario pins the RD$250,000.00 vs RD$249,999.00 boundary).
 */
export function debeDetallarseEn607(params: {
  readonly tipoNcf: string; // "B01" | "B02" | "B03" | "B04"
  readonly totalBruto: string; // gross incl. ITBIS
  readonly umbralB02: string; // ConfiguracionEmpresa-sourced threshold, Decimal string
}): boolean {
  switch (params.tipoNcf) {
    case "B01":
    case "B03":
    case "B04":
      return true;
    case "B02": {
      const total = new Decimal(params.totalBruto);
      const umbral = new Decimal(params.umbralB02);
      return total.gte(umbral); // INCLUSIVE boundary
    }
    default:
      return false;
  }
}

/**
 * Whether a VIGENTE sales document belongs in 607 at all (independent of the B02 threshold): its
 * NCF prefix must be one of the four sales-document types. Used as the outer scope filter before
 * the per-type B02 predicate. Cancelada/Anulada are excluded separately by their `estado` (FIS-5).
 */
export function esComprobanteDeVenta607(tipoNcf: string): boolean {
  return tipoNcf === "B01" || tipoNcf === "B02" || tipoNcf === "B03" || tipoNcf === "B04";
}
