/**
 * Tenant repository — the ROL catalog read for the Administración role dialog
 * (Step 7b, S11). Read-only.
 *
 * `ROL` is a GLOBAL catalog (no `empresaId` column), so there is no tenant
 * predicate to pin; what is pinned is `activo = true`, because only active
 * roles may be assigned (the write path validates the same rule server-side).
 * Explicit select, deterministic order and a hard `take`: the catalog is a
 * handful of rows, the bound is the AGENTS.md "no unbounded findMany" rule.
 */

import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { RolCatalogo } from "../domain/usuario-gestion";

const MAX_ROLES_CATALOGO = 100;

/** The active catalog roles, ordered by name. */
export async function listarRolesActivosEnTx(tx: PrismaTx): Promise<RolCatalogo[]> {
  return tx.rol.findMany({
    where: { activo: true },
    select: { id: true, nombre: true },
    orderBy: { nombre: "asc" },
    take: MAX_ROLES_CATALOGO,
  });
}
