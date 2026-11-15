import {
  TASAS_ITBIS_PERMITIDAS,
  esTasaItbisPermitida,
  mensajeTasaItbisInvalida,
  textoTasasItbisPermitidas,
} from "./tasas-itbis";

describe("tasas-itbis", () => {
  it("pins the allowed set and order", () => {
    expect([...TASAS_ITBIS_PERMITIDAS]).toEqual(["0", "16", "18"]);
  });

  it.each(["0", "16", "18"])("accepts %p", (v) => {
    expect(esTasaItbisPermitida(v)).toBe(true);
  });

  it.each(["", "8", "18.00", "19", "-1", " 18"])("rejects %p", (v) => {
    expect(esTasaItbisPermitida(v)).toBe(false);
  });

  it("renders the exact human list and error sentence", () => {
    expect(textoTasasItbisPermitidas()).toBe("0%, 16% o 18%");
    expect(mensajeTasaItbisInvalida()).toBe("La tasa de ITBIS debe ser 0%, 16% o 18%");
  });
});
