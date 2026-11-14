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

// ONE code for "that user cannot be managed by you": unknown id, foreign-empresa
// id and other-branch id are INDISTINGUISHABLE (empresa filter + RLS make
// "elsewhere" and "not exist" unobservable) — same tenant-blind rationale as
// TEN_SUCURSAL_NO_VALIDA, so the write path is not a cross-tenant oracle.
export const TEN_USUARIO_NO_ENCONTRADO = "TEN_USUARIO_NO_ENCONTRADO";
// Optimistic lock (Directiva §10): same suffix convention as the other modules
// (cliente/categoria CONCURRENCIA_CONFLICTO), tenant-prefixed.
export const TEN_CONCURRENCIA_CONFLICTO = "TEN_CONCURRENCIA_CONFLICTO";
export const TEN_ROL_NO_VALIDO = "TEN_ROL_NO_VALIDO";
export const TEN_ULTIMO_ADMINISTRADOR = "TEN_ULTIMO_ADMINISTRADOR";
export const TEN_AUTO_PROTECCION = "TEN_AUTO_PROTECCION";

export const TEN_ERROR_CODES = [
  TEN_OPS_NO_AUTORIZADO,
  TEN_SUCURSAL_NO_VALIDA,
  TEN_USUARIO_NO_ENCONTRADO,
  TEN_CONCURRENCIA_CONFLICTO,
  TEN_ROL_NO_VALIDO,
  TEN_ULTIMO_ADMINISTRADOR,
  TEN_AUTO_PROTECCION,
] as const;

export type TenantErrorCode = (typeof TEN_ERROR_CODES)[number];

const TEN_ERROR_MESSAGES: Readonly<Record<TenantErrorCode, string>> = {
  [TEN_OPS_NO_AUTORIZADO]: "No tienes permiso para esta operación.",
  // Tenant-blind on purpose: never discloses whether the branch belongs to
  // another empresa or is inactive — both read as "not available to you".
  [TEN_SUCURSAL_NO_VALIDA]: "La sucursal indicada no está disponible.",
  [TEN_USUARIO_NO_ENCONTRADO]: "El usuario indicado no está disponible.",
  [TEN_CONCURRENCIA_CONFLICTO]:
    "Otro usuario modificó este usuario; recargue y reintente.",
  [TEN_ROL_NO_VALIDO]:
    "Los roles indicados no son válidos: seleccione al menos un rol activo, sin repetir.",
  [TEN_ULTIMO_ADMINISTRADOR]:
    "La sucursal debe conservar al menos un Administrador activo.",
  [TEN_AUTO_PROTECCION]:
    "No puede desactivarse ni quitarse el rol de Administrador a sí mismo.",
};

export function messageFor(code: TenantErrorCode): string {
  return TEN_ERROR_MESSAGES[code];
}
