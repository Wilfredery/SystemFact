import { createClient } from "@/lib/supabase/client";
import { getCurrentTenantContext } from "@/modules/tenant/infrastructure/tenant-runtime";
import { type CompraErrorCode } from "../domain/errors";

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: CompraErrorCode; message: string } };

// One named group per capability (screens plan Step 6, S3), so a future change
// of who may do what is a one-line edit here. Screens and actions read these
// groups, never a literal role name.
//
// View: list and read purchases (and the permissions probe). Operador and
// Despachador receive purchases, so they must see the purchase list even though
// they cannot change it.
export const ROLES_VER_COMPRAS = ["Administrador", "Operador", "Despachador"];

// Manage: create, edit, confirm, cancel and receive purchases. Server-side
// enforcement is the control — hiding UI buttons is not security.
export const ROLES_GESTION_COMPRAS = ["Administrador"];

export function ok<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}

export function error(code: CompraErrorCode, message: string): ActionResult<never> {
  return { ok: false, error: { code, message } };
}

export async function resolverCtx() {
  const supabase = await createClient();
  return getCurrentTenantContext(supabase);
}