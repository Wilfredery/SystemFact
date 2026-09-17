/**
 * Reportes domain — the DGII "Tipo de Identificación" (607 D2 / 606 D2) code (FIS-3/FIS-4; slice E).
 *
 * ADR-013: PURE TypeScript. The DGII code is 1 = RNC, 2 = Cédula, 3 = sin identificación (final
 * consumer only — research §3 D2, §4 D2). SystemFact stores the counterparty id (`Cliente.identificacionFiscal`
 * / `Proveedor.rnc`) with its NATURAL length (9-digit RNC, 11-digit Cédula — the same mod-11 rules
 * the shared `fiscal-id` validator pins, docs/13 §39–40), so the DGII type is DERIVED purely from
 * the separator-stripped length: 9 → RNC, 11 → Cédula, anything else (or absent) → 3 (no id). A
 * documented final consumer (B02) has no id and is type 3 with a blank D1 (spec FIS-3). This is a
 * classification rule (domain), NOT a DB parameter, so it lives here as a pure testable function;
 * the repository hands the raw id/flag in and this maps it.
 */

import { validarCedula, validarRnc } from "@/shared/domain/fiscal-id";

/** The three DGII identification-type codes. */
export const TIPO_IDENTIFICACION = {
  RNC: 1,
  CEDULA: 2,
  SIN_IDENTIFICACION: 3,
} as const;

/**
 * Derive the DGII D2 code from a counterparty fiscal id + a "final consumer" flag. A flagged final
 * consumer (or a missing/blank id) is type 3 with no emitted id; otherwise the mod-11 validator
 * discriminates RNC (9-digit, valid) vs Cédula (11-digit, valid); a present-but-unvalid id falls
 * back to 3 so a DGII row NEVER carries a wrong type. Returns the code AND the stripped id to emit
 * in D1 (blank for type 3).
 */
export function derivarTipoIdentificacion(
  identificacionFiscal: string | null | undefined,
  esConsumidorFinal = false,
): { readonly tipo: 1 | 2 | 3; readonly identificacion: string } {
  if (esConsumidorFinal) return { tipo: TIPO_IDENTIFICACION.SIN_IDENTIFICACION, identificacion: "" };
  const raw = (identificacionFiscal ?? "").replace(/[\s-]/g, "");
  if (raw === "") return { tipo: TIPO_IDENTIFICACION.SIN_IDENTIFICACION, identificacion: "" };
  if (validarRnc(raw).ok) return { tipo: TIPO_IDENTIFICACION.RNC, identificacion: raw };
  if (validarCedula(raw).ok) return { tipo: TIPO_IDENTIFICACION.CEDULA, identificacion: raw };
  return { tipo: TIPO_IDENTIFICACION.SIN_IDENTIFICACION, identificacion: "" };
}
