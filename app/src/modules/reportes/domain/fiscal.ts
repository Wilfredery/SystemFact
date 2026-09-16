/**
 * Reportes domain — the per-period ITBIS summary and the IT-1 casilla worksheet (FIS-1, FIS-2;
 * slice E, task 5.6).
 *
 * ADR-013: PURE TypeScript, Decimal-only money. These are the two fiscal SCREEN figures the panel
 * renders and the CSV/TXT cross-checks derive — the arithmetic is the contract, the SQL only
 * supplies already-aggregated Decimal-string inputs (never a fetch-then-sum, OP-5).
 *
 * FIS-1 — the ITBIS summary per SD period: débito fiscal (Σ607 ITBIS facturado over VIGENTE
 * Facturas WITH the B04-NotaCrédito / B03-NotaDébito NCF adjustments already netted into the
 * aggregate by sign), the purchase-side ITBIS/ISR retenido (Σ606), and a documented note that B11
 * informal purchases yield NO ITBIS credit (they are excluded from the creditable-adelanto Σ by the
 * 606 derivation — B11 ITBIS-al-Costo, so ITBIS-por-Adelantar = 0 — and the note makes the reason
 * explicit in-report, spec FIS-1).
 *
 * FIS-2 — IT-1 is a CASILLA WORKSHEET, NEVER a TXT (DGII accepts no IT-1 file). Débito = Σ607
 * ITBIS facturado; crédito/adelantos = Σ606 ITBIS-por-Adelantar; ITBIS retenido = Σ606 retenido,
 * SELF-CHECKED to equal IT-1 casilla 60 (the OFV blocks the declaration on mismatch, research §6).
 * The retenido figure is DEFINED as Σ606, so it cuadra by construction; a `casilla60Manual`
 * (an operator-entered override, if any) is compared against it and a mismatch is surfaced as a
 * validation WARNING (never a silent agreement — spec FIS-2 scenario). Neto a pagar = débito −
 * crédito (may be a saldo a favor when negative — reported honestly, never clamped to 0).
 */

import { Decimal } from "decimal.js";

/** One rounded money value (2 dp) as a fixed string — the `Decimal(12,2)` serialisation scale. */
function dinero(d: Decimal): string {
  return d.toDecimalPlaces(2).toFixed(2);
}

/**
 * The frozen in-report note that B11 informal purchases produce NO ITBIS credit (spec FIS-1). One
 * source shared by the summary screen and the IT-1 worksheet so the two never word it differently.
 */
export const NOTA_B11_SIN_CREDITO_FISCAL =
  "Las compras B11 (informales) no generan crédito de ITBIS: su ITBIS se lleva al costo, por lo que " +
  "no forman parte del crédito fiscal / ITBIS por adelantar de este período.";

/** The frozen day-20 IT-1 due-date guidance text (research §6: declaration & payment by the 20th). */
export const NOTA_VENCIMIENTO_IT1 =
  "IT-1: la declaración y el pago del ITBIS vencen el día 20 del mes siguiente al período declarado " +
  "(recargo de mora 10% el primer mes + 4% progresivo + interés indemnizatorio 1,10%).";

/** The already-aggregated Decimal-string inputs feeding the ITBIS summary (FIS-1). */
export interface InsumoResumenITBIS {
  /** Σ ITBIS facturado on VIGENTE sales docs in the period, incl. B03/B04 NCF netting (D9). */
  readonly itbisVentas: string;
  /** Σ base facturado gravado on those sales docs (for the summary display). */
  readonly baseGravadaVentas: string;
  /** Σ ITBIS facturado on eligible 606 purchases (D11). */
  readonly itbisComprasFacturado: string;
  /** Σ ITBIS-por-Adelantar (D15 = D11 − D14-al-Costo; B11 rows contribute 0). */
  readonly itbisComprasAdelantar: string;
  /** Σ ITBIS retenido on purchases (D12) — feeds IT-1 casilla 60. */
  readonly itbisRetenidoCompras: string;
  /** Σ ISR retenido on purchases (D18). */
  readonly isrRetenidoCompras: string;
}

/** FIS-1 — the per-period ITBIS summary (all Decimal strings). */
export interface ResumenITBIS extends InsumoResumenITBIS {
  /** Débito fiscal for the period = the sales-side ITBIS aggregate. */
  readonly debitoFiscal: string;
  /** Crédito/adelantos = the 606 ITBIS-por-Adelantar aggregate. */
  readonly creditoFiscal: string;
  /** ITBIS retenido (Σ606 D12) — the casilla-60 basis. */
  readonly itbisRetenido: string;
  /** ISR retenido (Σ606 D18). */
  readonly isrRetenido: string;
}

/** Build the ITBIS summary from the aggregates (FIS-1). Pure Decimal reduction of pre-summed rows. */
export function construirResumenITBIS(insumo: InsumoResumenITBIS): ResumenITBIS {
  return {
    ...insumo,
    debitoFiscal: dinero(new Decimal(insumo.itbisVentas)),
    creditoFiscal: dinero(new Decimal(insumo.itbisComprasAdelantar)),
    itbisRetenido: dinero(new Decimal(insumo.itbisRetenidoCompras)),
    isrRetenido: dinero(new Decimal(insumo.isrRetenidoCompras)),
  };
}

/** FIS-2 — the IT-1 casilla worksheet + its self-check verdict. */
export interface CasillasIT1 {
  readonly debitoFiscal: string;
  readonly creditoAdelantos: string;
  readonly itbisRetenido: string; // = Σ606 retenido (the casilla-60 figure)
  readonly isrRetenido: string;
  readonly netoAPagar: string; // débito − crédito (may be a saldo a favor, i.e. negative)
  /** True when the retenido figure equals Σ606 (cuadra) or no manual override disagrees. */
  readonly cuadreRetenido: boolean;
  /** A human-readable warning when a manual casilla-60 override mismatches Σ606, else null. */
  readonly avisoValidacion: string | null;
}

/**
 * Build the IT-1 casilla worksheet (FIS-2). `resumen` supplies the 606/607-derived figures;
 * `casilla60Manual` is an OPTIONAL operator-entered IT-1 casilla 60 value — when provided and it
 * differs from Σ606 retenido, the worksheet flags a validation warning (the OFV would block the
 * declaration), never silently trusting either side. When omitted the figure IS Σ606 and cuadra.
 */
export function construirCasillasIT1(
  resumen: ResumenITBIS,
  casilla60Manual?: string | null,
): CasillasIT1 {
  const debito = new Decimal(resumen.debitoFiscal);
  const credito = new Decimal(resumen.creditoFiscal);
  const retenido = new Decimal(resumen.itbisRetenido); // Σ606 — the authoritative casilla 60
  const neto = debito.minus(credito); // IT-1 net before adding the Renglón A retenido/percibido

  let aviso: string | null = null;
  let cuadre = true;
  if (casilla60Manual !== undefined && casilla60Manual !== null && casilla60Manual !== "") {
    const manual = new Decimal(casilla60Manual).toDecimalPlaces(2);
    if (!manual.equals(retenido.toDecimalPlaces(2))) {
      cuadre = false;
      aviso =
        `Casilla 60 declarada (${manual.toFixed(2)}) no cuadra con el Σ ITBIS retenido del 606 ` +
        `(${retenido.toFixed(2)}). La Oficina Virtual bloqueará la declaración hasta corregirlo.`;
    }
  }

  return {
    debitoFiscal: dinero(debito),
    creditoAdelantos: dinero(credito),
    itbisRetenido: dinero(retenido),
    isrRetenido: dinero(new Decimal(resumen.isrRetenido)),
    netoAPagar: dinero(neto),
    cuadreRetenido: cuadre,
    avisoValidacion: aviso,
  };
}
