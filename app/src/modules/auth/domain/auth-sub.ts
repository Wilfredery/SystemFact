/**
 * Normalization of the Supabase Auth `sub` claim (ADR-014 / audit v2r-01).
 *
 * Pure TypeScript — no imports from infrastructure, Next.js, React, Prisma or
 * Supabase.
 *
 * The `sub` is the ONLY session value per-request identity resolution is
 * allowed to trust. ADR-014 makes email a non-credential, and an Auth admin can
 * mutate it, so a binding keyed on the synthetic email is not tamper-resistant.
 * `USUARIO.authUserId` stores this value and is bound lazily at login.
 *
 * `sub` is a UUID in Supabase Auth. Validating the shape here — before any query
 * reaches Postgres — keeps a malformed claim from surfacing as a database cast
 * error (an opaque 500) on the request path, and gives callers one honest
 * "no usable identity" answer instead of two different failure modes.
 */

/**
 * Canonical UUID form: 8-4-4-4-12 lowercase hex. Deliberately version- and
 * variant-agnostic: Supabase Auth issues v4, but pinning the version would reject
 * a legitimate future format for no security gain (the value's uniqueness and
 * immutability come from Auth, not from which nibble holds the version).
 */
const UUID_CANONICAL =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Returns the canonical (trimmed, lowercased) Auth `sub`, or `null` when the
 * claim is absent, blank, or not a UUID.
 *
 * Fails closed by contract: a caller can never receive a value the database
 * would reject, so "no usable identity" is always `null` and never a throw.
 */
export function normalizarAuthSub(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const candidate = value.trim().toLowerCase();
  return UUID_CANONICAL.test(candidate) ? candidate : null;
}