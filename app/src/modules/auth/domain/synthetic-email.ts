/**
 * Synthetic email ENCODING for Supabase Auth (ADR-014).
 *
 * Pure TypeScript — no imports from infrastructure, Next.js, React, Prisma or
 * Supabase. This module is the single source of truth for the internal email
 * suffix used to map each SystemFact `nombreUsuario` to a Supabase Auth user.
 *
 * ENCODING IS ONE-DIRECTIONAL BY DESIGN (audit finding v2r-01). The inverse
 * `decodeNombreUsuario` was removed: identity now resolves through the
 * immutable Auth `sub`, never by parsing a username back out of the email. A
 * live decoder here would be a standing re-introduction hazard for exactly the
 * vulnerability this change closed — an Auth admin who can rewrite the email
 * attribute would otherwise be able to steer which `USUARIO` row (and therefore
 * which `empresa`) a session resolves to.
 */

export const SYNTHETIC_EMAIL_SUFFIX = "@users.systemfact.internal" as const;

export function buildSyntheticEmail(nombreUsuario: string): string {
  return `${nombreUsuario}${SYNTHETIC_EMAIL_SUFFIX}`;
}
