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

import { z } from "zod";

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

export const zRegistrarCobroInput = z.object({
  facturaId: zFacturaId,
  monto: zMontoPositivo,
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

// The CxC read takes no filter in V1 (the board is the whole branch receivable);
// an empty object is accepted so the caller can pass nothing.
export const zConsultarSaldoCxcInput = z.object({}).optional();
