/**
 * Application use case — `consultarRolesCatalogo` (Step 7b, S11).
 *
 * The active ROL catalog the Administración screen turns into role checkboxes.
 * Authorization is the caller's (the action checks the named role group before
 * delegating); this use case only reads.
 */

import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { RolCatalogo } from "../domain/usuario-gestion";
import { listarRolesActivosEnTx } from "../infrastructure/roles-catalogo-repository";

export type ConsultarRolesCatalogoResult = {
  ok: true;
  data: readonly RolCatalogo[];
};

export async function consultarRolesCatalogo(
  tx: PrismaTx,
): Promise<ConsultarRolesCatalogoResult> {
  return { ok: true, data: await listarRolesActivosEnTx(tx) };
}
