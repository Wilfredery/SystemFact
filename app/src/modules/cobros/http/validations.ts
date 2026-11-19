/**
 * Cobros HTTP input validation (Zod) + transport error codes.
 *
 * Zod owns the TRANSPORT contract only: integer ids, positive `Decimal(12,2)`
 * amounts, and the MANDATORY refund idempotency key. Business rules — the
 * VIGENTE-invoice check, the over-payment guard, the idempotency replay/race,
 * tenant/branch scoping — stay in the domain/application and surface as the
 * stable 600-series codes. Zod is NEVER the authorization authority; role gating
 * happens server-side inside `withTenantTransaction` (R-C6), mirroring the
 * devolucion/venta convention.
 *
 * The two codes below are the HTTP/transport rejections (bad session + malformed
 * payload); authorization rejections use the domain's `PAGO_NO_AUTORIZADO`, so
 * the whole cobros error surface stays inside the single versioned catalog.
 */

import { z } from "@/lib/zod";

/** Stable transport codes (not part of the domain business catalog). */
export const VALIDATION_ERROR = "VALIDATION_ERROR";
export const SESION_INVALIDA = "SESION_INVALIDA";

const MENSAJES_TRANSPORTE: Record<string, string> = {
  [VALIDATION_ERROR]: "Datos de entrada inválidos",
  [SESION_INVALIDA]: "Sesión no válida o expirada",
};

export function mensajeTransporte(code: string): string {
  return MENSAJES_TRANSPORTE[code] ?? "Error";
}

// A positive `Decimal(12,2)` money string: up to 10 integer digits + 2 decimals,
// and NOT zero. The exact column precision is enforced here; the domain still
// re-derives nothing from the wire (monto is trusted as text, then Decimal).
const zMontoPositivo = z
  .string()
  .regex(/^\d{1,10}(\.\d{1,2})?$/, "monto inválido")
  .refine((v) => !/^0+(\.0+)?$/.test(v), "el monto debe ser mayor que cero");

const zFacturaId = z.number().int().positive();

// S14 — the OPTIONAL editable Fecha del pago as an SD CALENDAR DATE: the shape
// only (`YYYY-MM-DD` and a day that really exists). The BAND (future / retroactive
// horizon) is a server-clock business rule and lives in
// `cobros/domain/fecha-cobro.ts`, never in the transport grammar.
const zFechaCobro = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "fecha inválida")
  .refine((v) => {
    const [y, mo, d] = v.split("-").map(Number);
    const fecha = new Date(Date.UTC(y, mo - 1, d, 12));
    return (
      !Number.isNaN(fecha.getTime()) &&
      fecha.getUTCFullYear() === y &&
      fecha.getUTCMonth() === mo - 1 &&
      fecha.getUTCDate() === d
    );
  }, "fecha inválida");

// S14 — the OPTIONAL free-text payment reference, bounded to the
// `PAGO.referencia` VarChar(80) column so the transport can never overflow it.
// Trimmed here: a padded value is stored exactly as the user meant it.
const zReferencia = z.string().trim().max(80, "referencia demasiado larga");

export const zRegistrarCobroInput = z.object({
  facturaId: zFacturaId,
  monto: zMontoPositivo,
  fechaCobro: zFechaCobro.optional(),
  referencia: zReferencia.optional(),
});
export type RegistrarCobroDto = z.infer<typeof zRegistrarCobroInput>;

// The idempotency key is MANDATORY here (task 2.5): no refund is accepted without
// a client-generated key, and the length bounds keep it within the VarChar(255)
// column while excluding a trivial placeholder.
export const zRegistrarReembolsoInput = z.object({
  facturaId: zFacturaId,
  monto: zMontoPositivo,
  idempotencyKey: z.string().min(8).max(255),
});
export type RegistrarReembolsoDto = z.infer<typeof zRegistrarReembolsoInput>;

// The board read carries the OPTIONAL paging intent only — the shared
// normalization playbook (`normalizarPagina`/`normalizarTamanoPagina`) owns the
// caps: any raw number is NORMALIZED before data access (R-C9 "outside the clamp
// MUST be normalized") — 0/absent → 25, 250 → 100, page floor ≥ 1.
// The BOARD search (board-03 S12) rides the same read: raw text only, bounded so
// a hostile payload cannot build an unbounded LIKE pattern. The SERVER normalizes
// it (`normalizarBusquedaCxc`: trim, collapse, case-fold, LIKE-escape) and a
// blank value means "no filter" — Zod owns the SHAPE, never the normalization.
export const zConsultarSaldoCxcInput = z
  .object({
    page: z.number().optional(),
    pageSize: z.number().optional(),
    busqueda: z.string().max(200).optional(),
  })
  .optional();

// The customer statement keeps NO paging surface: it serves the FULL canonical
// account every read (whole view incl. settled rows — R-C7 statement semantics).
export const zConsultarEstadoCuentaInput = z.object({}).optional();

// The per-invoice detail read (board-03 S13) is addressed by the invoice id only:
// a positive integer, so a malformed route segment never reaches the use case.
// A cancelled/annulled/foreign invoice is the domain catalog's case (Zod owns the
// SHAPE only, never a business verdict).
export const zConsultarDetalleCxcInput = z.object({
  facturaId: zFacturaId,
});
export type ConsultarDetalleCxcDto = z.infer<typeof zConsultarDetalleCxcInput>;

// A receipt reprint is addressed by its company-serialized correlativoRecibo (R-C4).
// A positive integer only — the domain/catalog owns the not-found case; Zod owns the
// SHAPE (an id-less reprint request never reaches the read use case).
export const zConsultarReciboInput = z.object({
  correlativoRecibo: z.number().int().positive(),
});
export type ConsultarReciboDto = z.infer<typeof zConsultarReciboInput>;
