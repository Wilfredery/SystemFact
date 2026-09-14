/**
 * Devolucion HTTP input validation (Zod) + transport error codes.
 *
 * Zod owns the TRANSPORT contract only: integer ids, Decimal-string shapes
 * bounded to the column precision (`cantidad` `Decimal(12,3)`), the frozen
 * `TIPO_REPOSICION` enum, the ≥1 line requirement and a bounded line count.
 * Business rules — the SD return window, the cumulative returned-quantity cap
 * vs the ORIGINAL sale, the frozen money/rate mirror, product ownership,
 * tenant/branch scoping — stay in the domain/application and surface as the
 * stable venta-catalog codes; zod is NEVER the authorization authority
 * (R-V8/R-V13, same discipline as `venta/http/validations.ts`).
 *
 * The three codes below are the HTTP/transport rejections (auth + malformed
 * payload). They are deliberately NOT in a domain business catalog — they live
 * at the boundary, mirroring the venta convention.
 */

import { z } from "zod";
import { TIPO_REPOSICION } from "../domain/devolucion";

/** Stable HTTP/transport codes (not part of the domain business catalog). */
export const VALIDATION_ERROR = "VALIDATION_ERROR";
export const SESION_INVALIDA = "SESION_INVALIDA";
export const NO_AUTORIZADO = "NO_AUTORIZADO";

const MENSAJES_TRANSPORTE: Record<string, string> = {
  [VALIDATION_ERROR]: "Datos de entrada inválidos",
  [SESION_INVALIDA]: "Sesión no válida o expirada",
  [NO_AUTORIZADO]: "No tiene permisos para realizar esta acción",
};

export function mensajeTransporte(code: string): string {
  return MENSAJES_TRANSPORTE[code] ?? "Error";
}

// Base-unit quantity: up to 9 integer digits and 3 decimals (Decimal(12,3)).
const zCantidad = z.string().regex(/^\d{1,9}(\.\d{1,3})?$/, "cantidad inválida");

const zLineaDevolucion = z.object({
  productoId: z.number().int().positive(),
  cantidad: zCantidad,
  // Frozen VENDIBLE/DANADO classification (R-D4) — validated here AND in-domain.
  tipoReposicion: z.enum([TIPO_REPOSICION.VENDIBLE, TIPO_REPOSICION.DANADO]),
});

// The return payload: only the venta id + motivo + lines. Money, rates and the
// per-line totals are NEVER trusted from the wire — they are re-derived from
// the ORIGINAL sale rows inside the use case (frozen mirror, R-D5).
export const zDevolverVentaInput = z.object({
  ventaId: z.number().int().positive(),
  motivo: z.string().trim().min(1).max(255),
  // ≥1 line; hard ceiling aligned to the pagination limits convention, so no
  // unbounded return payload can execute.
  lineas: z.array(zLineaDevolucion).min(1).max(100),
});
export type DevolverVentaInputDto = z.infer<typeof zDevolverVentaInput>;