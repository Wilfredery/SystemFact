/**
 * Reportes infrastructure — the acting user's DB role names (DB-2 authorization source).
 *
 * A tiny, single read used ONLY to resolve the server-side role gate: the caller's
 * `USUARIO_ROL → ROL.nombre` set, pinned to `empresaId`. The tenant `TenantCtx` only
 * surfaces `esAdmin`, but reportes needs the FULL role set to distinguish Cobrador (CxC-
 * family, own branch) from Operador/Despachador (no reportes reads) per DB-2, so we read
 * the actual DB roles — the same authority `tieneRolPermitidoEnTx` relies on (hiding UI is
 * never the control). Prisma access stays in infrastructure; only the string[] crosses back.
 *
 * Runs inside the caller's `withTenantTransaction` (RLS in force) and additionally pins
 * `empresaId` explicitly (defense in depth). A missing/foreign user yields `[]` (deny).
 */

import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";

export async function leerRolesUsuarioEnTx(
  tx: PrismaTx,
  ctx: TenantCtx,
): Promise<string[]> {
  const usuario = await tx.usuario.findFirst({
    where: { id: ctx.usuarioId, empresaId: ctx.empresaId },
    select: { roles: { select: { rol: { select: { nombre: true } } } } },
  });
  if (usuario === null) return [];
  return usuario.roles.map((r) => r.rol.nombre);
}
