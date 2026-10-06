import { createClient } from "@/lib/supabase/client";
import { getCurrentTenantContext } from "@/modules/tenant/infrastructure/tenant-runtime";
import { type CompraErrorCode } from "../domain/errors";

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: CompraErrorCode; message: string } };

// Compra-core is an operational/management capability reserved for the tenant
// Administrador (product decision 7 / role matrix 04). Server-side enforcement
// is the control — hiding UI buttons is not security.
export const ROLES_ADMIN_ONLY = ["Administrador"];

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