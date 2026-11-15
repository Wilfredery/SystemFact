import { z } from "@/lib/zod";
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

describe("tasas-itbis: non-member keys", () => {
  it.each(["constructor", "__proto__", "toString", "length", "0.0", "018"])(
    "the guard rejects %p",
    (valor) => {
      expect(esTasaItbisPermitida(valor)).toBe(false);
    },
  );

  it("the zod enum built from the tuple keeps the option order and rejects the same keys", () => {
    const rate = z.enum(TASAS_ITBIS_PERMITIDAS);
    expect(rate.options).toEqual(["0", "16", "18"]);
    expect(rate.safeParse("constructor").success).toBe(false);
    expect(rate.safeParse("18").success).toBe(true);
  });
});
