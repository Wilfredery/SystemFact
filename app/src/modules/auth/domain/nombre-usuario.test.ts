/**
 * Unit — canonical username `<CODIGO>-<resto>` (multi-company contract C2/C4).
 *
 * Pure domain, no DB, no mocks. Two jobs are pinned separately:
 *   - `normalizarNombreUsuarioLogin`: LENIENT. Never fails, never reports a format
 *     problem (that would be an enumeration oracle); it only canonicalises.
 *   - `validarNombreUsuarioNuevo`: STRICT. Used on creation paths; fails closed.
 */

import {
  AUTH_CODIGO_EMPRESA_INVALIDO,
  AUTH_NOMBRE_USUARIO_FORMATO_INVALIDO,
  AUTH_NOMBRE_USUARIO_LARGO,
  AUTH_NOMBRE_USUARIO_PREFIJO_INVALIDO,
  messageFor,
} from "./errors";
import {
  CODIGO_EMPRESA_REGEX,
  NOMBRE_USUARIO_MAX,
  RESTO_NOMBRE_USUARIO_REGEX,
  normalizarNombreUsuarioLogin,
  validarNombreUsuarioNuevo,
} from "./nombre-usuario";

describe("constants", () => {
  it("pins the contract values", () => {
    expect(NOMBRE_USUARIO_MAX).toBe(64);
    expect(CODIGO_EMPRESA_REGEX.source).toBe("^[A-Z0-9]{3,6}$");
    expect(RESTO_NOMBRE_USUARIO_REGEX.source).toBe("^[a-z0-9][a-z0-9._-]{0,56}$");
  });

  it.each([["SOL"], ["ABCDEF"], ["E2E"], ["A1B2C3"], ["123"]])("accepts code %s", (c) => {
    expect(CODIGO_EMPRESA_REGEX.test(c)).toBe(true);
  });

  it.each([["AB"], ["ABCDEFG"], ["sol"], ["SO-L"], ["SOL "], ["SÓL"], [""], ["SOL\n"]])(
    "rejects code %j",
    (c) => {
      expect(CODIGO_EMPRESA_REGEX.test(c)).toBe(false);
    },
  );
});

describe("normalizarNombreUsuarioLogin", () => {
  // Documented behavior (verifier A1): a LEGACY hyphenated name is canonicalised like any other
  // prefixed name, so it no longer matches its old row. Safe only because the rollout renames
  // the legacy users BEFORE the app deploy (odd/tasks/multi-company-codigo.md C5).
  it("canonicalises a legacy hyphenated name (so legacy rows must be renamed first)", () => {
    expect(normalizarNombreUsuarioLogin("prod-smoke")).toBe("PROD-smoke");
    expect(normalizarNombreUsuarioLogin("demo-operador")).toBe("DEMO-operador");
    expect(normalizarNombreUsuarioLogin("admin")).toBe("admin");
  });

  it.each([
    ["SOL-jperez", "SOL-jperez"],
    ["sol-Jperez", "SOL-jperez"],
    ["Sol-JPerez", "SOL-jperez"],
    ["SOL-JPEREZ", "SOL-jperez"],
    [" SOL-jperez ", "SOL-jperez"],
    ["\t sol-jperez\n", "SOL-jperez"],
  ])("canonicalises %j -> %j (case folding + trim)", (input, esperado) => {
    expect(normalizarNombreUsuarioLogin(input)).toBe(esperado);
  });

  it("splits at the FIRST hyphen; the rest may contain hyphens", () => {
    expect(normalizarNombreUsuarioLogin("e2e-Gestion-Objetivo")).toBe("E2E-gestion-objetivo");
    expect(normalizarNombreUsuarioLogin("sol-a-b-c")).toBe("SOL-a-b-c");
  });

  it("accepts prefixes of 3 to 6 alphanumerics", () => {
    expect(normalizarNombreUsuarioLogin("abc-x")).toBe("ABC-x");
    expect(normalizarNombreUsuarioLogin("a1b2c3-X")).toBe("A1B2C3-x");
  });

  it("leaves prefixes of 2 or 7 chars unchanged (not a company code)", () => {
    expect(normalizarNombreUsuarioLogin("ab-Jperez")).toBe("ab-Jperez");
    expect(normalizarNombreUsuarioLogin("abcdefg-Jperez")).toBe("abcdefg-Jperez");
  });

  it("leaves an empty rest unchanged", () => {
    expect(normalizarNombreUsuarioLogin("sol-")).toBe("sol-");
    expect(normalizarNombreUsuarioLogin(" sol- ")).toBe("sol-");
  });

  it("leaves a name without hyphen unchanged: legacy `admin` stays `admin`", () => {
    expect(normalizarNombreUsuarioLogin("admin")).toBe("admin");
    expect(normalizarNombreUsuarioLogin("Admin")).toBe("Admin");
    expect(normalizarNombreUsuarioLogin("  Admin ")).toBe("Admin");
  });

  it("leaves a leading hyphen unchanged (empty prefix)", () => {
    expect(normalizarNombreUsuarioLogin("-Jperez")).toBe("-Jperez");
  });

  it("does not canonicalise a prefix with non-alphanumerics", () => {
    expect(normalizarNombreUsuarioLogin("so.l-Jperez")).toBe("so.l-Jperez");
    expect(normalizarNombreUsuarioLogin("so_l-Jperez")).toBe("so_l-Jperez");
    expect(normalizarNombreUsuarioLogin("so l-Jperez")).toBe("so l-Jperez");
  });

  it("treats non-ASCII prefixes as not-a-code (ASCII only, no Unicode case mapping)", () => {
    expect(normalizarNombreUsuarioLogin("sól-Jperez")).toBe("sól-Jperez");
    // U+0131 (dotless i) upper-cases to ASCII "I", U+017F (long s) to "S".
    expect(normalizarNombreUsuarioLogin("ıab-x")).toBe("ıab-x");
    expect(normalizarNombreUsuarioLogin("ſol-x")).toBe("ſol-x");
  });

  it("never maps a non-ASCII rest onto ASCII (Kelvin sign stays non-ASCII)", () => {
    // "K".toLowerCase() === "k": a Unicode-aware fold would alias another account.
    expect(normalizarNombreUsuarioLogin("SOL-Kim")).toBe("SOL-Kim");
    expect(normalizarNombreUsuarioLogin("SOL-JOSÉ")).toBe("SOL-josÉ");
  });

  it("keeps whitespace INSIDE the name (only the ends are trimmed)", () => {
    expect(normalizarNombreUsuarioLogin("SOL-j perez")).toBe("SOL-j perez");
    expect(normalizarNombreUsuarioLogin("SO L-jperez")).toBe("SO L-jperez");
  });

  it("is idempotent", () => {
    for (const s of ["sol-Jperez", " admin ", "ab-X", "sol-", "E2E-a-B"]) {
      const una = normalizarNombreUsuarioLogin(s);
      expect(normalizarNombreUsuarioLogin(una)).toBe(una);
    }
  });

  it("never throws and returns a string for odd input", () => {
    for (const s of ["", " ", "-", "--", "\u0000-a", "a".repeat(255)]) {
      expect(typeof normalizarNombreUsuarioLogin(s)).toBe("string");
    }
  });
});

describe("validarNombreUsuarioNuevo", () => {
  it("accepts the canonical shape and echoes it", () => {
    expect(validarNombreUsuarioNuevo("SOL", "SOL-jperez")).toStrictEqual({
      ok: true,
      nombreUsuario: "SOL-jperez",
    });
  });

  it("accepts a rest containing hyphens, dots and underscores", () => {
    expect(validarNombreUsuarioNuevo("E2E", "E2E-gestion-objetivo").ok).toBe(true);
    expect(validarNombreUsuarioNuevo("E2E", "E2E-a.b_c-d").ok).toBe(true);
    expect(validarNombreUsuarioNuevo("E2E", "E2E-9").ok).toBe(true);
  });

  it("accepts a total length of exactly 64", () => {
    const nombre = `ABCDEF-${"a".repeat(57)}`;
    expect(nombre).toHaveLength(64);
    expect(validarNombreUsuarioNuevo("ABCDEF", nombre).ok).toBe(true);
  });

  it("rejects a total length of 65 with the length code", () => {
    const nombre = `ABCDEF-${"a".repeat(58)}`;
    expect(nombre).toHaveLength(65);
    expect(validarNombreUsuarioNuevo("ABCDEF", nombre)).toStrictEqual({
      ok: false,
      code: AUTH_NOMBRE_USUARIO_LARGO,
      message: messageFor(AUTH_NOMBRE_USUARIO_LARGO),
    });
  });

  it("rejects a rest of 58 chars even when the total stays under 64", () => {
    const r = validarNombreUsuarioNuevo("SOL", `SOL-${"a".repeat(58)}`);
    expect(r).toMatchObject({ ok: false, code: AUTH_NOMBRE_USUARIO_FORMATO_INVALIDO });
  });

  it.each([
    ["no hyphen (legacy shape)", "admin"],
    ["wrong code", "ABC-jperez"],
    ["lower-case code", "sol-jperez"],
    ["mixed-case code", "Sol-jperez"],
    ["code only", "SOL"],
    ["leading hyphen", "-jperez"],
    ["code with trailing space", "SOL -jperez"],
    ["leading space", " SOL-jperez"],
  ])("rejects a wrong prefix: %s", (_caso, nombre) => {
    expect(validarNombreUsuarioNuevo("SOL", nombre)).toStrictEqual({
      ok: false,
      code: AUTH_NOMBRE_USUARIO_PREFIJO_INVALIDO,
      message: messageFor(AUTH_NOMBRE_USUARIO_PREFIJO_INVALIDO),
    });
  });

  it("does not accept a longer code that merely starts with the given one", () => {
    expect(validarNombreUsuarioNuevo("SOL", "SOLAR-jperez")).toMatchObject({
      ok: false,
      code: AUTH_NOMBRE_USUARIO_PREFIJO_INVALIDO,
    });
  });

  it.each([
    ["empty rest", "SOL-"],
    ["upper-case rest", "SOL-Jperez"],
    ["rest starting with a hyphen", "SOL--jperez"],
    ["rest starting with a dot", "SOL-.jperez"],
    ["whitespace inside", "SOL-j perez"],
    ["trailing whitespace", "SOL-jperez "],
    ["trailing newline", "SOL-jperez\n"],
    ["non-ASCII", "SOL-josé"],
    ["Kelvin sign", "SOL-Kim"],
    ["@", "SOL-j@perez"],
    ["slash", "SOL-j/perez"],
  ])("rejects an invalid rest: %s", (_caso, nombre) => {
    expect(validarNombreUsuarioNuevo("SOL", nombre)).toStrictEqual({
      ok: false,
      code: AUTH_NOMBRE_USUARIO_FORMATO_INVALIDO,
      message: messageFor(AUTH_NOMBRE_USUARIO_FORMATO_INVALIDO),
    });
  });

  it.each([[""], ["AB"], ["ABCDEFG"], ["sol"], ["SO-L"], ["SÓL"]])(
    "fails closed on an invalid company code %j",
    (codigo) => {
      expect(validarNombreUsuarioNuevo(codigo, "SOL-jperez")).toStrictEqual({
        ok: false,
        code: AUTH_CODIGO_EMPRESA_INVALIDO,
        message: messageFor(AUTH_CODIGO_EMPRESA_INVALIDO),
      });
    },
  );

  it("canonical output is a fixed point of the login normalizer", () => {
    const r = validarNombreUsuarioNuevo("SOL", "SOL-jperez");
    expect(r.ok && normalizarNombreUsuarioLogin(r.nombreUsuario)).toBe("SOL-jperez");
  });
});
