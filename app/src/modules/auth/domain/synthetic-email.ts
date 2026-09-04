/**
 * Synthetic email encoding/decoding for Supabase Auth (ADR-014).
 *
 * Pure TypeScript — no imports from infrastructure, Next.js, React, Prisma or
 * Supabase. This module is the single source of truth for the internal email
 * suffix used to map each SystemFact `nombreUsuario` to a Supabase Auth user.
 */

export const SYNTHETIC_EMAIL_SUFFIX = "@users.systemfact.internal" as const;

export class InvalidSyntheticEmailError extends Error {
  constructor(email: string) {
    super(`Invalid synthetic email: "${email}"`);
    this.name = "InvalidSyntheticEmailError";
  }
}

export function buildSyntheticEmail(nombreUsuario: string): string {
  return `${nombreUsuario}${SYNTHETIC_EMAIL_SUFFIX}`;
}

export function decodeNombreUsuario(email: string): string {
  if (!email.endsWith(SYNTHETIC_EMAIL_SUFFIX)) {
    throw new InvalidSyntheticEmailError(email);
  }
  const nombreUsuario = email.slice(0, -SYNTHETIC_EMAIL_SUFFIX.length);
  if (nombreUsuario.length === 0) {
    throw new InvalidSyntheticEmailError(email);
  }
  return nombreUsuario;
}
