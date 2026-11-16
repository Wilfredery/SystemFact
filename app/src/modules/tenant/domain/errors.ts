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
// Branch names are unique per empresa (trimmed, case-insensitive) and INACTIVE
// branches count too: the admin list shows active branches only.
export const TEN_SUCURSAL_NOMBRE_DUPLICADO = "TEN_SUCURSAL_NOMBRE_DUPLICADO";
// Deactivating a branch (odd/tasks/administracion-sucursales-activar.md S3/S4):
// one code per refusal reason; all reasons that apply are reported together.
export const TEN_SUCURSAL_CON_USUARIOS = "TEN_SUCURSAL_CON_USUARIOS";
export const TEN_SUCURSAL_CON_STOCK = "TEN_SUCURSAL_CON_STOCK";
export const TEN_SUCURSAL_CON_DOCUMENTOS_ABIERTOS = "TEN_SUCURSAL_CON_DOCUMENTOS_ABIERTOS";
export const TEN_SUCURSAL_CON_SALDOS_PENDIENTES = "TEN_SUCURSAL_CON_SALDOS_PENDIENTES";
export const TEN_SUCURSAL_PROPIA_NO_DESACTIVABLE = "TEN_SUCURSAL_PROPIA_NO_DESACTIVABLE";
export const TEN_SUCURSAL_ULTIMA_ACTIVA = "TEN_SUCURSAL_ULTIMA_ACTIVA";
// Activating a user whose own branch is inactive (L8): TEN_SUCURSAL_NO_VALIDA is
// tenant-blind on purpose and its message cannot tell the admin what to do, so
// this refusal has its own code (the admin sees the user's own branch anyway).
export const TEN_USUARIO_SUCURSAL_INACTIVA = "TEN_USUARIO_SUCURSAL_INACTIVA";
// Feature itbis-tasas-edit: the submitted rate list fails the shared parser
// (empty element, bad format, >100, duplicate). The UI pre-validates with the
// same parser; this is the server's typed refusal.
export const TEN_TASA_ITBIS_INVALIDA = "TEN_TASA_ITBIS_INVALIDA";

export const TEN_ERROR_CODES = [
  TEN_OPS_NO_AUTORIZADO,
  TEN_SUCURSAL_NO_VALIDA,
  TEN_USUARIO_NO_ENCONTRADO,
  TEN_CONCURRENCIA_CONFLICTO,
  TEN_ROL_NO_VALIDO,
  TEN_ULTIMO_ADMINISTRADOR,
  TEN_AUTO_PROTECCION,
  TEN_SUCURSAL_NOMBRE_DUPLICADO,
  TEN_SUCURSAL_CON_USUARIOS,
  TEN_SUCURSAL_CON_STOCK,
  TEN_SUCURSAL_CON_DOCUMENTOS_ABIERTOS,
  TEN_SUCURSAL_CON_SALDOS_PENDIENTES,
  TEN_SUCURSAL_PROPIA_NO_DESACTIVABLE,
  TEN_SUCURSAL_ULTIMA_ACTIVA,
  TEN_USUARIO_SUCURSAL_INACTIVA,
  TEN_TASA_ITBIS_INVALIDA,
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
  [TEN_SUCURSAL_NOMBRE_DUPLICADO]:
    "Ya existe una sucursal con ese nombre. No se distinguen mayúsculas ni espacios al inicio o al final, y las sucursales inactivas también cuentan.",
  [TEN_SUCURSAL_CON_USUARIOS]:
    "La sucursal tiene usuarios activos: muévalos a otra sucursal o desactívelos antes.",
  [TEN_SUCURSAL_CON_STOCK]:
    "La sucursal tiene productos con existencias: traslade o ajuste el inventario antes.",
  [TEN_SUCURSAL_CON_DOCUMENTOS_ABIERTOS]:
    "La sucursal tiene ventas o compras abiertas (borradores o pendientes): ciérrelas o cancélelas antes.",
  [TEN_SUCURSAL_CON_SALDOS_PENDIENTES]:
    "La sucursal tiene facturas con saldo pendiente de cobro: cóbrelas o regularícelas antes.",
  [TEN_SUCURSAL_PROPIA_NO_DESACTIVABLE]:
    "No puede desactivar la sucursal en la que está trabajando.",
  [TEN_SUCURSAL_ULTIMA_ACTIVA]:
    "No puede desactivar la última sucursal activa de la empresa.",
  [TEN_USUARIO_SUCURSAL_INACTIVA]:
    "La sucursal del usuario está inactiva: muévalo primero a una sucursal activa y después actívelo.",
  [TEN_TASA_ITBIS_INVALIDA]:
    "La lista de tasas de ITBIS no es válida: debe ser una lista separada por comas de valores entre 0 y 100, sin repetir ni elementos vacíos.",
};

export function messageFor(code: TenantErrorCode): string {
  return TEN_ERROR_MESSAGES[code];
}
