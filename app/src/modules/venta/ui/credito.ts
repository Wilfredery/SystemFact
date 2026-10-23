/**
 * Venta UI — F2 credit display derivations (R-V19 / R-V20 / R-V27 consumer side).
 *
 * Pure, hookless, no React imports (D3/D6): every F2 credit *display* fact the
 * POS needs lives here as a testable function. This module NEVER imports the
 * cobros module at runtime — the rejection-code strings are vendored locally
 * as `as const` and a unit test pins them to `CREDITO_RECHAZO_CODES`
 * (cobros/domain/credito.ts) so the two cannot drift.
 *
 * The derivation is a MIRROR of the backend rule — never a second source of
 * truth: `esVentaCredito = !esConsumidorFinal && tipoCliente === "CREDITO"`
 * (see `leerPerfilCreditoEnTx` in cobros/infrastructure/saldo-cxc.repository.ts;
 * NOT the `creditoHabilitado` flag). Money crosses the boundary as
 * Decimal-string money (DTO contract); nothing here decides, persists, or sends.
 */

/** The sale form, derived — there is NO contado/crédito toggle anywhere. */
export type FormaVenta = "CONTADO" | "CREDITO";

/**
 * Mirror of the backend credit-sale rule for a selected client profile.
 * `null` (no client selected) is the Consumidor-Final contado default.
 */
export function derivarFormaVenta(p: {
  readonly esConsumidorFinal: boolean;
  readonly tipoCliente: string;
} | null): FormaVenta {
  if (p === null) return "CONTADO";
  return !p.esConsumidorFinal && p.tipoCliente === "CREDITO"
    ? "CREDITO"
    : "CONTADO";
}

/** `en-CA` yields an ISO-like `YYYY-MM-DD` that compares in calendar order. */
const FORMATO_FECHA_SD = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Santo_Domingo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** One millisecond-day; SD (UTC-4) has no DST, so adding it shifts the SD date exactly. */
const MILISEGUNDOS_POR_DIA = 86_400_000;

/**
 * The invoice due date for display: emission instant + N calendar days,
 * expressed as its `America/Santo_Domingo` calendar date (`YYYY-MM-DD`).
 * Mirrors `fechaVencimiento` from cobros/domain/en-mora.ts (drift-guarded by
 * test) — display-only per ADR-017: no venta field, column, or parameter.
 */
export function derivarVencimiento(
  fechaEmisionISO: string,
  plazoCreditoDias: number,
): string {
  if (!Number.isInteger(plazoCreditoDias) || plazoCreditoDias < 0) {
    throw new Error(
      `derivarVencimiento: plazoCreditoDias inválido (${String(plazoCreditoDias)})`,
    );
  }
  const emision = new Date(fechaEmisionISO);
  const due = new Date(emision.getTime() + plazoCreditoDias * MILISEGUNDOS_POR_DIA);
  return FORMATO_FECHA_SD.format(due);
}

/** Vendored copies of the cobros catalog codes (test-pinned, see module header). */
export const RECHAZO_CODIGO_CREDITO_NO_HABILITADO = "CREDITO_NO_HABILITADO";
export const RECHAZO_CODIGO_LIMITE_EXCEDIDO = "LIMITE_CREDITO_EXCEDIDO";
export const RECHAZO_CODIGO_CLIENTE_EN_MORA = "CLIENTE_EN_MORA";

/** Distinct Badge/Card treatment per rejection code (never raw-code-only copy). */
export interface SuperficieRechazoCredito {
  readonly titulo: string;
  readonly texto: string;
  readonly variante: "deuda-vencida" | "limite-excedido" | "credito-no-habilitado";
}

const SUPERFICIES: Record<string, SuperficieRechazoCredito> = {
  [RECHAZO_CODIGO_CLIENTE_EN_MORA]: {
    titulo: "Client has overdue invoices",
    texto:
      "Sales on credit are blocked while the client keeps invoices past their due term.",
    variante: "deuda-vencida",
  },
  [RECHAZO_CODIGO_LIMITE_EXCEDIDO]: {
    titulo: "Credit limit exceeded",
    texto: "This sale would exceed the client's authorized credit limit.",
    variante: "limite-excedido",
  },
  [RECHAZO_CODIGO_CREDITO_NO_HABILITADO]: {
    titulo: "Credit not enabled for this client",
    texto:
      "Sell cash instead: select a non-credit client or keep Consumidor Final, which stays un-gated.",
    variante: "credito-no-habilitado",
  },
} as const;

/**
 * Map a stable credit-gate rejection code to its fixed display surface, or
 * `null` for anything non-cataloged (the PosScreen error path falls back to
 * the generic `[CODE] text` banner).
 */
export function superficieRechazoCredito(
  code: string,
): SuperficieRechazoCredito | null {
  return SUPERFICIES[code] ?? null;
}
