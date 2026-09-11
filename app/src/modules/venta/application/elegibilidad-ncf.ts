/**
 * NCF type eligibility (spec R-F2, design D2a) — a PURE application helper.
 *
 * Chooses the invoice `tipoNcf` for a confirmed sale from data the sale already
 * owns: the client's `esConsumidorFinal` flag and its normalized fiscal id. No
 * DGII portal lookup and no corporate 11-digit validation are performed here
 * (D6 — `shared/domain/fiscal-id.ts` stays unchanged); the misclassification risk
 * that follows is a documented V1 limitation (Open Questions).
 *
 * Fail-closed rule: B01 is granted ONLY to a non–Consumidor-Final client carrying
 * a valid 9-digit RNC per the existing mod-11 validator. Everything else — the
 * CF row, a missing id, or a degenerate/invalid id — falls back to B02 so no sale
 * is ever blocked by bad fiscal data; it just invoices as a final consumer.
 *
 * Domain purity (ADR-013): the only imports are the shared pure validator and the
 * NCF domain RESULT types (the shape lives in the ncf module so later fases share
 * it). This fn touches no DB and no Prisma; the caller supplies the client facts
 * read from the repository.
 */

import { validarRnc } from "@/shared/domain/fiscal-id";
import type { ElegibilidadNcf } from "@/modules/ncf/domain/ncf-rules";

/** The client facts the eligibility decision needs. */
export interface DatosElegibilidadNcf {
  readonly esConsumidorFinal: boolean;
  /** Normalized fiscal id as persisted; `null` when the client has none (CF). */
  readonly identificacionFiscal: string | null;
}

/**
 * Decide B01/B02 for a sale's invoice. See the module header for the exact rule
 * and the fail-closed-on-degenerate-data guarantee (R-F2).
 */
export function seleccionarTipoNcf(
  datos: DatosElegibilidadNcf,
): ElegibilidadNcf {
  if (datos.esConsumidorFinal) {
    return { tipo: "B02", motivo: "CONSUMIDOR_FINAL" };
  }

  const id = datos.identificacionFiscal;
  if (id !== null && validarRnc(id).ok) {
    return { tipo: "B01", motivo: "CONTRIBUYENTE" };
  }

  // A named client without a usable 9-digit RNC: invoice as final consumer rather
  // than hard-failing — degenerate data fails CLOSED to B02 (design D2a).
  return { tipo: "B02", motivo: "DATOS_DEGENERADOS" };
}
