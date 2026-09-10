/**
 * Domain unit tests — venta discount cap rules (spec R-V7, R-V8). Pure, no DB.
 * Covers the triple-cap (per-line % of gross, header %, aggregate % of Σ gross),
 * the base-exceed rule, shape validation, and the zero-discount convention.
 */

import {
  validarDescuentosContraMaximo,
  validarFormaDescuento,
  normalizarDescuento,
  noHayDescuento,
  type DescuentoLineaCap,
} from "../descuentos";
import { DESCUENTO_CERO, DESCUENTO_TIPO, type Descuento } from "../venta";

function monto(v: string): Descuento {
  return { descuentoTipo: DESCUENTO_TIPO.MONTO, descuentoValor: v };
}
function pct(v: string): Descuento {
  return { descuentoTipo: DESCUENTO_TIPO.PORCENTAJE, descuentoValor: v };
}
function linea(subtotalBruto: string, descuento: Descuento): DescuentoLineaCap {
  return { subtotalBruto, descuento };
}

describe("validarDescuentosContraMaximo — triple cap (R-V8)", () => {
  it("accepts a per-line discount at/below the cap", () => {
    expect(
      validarDescuentosContraMaximo({
        lineas: [linea("100.00", pct("20"))],
        descuentoCabecera: DESCUENTO_CERO,
        descMax: "25.00",
      }).ok,
    ).toBe(true);
  });

  it("rejects a per-line discount above DESC_MAX% of its gross base", () => {
    // 26.00 > 25% of 100.00 = 25.00
    expect(
      validarDescuentosContraMaximo({
        lineas: [linea("100.00", monto("26.00"))],
        descuentoCabecera: DESCUENTO_CERO,
        descMax: "25.00",
      }),
    ).toEqual({ ok: false, code: "DESCUENTO_EXCEDE_MAXIMO" });
  });

  it("rejects a header PERCENTAGE input above the cap", () => {
    expect(
      validarDescuentosContraMaximo({
        lineas: [linea("100.00", DESCUENTO_CERO)],
        descuentoCabecera: pct("10.01"),
        descMax: "10.00",
      }),
    ).toEqual({ ok: false, code: "DESCUENTO_EXCEDE_MAXIMO" });
  });

  it("rejects when the aggregate effective discount exceeds the cap of Σ gross", () => {
    // two lines each exactly at 5% but header pushes total over 5% of Σ gross
    expect(
      validarDescuentosContraMaximo({
        lineas: [linea("100.00", pct("5")), linea("100.00", pct("5"))],
        descuentoCabecera: monto("0.01"),
        descMax: "5.00",
      }),
    ).toEqual({ ok: false, code: "DESCUENTO_EXCEDE_MAXIMO" });
  });

  it("DGII 4% boundary: 4.00 header passes, 4.01 fails (F4 pure part)", () => {
    const pass = validarDescuentosContraMaximo({
      lineas: [linea("100.00", DESCUENTO_CERO)],
      descuentoCabecera: pct("4.00"),
      descMax: "4.00",
    });
    expect(pass.ok).toBe(true);
    const fail = validarDescuentosContraMaximo({
      lineas: [linea("100.00", DESCUENTO_CERO)],
      descuentoCabecera: pct("4.01"),
      descMax: "4.00",
    });
    expect(fail).toEqual({ ok: false, code: "DESCUENTO_EXCEDE_MAXIMO" });
  });
});

describe("validarDescuentosContraMaximo — base exceed (R-V8)", () => {
  it("rejects a header discount exceeding the Σ net base (DESCUENTO_EXCEDE_BASE)", () => {
    // descMax generous; header monto 120 > Σ net base 100
    expect(
      validarDescuentosContraMaximo({
        lineas: [linea("100.00", DESCUENTO_CERO)],
        descuentoCabecera: monto("120.00"),
        descMax: "50.00",
      }),
    ).toEqual({ ok: false, code: "DESCUENTO_EXCEDE_BASE" });
  });

  it("rejects a per-line discount exceeding its own gross base", () => {
    // descMax 200 so the cap check passes; money 60 > bruto 50
    expect(
      validarDescuentosContraMaximo({
        lineas: [linea("50.00", monto("60.00"))],
        descuentoCabecera: DESCUENTO_CERO,
        descMax: "200.00",
      }),
    ).toEqual({ ok: false, code: "DESCUENTO_EXCEDE_BASE" });
  });
});

describe("shape validation & zero convention (R-V7)", () => {
  it("rejects a MONTO of 0.00 and malformed values with DESCUENTO_INVALIDO", () => {
    expect(validarFormaDescuento(monto("0.00"))).toBe("DESCUENTO_INVALIDO");
    expect(validarFormaDescuento(pct("abc"))).toBe("DESCUENTO_INVALIDO");
    expect(validarFormaDescuento(pct("-1"))).toBe("DESCUENTO_INVALIDO");
    expect(validarFormaDescuento(pct(" 5.00"))).toBe("DESCUENTO_INVALIDO"); // padded: typed, not a Decimal throw
    expect(
      validarFormaDescuento({
        descuentoTipo: "MONTO" as unknown as Descuento["descuentoTipo"],
        descuentoValor: "1.000",
      }),
    ).toBe("DESCUENTO_INVALIDO"); // >2dp money is a shape mismatch
    // surfaced through the top-level validator too
    expect(
      validarDescuentosContraMaximo({
        lineas: [linea("100.00", monto("0.00"))],
        descuentoCabecera: DESCUENTO_CERO,
        descMax: "25.00",
      }),
    ).toEqual({ ok: false, code: "DESCUENTO_INVALIDO" });
  });

  it("treats a zero discount as PORCENTAJE/0.00 and needs no cap", () => {
    expect(normalizarDescuento(null)).toEqual(DESCUENTO_CERO);
    expect(normalizarDescuento(pct("0"))).toEqual(DESCUENTO_CERO);
    expect(
      noHayDescuento([linea("100.00", DESCUENTO_CERO)], DESCUENTO_CERO),
    ).toBe(true);
    // Even with descMax 0.00, an all-zero draft validates clean.
    expect(
      validarDescuentosContraMaximo({
        lineas: [linea("100.00", DESCUENTO_CERO)],
        descuentoCabecera: DESCUENTO_CERO,
        descMax: "0.00",
      }).ok,
    ).toBe(true);
  });
});
