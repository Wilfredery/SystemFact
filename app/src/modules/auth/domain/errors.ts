/**
 * Auth domain — error codes and messages.
 *
 * Pure TypeScript. No imports from Next.js, React, Prisma, or Supabase.
 * This is the single source of truth for auth error codes (19-directivas
 * §9). Messages are user-facing Spanish; codes are stable and versioned
 * alongside the domain.
 *
 * The catalog is intentionally small at Fase 1.1. As Fase 1.2 (CRUD
 * Usuarios) and beyond land, add new codes here — never inline them in
 * adapters or components.
 */

export const AUTH_CAMPOS_REQUERIDOS = "AUTH_CAMPOS_REQUERIDOS";
export const AUTH_CREDENCIALES_INVALIDAS = "AUTH_CREDENCIALES_INVALIDAS";
export const AUTH_USUARIO_INACTIVO = "AUTH_USUARIO_INACTIVO";

export const AUTH_ERROR_CODES = [
  AUTH_CAMPOS_REQUERIDOS,
  AUTH_CREDENCIALES_INVALIDAS,
  AUTH_USUARIO_INACTIVO,
] as const;

export type AuthErrorCode = (typeof AUTH_ERROR_CODES)[number];

export interface AuthErrorMessage {
  readonly code: AuthErrorCode;
  readonly message: string;
}

const AUTH_ERROR_MESSAGES: Readonly<Record<AuthErrorCode, string>> = {
  [AUTH_CAMPOS_REQUERIDOS]: "Debes indicar tu usuario y contraseña.",
  [AUTH_CREDENCIALES_INVALIDAS]:
    "Credenciales inválidas o usuario bloqueado.",
  [AUTH_USUARIO_INACTIVO]: "Tu usuario está inactivo. Contacta al administrador.",
};

export function messageFor(code: AuthErrorCode): string {
  return AUTH_ERROR_MESSAGES[code];
}
