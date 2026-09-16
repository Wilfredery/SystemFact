/**
 * Auditoria infrastructure — the single, total domain↔Prisma enum map.
 *
 * The domain union `AccionAuditoria` (in `../domain/auditoria.ts`, DB-free) and the
 * generated Prisma enum carry the SAME string literals, but the domain must never
 * import Prisma and the boundary must stay compiler-checked. An exhaustive
 * `Record<AccionAuditoria, PrismaAccionAuditoria>` is the drift guard shared by BOTH
 * the read repository (mapping the filter's `accion` to the query) and the write
 * adapter (mapping the event's `accion` to the persisted column):
 *   • adding a variant to the domain union without extending this map fails `tsc`;
 *   • adding one to the Prisma enum without also extending the domain union fails
 *     the Slice-A drift guard in `domain/auditoria.test.ts`.
 *
 * It lives in `infrastructure/` (never `domain/`) because the whole point is to keep
 * the generated enum on the Prisma side of the ADR-013 boundary.
 */

import { AccionAuditoria as PrismaAccionAuditoria } from "@/generated/prisma/client";
import type { AccionAuditoria } from "../domain/auditoria";

/** Total domain → Prisma-enum map (exhaustive; compiler-checked against both unions). */
export const PRISMA_ACCION: Record<AccionAuditoria, PrismaAccionAuditoria> = {
  CREAR: PrismaAccionAuditoria.CREAR,
  ACTUALIZAR: PrismaAccionAuditoria.ACTUALIZAR,
  CANCELAR: PrismaAccionAuditoria.CANCELAR,
  ANULAR: PrismaAccionAuditoria.ANULAR,
  PAGAR: PrismaAccionAuditoria.PAGAR,
  AJUSTAR: PrismaAccionAuditoria.AJUSTAR,
  LOGIN: PrismaAccionAuditoria.LOGIN,
  LOGOUT: PrismaAccionAuditoria.LOGOUT,
  LEER: PrismaAccionAuditoria.LEER,
};

/** Map a domain action to its persisted Prisma enum value. */
export function accionAuditoriaADb(accion: AccionAuditoria): PrismaAccionAuditoria {
  return PRISMA_ACCION[accion];
}
