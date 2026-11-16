import {
  CODIGO_TASA_ITBIS_CONFIG_FALTANTE,
  MENSAJE_TASA_ITBIS_CONFIG_FALTANTE,
  TasasItbisConfigError,
  esTasaItbisFormatoValido,
  esTasaEnLista,
  etiquetaTasaItbis,
  mensajeTasaItbisInvalida,
  mensajeTasaItbisInvalidaDe,
  parsearListaTasasItbis,
} from "./tasas-itbis";

describe("tasas-itbis: fallback copy", () => {
  it("mensajeTasaItbisInvalida keeps the static fallback sentence", () => {
    expect(mensajeTasaItbisInvalida()).toBe("La tasa de ITBIS debe ser 0%, 16% o 18%");
  });
});

describe("parsearListaTasasItbis", () => {
  it.each([
    ["18,16,0", ["18", "16", "0"]],
    [" 18 , 16 ,0 ", ["18", "16", "0"]],
    ["18.00,0", ["18", "0"]],
    ["0,16,18", ["0", "16", "18"]],
    ["7.5", ["7.5"]],
    ["100", ["100"]],
  ])("accepts %p keeping config order", (valor, esperado) => {
    expect(parsearListaTasasItbis(valor)).toEqual({ ok: true, tasas: esperado });
  });

  it.each([
    "",
    "   ",
    "18,,0",
    "18,16,",
    ",18",
    "-1",
    "+18",
    "1e1",
    "abc",
    "1 8",
    "7.555",
    "100.01",
    "101",
    "18,18",
    "18,18.00",
    "0,0.0",
  ])("rejects %p", (valor) => {
    const r = parsearListaTasasItbis(valor);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo.length).toBeGreaterThan(0);
  });
});

describe("esTasaItbisFormatoValido", () => {
  it.each(["0", "7", "7.5", "18", "18.00", "100"])("accepts %p", (v) => {
    expect(esTasaItbisFormatoValido(v)).toBe(true);
  });
  it.each(["", "-1", "1e1", "abc", "100.01", "7.555", " 7"])("rejects %p", (v) => {
    expect(esTasaItbisFormatoValido(v)).toBe(false);
  });
});

describe("etiquetaTasaItbis", () => {
  it("labels zero as exento and others with a percent sign", () => {
    expect(etiquetaTasaItbis("0")).toBe("0% (exento)");
    expect(etiquetaTasaItbis("16")).toBe("16%");
    expect(etiquetaTasaItbis("18")).toBe("18%");
  });
});

describe("mensajeTasaItbisInvalidaDe", () => {
  it("renders the same sentence as the legacy message, ascending", () => {
    const esperado = "La tasa de ITBIS debe ser 0%, 16% o 18%";
    expect(mensajeTasaItbisInvalidaDe(["18", "16", "0"])).toBe(esperado);
    expect(mensajeTasaItbisInvalidaDe(["0", "16", "18"])).toBe(esperado);
    expect(mensajeTasaItbisInvalidaDe(["18", "16", "0"])).toBe(mensajeTasaItbisInvalida());
  });
  it("handles one and two rates", () => {
    expect(mensajeTasaItbisInvalidaDe(["18"])).toBe("La tasa de ITBIS debe ser 18%");
    expect(mensajeTasaItbisInvalidaDe(["18", "0"])).toBe("La tasa de ITBIS debe ser 0% o 18%");
  });
});

describe("TasasItbisConfigError", () => {
  it("carries the stable code, message, motivo and detalle", () => {
    const e = new TasasItbisConfigError("valor_invalido", "valor vacío");
    expect(e).toBeInstanceOf(Error);
    expect(e.code).toBe("TASA_ITBIS_CONFIG_FALTANTE");
    expect(CODIGO_TASA_ITBIS_CONFIG_FALTANTE).toBe("TASA_ITBIS_CONFIG_FALTANTE");
    expect(e.message).toBe(MENSAJE_TASA_ITBIS_CONFIG_FALTANTE);
    expect(e.message).toBe(
      "Falta la configuración TASA_ITBIS requerida; no se puede validar la tasa de ITBIS",
    );
    expect(e.motivo).toBe("valor_invalido");
    expect(e.detalle).toBe("valor vacío");
    expect(new TasasItbisConfigError("ausente").detalle).toBeUndefined();
  });
});

describe("esTasaEnLista", () => {
  const lista = ["18", "16", "0"];
  it("is true for a member and compares numerically", () => {
    expect(esTasaEnLista("18", lista)).toBe(true);
    expect(esTasaEnLista("18.00", lista)).toBe(true);
    expect(esTasaEnLista("0.0", lista)).toBe(true);
    expect(esTasaEnLista("16", ["16.00"])).toBe(true);
  });
  it("is false for a rate outside the list or an empty list", () => {
    expect(esTasaEnLista("7", lista)).toBe(false);
    expect(esTasaEnLista("18", ["16", "0"])).toBe(false);
    expect(esTasaEnLista("18", [])).toBe(false);
  });
  it("is false (never throws) for text that is not a decimal", () => {
    expect(esTasaEnLista("abc", lista)).toBe(false);
    expect(esTasaEnLista("", lista)).toBe(false);
  });
});
