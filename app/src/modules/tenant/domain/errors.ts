/**
 * Tenant domain — error codes and messages.
 *
 * Pure TypeScript. No imports from Next.js, React, Prisma, or Supabase.
 * Single source of truth for tenant error codes (19-directivas §9); adapters
 * and components NEVER inline these strings (“F1 auth-tenant-selector”,
 * TEN-CAT-02). Messages are user-facing Spanish; codes are stable and
 * versioned alongside the domain.
 */

export const TEN_OPS_NO_AUTORIZADO = "TEN_OPS_NO_AUTORIZADO";
// ONE code for "the target branch cannot be used": a foreign-empresa branch and
// an inactive own branch are INDISTINGUISHABLE by construction (P6 empresa
// filter + RLS make "elsewhere" and "not exist" unobservable, same rationale as
// AUTH_ENLACE_NO_RESUELTO). Splitting them would fabricate a distinction the
// system cannot make — and would hand a caller a cross-tenant oracle.
export const TEN_SUCURSAL_NO_VALIDA = "TEN_SUCURSAL_NO_VALIDA";

export const TEN_ERROR_CODES = [
  TEN_OPS_NO_AUTORIZADO,
  TEN_SUCURSAL_NO_VALIDA,
] as const;

export type TenantErrorCode = (typeof TEN_ERROR_CODES)[number];

const TEN_ERROR_MESSAGES: Readonly<Record<TenantErrorCode, string>> = {
  [TEN_OPS_NO_AUTORIZADO]: "No tienes permiso para esta operación.",
  // Tenant-blind on purpose: never discloses whether the branch belongs to
  // another empresa or is inactive — both read as "not available to you".
  [TEN_SUCURSAL_NO_VALIDA]: "La sucursal indicada no está disponible.",
};

export function messageFor(code: TenantErrorCode): string {
  return TEN_ERROR_MESSAGES[code];
}
