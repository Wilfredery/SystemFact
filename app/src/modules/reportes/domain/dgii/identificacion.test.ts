/**
 * Unit tests — the DGII "Tipo de Identificación" (D2) pure derivation (FIS-3/FIS-4; slice E).
 *
 * PURE (no DB). Pins the derivation the 606 fix relies on: a valid 9-digit RNC → type 1, a valid
 * 11-digit Cédula → type 2, a blank / unvalid / final-consumer id → type 3 with a BLANK D1 — and,
 * critically, that the remitter NEVER invents a substitute id (the 606 panel must not report the
 * company as its own supplier). Uses known-good mod-11 values from the shared validator's domain.
 */

import {
  TIPO_IDENTIFICACION,
  derivarTipoIdentificacion,
} from "./identificacion";

describe("dgii/identificacion — derivarTipoIdentificacion (607/606 D2)", () => {
  it("a valid 9-digit RNC resolves to type 1 with the stripped id", () => {
    // 131000002: first-8 weights [7,9,8,6,5,4,3,2] → sum 42 → DV = 11−(42 mod 11) = 2.
    const r = derivarTipoIdentificacion("131-00000-2");
    expect(r.tipo).toBe(TIPO_IDENTIFICACION.RNC); // 1
    expect(r.identificacion).toBe("131000002");
  });

  it("a valid 11-digit Cédula resolves to type 2", () => {
    // 00100000007: first-10 weights → digit index2=1×4 → sum 4 → DV = 11−4 = 7.
    const r = derivarTipoIdentificacion("00100000007");
    expect(r.tipo).toBe(TIPO_IDENTIFICACION.CEDULA); // 2
    expect(r.identificacion).toBe("00100000007");
  });

  it("a flagged final consumer is type 3 with a BLANK id (never a guess)", () => {
    const r = derivarTipoIdentificacion("131000002", true);
    expect(r.tipo).toBe(TIPO_IDENTIFICACION.SIN_IDENTIFICACION); // 3
    expect(r.identificacion).toBe("");
  });

  it("a missing / blank id is type 3 with a blank field", () => {
    expect(derivarTipoIdentificacion(null)).toEqual({ tipo: 3, identificacion: "" });
    expect(derivarTipoIdentificacion("")).toEqual({ tipo: 3, identificacion: "" });
    expect(derivarTipoIdentificacion(undefined)).toEqual({ tipo: 3, identificacion: "" });
  });

  it("a present-but-unvalid id fails CLOSED to type 3/blank (no fabricated D2, no substitute id)", () => {
    // 123456789 is 9 digits but its mod-11 DV would be 8, not 9 → invalid RNC.
    const r = derivarTipoIdentificacion("123456789");
    expect(r.tipo).toBe(TIPO_IDENTIFICACION.SIN_IDENTIFICACION); // 3
    expect(r.identificacion).toBe("");
  });
});
