/**
 * Unit — pure argument validation of the company provisioning script
 * (odd/tasks/multi-company-codigo.md S2/S3, C1/C2/C4). No DB, no filesystem.
 */

import {
  ADMIN_PASSWORD_MIN_LONGITUD_PROVISION,
  NCF_MAX_CONSECUTIVO_PROVISION,
  describirPlanProvision,
  validarArgsProvision,
  validarRangosNcf,
} from "./provision-empresa-args";

const PASSWORD = "a-long-enough-password";

function argsBase(overrides: Record<string, string | undefined> = {}): string[] {
  const base: Record<string, string | undefined> = {
    "--codigo": "SOL",
    "--nombre-comercial": "Sol Distribuciones",
    "--rnc": "131000002",
    "--sucursal": "Matriz",
    "--admin-usuario": "jperez",
    "--ncf-file": "./ncf-sol.json",
    ...overrides,
  };
  const out: string[] = [];
  for (const [flag, valor] of Object.entries(base)) {
    if (valor === undefined) continue;
    out.push(flag, valor);
  }
  return out;
}

function errores(argv: readonly string[], ...pass: [string | undefined] | []): readonly string[] {
  const r = validarArgsProvision(argv, pass.length === 0 ? PASSWORD : pass[0]);
  if (r.ok) throw new Error("expected validation to fail");
  return r.errors;
}

describe("validarArgsProvision: happy path", () => {
  it("accepts a complete command, is a dry run without --apply and builds the canonical name", () => {
    const r = validarArgsProvision(argsBase(), PASSWORD);
    expect(r).toEqual({
      ok: true,
      value: {
        codigo: "SOL",
        nombreComercial: "Sol Distribuciones",
        rnc: "131000002",
        sucursal: "Matriz",
        adminUsuario: "jperez",
        adminNombreUsuario: "SOL-jperez",
        rangosArchivo: "./ncf-sol.json",
        apply: false,
      },
    });
  });

  it("--apply turns the dry run off and changes nothing else", () => {
    const a = validarArgsProvision(argsBase(), PASSWORD);
    const b = validarArgsProvision([...argsBase(), "--apply"], PASSWORD);
    if (!a.ok || !b.ok) throw new Error("expected both to pass");
    expect(b.value.apply).toBe(true);
    expect({ ...b.value, apply: false }).toEqual(a.value);
  });

  it("accepts --flag=value, a lower-case code (stored upper-case) and a separated RNC", () => {
    const r = validarArgsProvision(
      ["--codigo=sol", "--nombre-comercial=Sol", "--rnc=131-00000-2", "--sucursal=M", "--admin-usuario=a.b", "--ncf-file=x.json"],
      PASSWORD,
    );
    if (!r.ok) throw new Error(r.errors.join("; "));
    expect(r.value.codigo).toBe("SOL");
    expect(r.value.adminNombreUsuario).toBe("SOL-a.b");
    expect(r.value.rnc).toBe("131000002");
  });
});

describe("validarArgsProvision: codigo (C1)", () => {
  it.each(["AB", "ABCDEFG", "SO-L", "SOL!", "S_L"])("rejects %j", (codigo) => {
    expect(errores(argsBase({ "--codigo": codigo }))).toEqual([
      `--codigo "${codigo}" is invalid: 3 to 6 characters A-Z0-9 (case-insensitive input).`,
    ]);
  });

  it.each(["ABC", "abc", "A1B2C3", "123456"])("accepts %j", (codigo) => {
    const r = validarArgsProvision(argsBase({ "--codigo": codigo }), PASSWORD);
    if (!r.ok) throw new Error(r.errors.join("; "));
    expect(r.value.codigo).toBe(codigo.toUpperCase());
  });
});

describe("validarArgsProvision: admin username (C2 through validarNombreUsuarioNuevo)", () => {
  it("rejects an uppercase rest with the format code", () => {
    expect(errores(argsBase({ "--admin-usuario": "JPerez" }))).toEqual([
      '--admin-usuario "JPerez" is invalid: La parte del usuario después del guion debe usar minúsculas, números, punto, guion o guion bajo, y empezar con letra o número. (AUTH_NOMBRE_USUARIO_FORMATO_INVALIDO).',
    ]);
  });

  it.each(["-jperez", ".jperez", "j perez", "j@perez"])("rejects the rest %j with the format code", (resto) => {
    const e = errores(argsBase({ "--admin-usuario": resto }));
    expect(e).toHaveLength(1);
    expect(e[0]).toContain("(AUTH_NOMBRE_USUARIO_FORMATO_INVALIDO)");
  });

  it("refuses a name that already carries the prefix (any case)", () => {
    const esperado = (v: string) =>
      `--admin-usuario takes only the part AFTER the prefix ("SOL-" is added for you); got "${v}".`;
    expect(errores(argsBase({ "--admin-usuario": "SOL-jperez" }))).toEqual([esperado("SOL-jperez")]);
    expect(errores(argsBase({ "--admin-usuario": "sol-jperez" }))).toEqual([esperado("sol-jperez")]);
  });

  it("64 characters total is the boundary (6-char code + 57-char rest)", () => {
    const resto57 = "a".repeat(57);
    const ok = validarArgsProvision(argsBase({ "--codigo": "ABCDEF", "--admin-usuario": resto57 }), PASSWORD);
    if (!ok.ok) throw new Error(ok.errors.join("; "));
    expect(ok.value.adminNombreUsuario).toBe(`ABCDEF-${resto57}`);
    expect(ok.value.adminNombreUsuario).toHaveLength(64);

    expect(errores(argsBase({ "--codigo": "ABCDEF", "--admin-usuario": "a".repeat(58) }))).toEqual([
      `--admin-usuario "${"a".repeat(58)}" is invalid: El nombre de usuario no puede superar los 64 caracteres. (AUTH_NOMBRE_USUARIO_LARGO).`,
    ]);
  });

  it("a 58-char rest with a short code fails the rest format (total is under 64)", () => {
    const e = errores(argsBase({ "--admin-usuario": "a".repeat(58) }));
    expect(e).toHaveLength(1);
    expect(e[0]).toContain("(AUTH_NOMBRE_USUARIO_FORMATO_INVALIDO)");
  });

  it("accepts dots, hyphens and underscores inside the rest", () => {
    const r = validarArgsProvision(argsBase({ "--admin-usuario": "j-p.e_r1" }), PASSWORD);
    if (!r.ok) throw new Error(r.errors.join("; "));
    expect(r.value.adminNombreUsuario).toBe("SOL-j-p.e_r1");
  });

  it("an invalid code does not also produce a username error", () => {
    expect(errores(argsBase({ "--codigo": "AB" }))).toEqual([
      '--codigo "AB" is invalid: 3 to 6 characters A-Z0-9 (case-insensitive input).',
    ]);
  });
});

describe("validarArgsProvision: RNC", () => {
  it.each(["13100000", "1310000023", "abcdefghi", "131000003"])("rejects %j", (rnc) => {
    expect(errores(argsBase({ "--rnc": rnc }))).toEqual([`--rnc "${rnc}" is not a valid 9-digit RNC.`]);
  });
});

describe("validarArgsProvision: missing and malformed arguments", () => {
  it.each(["--codigo", "--nombre-comercial", "--rnc", "--sucursal", "--admin-usuario", "--ncf-file"])(
    "%s is required",
    (flag) => {
      expect(errores(argsBase({ [flag]: undefined }))).toContain(`${flag} is required.`);
    },
  );

  it("collects every missing argument in one pass", () => {
    expect(errores([], PASSWORD)).toEqual([
      "--codigo is required.",
      "--nombre-comercial is required.",
      "--rnc is required.",
      "--sucursal is required.",
      "--admin-usuario is required.",
      "--ncf-file is required.",
    ]);
  });

  it("a blank value counts as missing", () => {
    expect(errores(argsBase({ "--sucursal": "   " }))).toEqual(["--sucursal is required."]);
  });

  it("a flag followed by another flag or by nothing needs a value", () => {
    expect(errores(["--codigo", "--rnc", "131000002"])).toContain("--codigo needs a value.");
    expect(errores([...argsBase({ "--sucursal": undefined }), "--sucursal"])).toContain("--sucursal needs a value.");
  });

  it("a repeated flag is reported", () => {
    expect(errores([...argsBase(), "--codigo", "ABC"])).toEqual(["--codigo was given more than once."]);
  });

  it("--apply does not take a value", () => {
    expect(errores([...argsBase(), "--apply=yes"])).toEqual(["--apply does not take a value."]);
  });

  it("unknown flags and stray tokens are refused", () => {
    expect(errores([...argsBase(), "--force"])).toEqual(['Unknown argument "--force".']);
    expect(errores([...argsBase(), "stray"])).toEqual(['Unknown argument "stray".']);
  });
});

describe("validarArgsProvision: password is never an argument", () => {
  it.each(["--password", "--admin-password", "--contrasena", "--clave"])("refuses %s", (flag) => {
    const msg = `${flag} is refused: the password is read from the ADMIN_PASSWORD env var only.`;
    expect(errores([...argsBase(), `${flag}=hunter2hunter2`])).toEqual([msg]);
    expect(errores([...argsBase(), flag, "hunter2hunter2"])).toEqual([msg, 'Unknown argument "hunter2hunter2".']);
  });

  it("never echoes the value of a refused password flag when given inline", () => {
    expect(errores([...argsBase(), "--password=hunter2hunter2"]).join("\n")).not.toContain("hunter2");
  });

  it("requires ADMIN_PASSWORD", () => {
    const msg = "ADMIN_PASSWORD env var is not set (never pass the password as an argument).";
    expect(errores(argsBase(), undefined)).toEqual([msg]);
    expect(errores(argsBase(), "")).toEqual([msg]);
  });

  it("enforces the 12-character minimum (11 fails, 12 passes)", () => {
    expect(ADMIN_PASSWORD_MIN_LONGITUD_PROVISION).toBe(12);
    expect(errores(argsBase(), "a".repeat(11))).toEqual(["ADMIN_PASSWORD must be at least 12 characters."]);
    expect(validarArgsProvision(argsBase(), "a".repeat(12)).ok).toBe(true);
  });

  it("the validated value never contains the password", () => {
    expect(JSON.stringify(validarArgsProvision(argsBase(), PASSWORD))).not.toContain(PASSWORD);
  });
});

describe("validarRangosNcf", () => {
  const rango = (extra: Record<string, unknown> = {}) => ({
    tipoNcf: "B02",
    rangoInicio: 1,
    rangoFin: 500,
    vigenciaInicio: "2027-01-01",
    vigenciaFin: "2027-12-31",
    ...extra,
  });
  const fallos = (json: unknown): readonly string[] => {
    const r = validarRangosNcf(json);
    if (r.ok) throw new Error("expected failure");
    return r.errors;
  };

  it("accepts a valid file and parses the dates", () => {
    const r = validarRangosNcf([
      rango(),
      rango({ tipoNcf: "B01", rangoInicio: 10, rangoFin: NCF_MAX_CONSECUTIVO_PROVISION }),
    ]);
    if (!r.ok) throw new Error(r.errors.join("; "));
    expect(r.rangos).toHaveLength(2);
    expect(r.rangos[0]?.vigenciaInicio.toISOString()).toBe("2027-01-01T00:00:00.000Z");
    expect(r.rangos[1]?.rangoFin).toBe(99_999_999);
  });

  it("accepts ISO timestamps and a 1-number range", () => {
    expect(
      validarRangosNcf([rango({ rangoInicio: 5, rangoFin: 5, vigenciaFin: "2027-12-31T23:59:59Z" })]).ok,
    ).toBe(true);
  });

  it.each([undefined, null, {}, "x", 5, []])("rejects a non-array or empty file: %j", (json) => {
    expect(fallos(json)).toEqual(["NCF file must be a non-empty JSON array of ranges."]);
  });

  it.each([null, 7, "B01", [1]])("rejects a non-object entry %j", (item) => {
    expect(fallos([item])).toEqual(["ranges[0] must be an object."]);
  });

  it.each([undefined, "B03x", "b01", 1])("rejects an invalid tipoNcf %j", (tipo) => {
    expect(fallos([rango({ tipoNcf: tipo })])).toEqual([
      "ranges[0].tipoNcf must be one of B01, B02, B03, B04, B11.",
    ]);
  });

  it("rejects a duplicated type (one range per type)", () => {
    expect(fallos([rango(), rango({ rangoInicio: 600, rangoFin: 700 })])).toEqual([
      'ranges[1].tipoNcf "B02" is duplicated (one range per type).',
    ]);
  });

  it.each([
    [{ rangoInicio: 0 }],
    [{ rangoInicio: 10, rangoFin: 9 }],
    [{ rangoFin: NCF_MAX_CONSECUTIVO_PROVISION + 1 }],
    [{ rangoInicio: 1.5 }],
    [{ rangoInicio: "1" }],
    [{ rangoFin: undefined }],
  ])("rejects invalid numeric range %j", (extra) => {
    expect(fallos([rango(extra)])).toEqual([
      "ranges[0] (B02): rangoInicio/rangoFin must be integers with 1 <= inicio <= fin <= 99999999.",
    ]);
  });

  it.each([
    [{ vigenciaInicio: undefined }],
    [{ vigenciaFin: "31/12/2027" }],
    [{ vigenciaFin: "2027-13-45" }],
    [{ vigenciaFin: "2027-01-01" }],
    [{ vigenciaFin: "2026-12-31" }],
    [{ vigenciaInicio: 20270101 }],
  ])("rejects invalid validity %j", (extra) => {
    expect(fallos([rango(extra)])).toEqual([
      "ranges[0] (B02): vigenciaInicio/vigenciaFin must be ISO dates with fin after inicio.",
    ]);
  });

  it("reports the problems of several entries in one pass", () => {
    expect(fallos([rango({ rangoInicio: 0 }), 3, rango({ tipoNcf: "B04" })])).toEqual([
      "ranges[0] (B02): rangoInicio/rangoFin must be integers with 1 <= inicio <= fin <= 99999999.",
      "ranges[1] must be an object.",
    ]);
  });
});

describe("describirPlanProvision", () => {
  it("prints the plan, derives the Auth email from the full name in lower case and never includes the password", () => {
    const a = validarArgsProvision(argsBase(), PASSWORD);
    const r = validarRangosNcf([
      { tipoNcf: "B02", rangoInicio: 1, rangoFin: 500, vigenciaInicio: "2027-01-01", vigenciaFin: "2027-12-31" },
    ]);
    if (!a.ok || !r.ok) throw new Error("fixture invalid");
    const texto = describirPlanProvision(a.value, r.rangos, {
      itbis: "18",
      claves: ["K1", "K2"],
      roles: ["Administrador"],
    });
    expect(texto).toContain("nothing is written without --apply");
    expect(texto).toContain('EMPRESA        codigo=SOL nombreComercial="Sol Distribuciones" rnc=131000002 activa=true');
    expect(texto).toContain("B02  1-500  valid 2027-01-01 .. 2027-12-31  (secuenciaActual 0)");
    expect(texto).toContain("USUARIO        SOL-jperez (rol Administrador");
    expect(texto).toContain("sol-jperez@users.systemfact.internal");
    expect(texto).not.toContain(PASSWORD);
  });
});
