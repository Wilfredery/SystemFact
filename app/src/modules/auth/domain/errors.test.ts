/**
 * Unit — auth error catalog.
 *
 * The `Record<AuthErrorCode, string>` annotation on `AUTH_ERROR_MESSAGES` already
 * makes the compiler reject a MISSING key, so these tests deliberately do not
 * re-assert that. What a type cannot check is what this file checks:
 *   - every code in the catalog resolves to a non-empty, stable message;
 *   - no two codes share a message (copy-paste guard: two identical strings means
 *     one of the two codes silently lost its own user-facing meaning);
 *   - `messageFor` never returns `undefined` and never throws for a known code.
 * The `AUTH_ENLACE_*` family is pinned by name because it was added by audit
 * finding v2r-01 and is the reason this catalog file changed at all.
 *
 * Pure domain, no DB, no mocks. Mirrors the `auditoria/domain/errors.test.ts` and
 * `cobros/domain/errors.test.ts` style.
 */

import {
  AUTH_CAMPOS_REQUERIDOS,
  AUTH_CREDENCIALES_INVALIDAS,
  AUTH_ENLACE_CONFLICTO,
  AUTH_ENLACE_DUPLICADO,
  AUTH_ENLACE_NO_RESUELTO,
  AUTH_ERROR_CODES,
  AUTH_USUARIO_INACTIVO,
  messageFor,
  type AuthErrorCode,
} from "./errors";

describe("auth error catalog", () => {
  it("owns the identity-link codes added by audit finding v2r-01", () => {
    // toStrictEqual (not toEqual): an unknowably-missing export imports as
    // `undefined`, and toEqual IGNORES undefined array entries — which would let
    // this assertion pass vacuously before the codes exist (TDD red).
    const enlaceCodes = AUTH_ERROR_CODES.filter((code) =>
      code.startsWith("AUTH_ENLACE_"),
    );
    expect(enlaceCodes.sort()).toStrictEqual(
      [
        AUTH_ENLACE_CONFLICTO,
        AUTH_ENLACE_DUPLICADO,
        AUTH_ENLACE_NO_RESUELTO,
      ].sort(),
    );
    // All three are members of the published catalog, not orphan constants.
    expect(AUTH_ERROR_CODES).toContain(AUTH_ENLACE_CONFLICTO);
    expect(AUTH_ERROR_CODES).toContain(AUTH_ENLACE_DUPLICADO);
    expect(AUTH_ERROR_CODES).toContain(AUTH_ENLACE_NO_RESUELTO);
  });

  it("yields one message per code, with no duplicates", () => {
    // Copy-paste guard. `Record` typing cannot catch two keys mapped to the same
    // string; a caller would then receive the wrong text for a distinct condition.
    const porMensaje = new Map<string, AuthErrorCode[]>();
    for (const code of AUTH_ERROR_CODES) {
      const mensaje = messageFor(code);
      porMensaje.set(mensaje, [...(porMensaje.get(mensaje) ?? []), code]);
    }
    const duplicados = [...porMensaje.entries()]
      .filter(([, codes]) => codes.length > 1)
      .map(([mensaje, codes]) => `${codes.join(" / ")} -> "${mensaje}"`);
    expect(duplicados).toStrictEqual([]);
  });

  it.each(AUTH_ERROR_CODES.map((code) => [code]) as [AuthErrorCode][])(
    "%s resolves to a stable non-empty user message",
    (code) => {
      const message = messageFor(code);
      expect(typeof message).toBe("string");
      expect(message).not.toBeUndefined();
      expect(message.length).toBeGreaterThan(0);
      // Stable: identical across repeated lookups (single source of truth).
      expect(messageFor(code)).toBe(message);
      // Never throws for a known code (the lookup must stay a pure read).
      expect(() => messageFor(code)).not.toThrow();
    },
  );

  it("keeps the pre-deploy login codes intact alongside the new link codes", () => {
    // The login surface a caller branches on: the uniform stranger-reachable
    // failure, the distinct-but-post-auth inactive case, and form validation.
    expect(AUTH_ERROR_CODES).toContain(AUTH_CAMPOS_REQUERIDOS);
    expect(AUTH_ERROR_CODES).toContain(AUTH_CREDENCIALES_INVALIDAS);
    expect(AUTH_ERROR_CODES).toContain(AUTH_USUARIO_INACTIVO);
  });

  it("distinguishes the inactive account from the credential failure", () => {
    // The enumeration posture in `loginWithCredenciales` depends on this pair
    // staying two codes: collapsing them would be a behaviour change, not a
    // cleanup, and the distinct text is what tells a verified holder of
    // credentials why the login was refused.
    expect(messageFor(AUTH_USUARIO_INACTIVO)).not.toBe(
      messageFor(AUTH_CREDENCIALES_INVALIDAS),
    );
  });

  it("never leaks internal detail through a user-facing message", () => {
    for (const code of AUTH_ERROR_CODES) {
      expect(messageFor(code)).not.toMatch(/at .*\.ts|Prisma|P2002|Error:/);
    }
  });
});
