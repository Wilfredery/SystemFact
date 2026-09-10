/**
 * B01/B02 NCF eligibility — pure unit tests (spec R-F2, task 2.2). No DB.
 *
 * Verifies `seleccionarTipoNcf` grants B01 ONLY to a non–Consumidor-Final client
 * with a valid 9-digit RNC (via the untouched `shared/domain/fiscal-id.ts` mod-11
 * path) and fails CLOSED to B02 for the CF row, a missing id or a degenerate/
 * invalid id. A valid RNC used here: `131045677` (weights [7,9,8,6,5,4,3,2] over
 * the first 8 digits → check digit 7).
 */

import { seleccionarTipoNcf } from "../elegibilidad-ncf";

describe("seleccionarTipoNcf (R-F2)", () => {
  it("valid 9-digit RNC + not-CF → B01 CONTRIBUYENTE", () => {
    expect(
      seleccionarTipoNcf({ esConsumidorFinal: false, identificacionFiscal: "131045677" }),
    ).toEqual({ tipo: "B01", motivo: "CONTRIBUYENTE" });
  });

  it("accepts a separated RNC (normalization is inside the shared validator)", () => {
    expect(
      seleccionarTipoNcf({ esConsumidorFinal: false, identificacionFiscal: "131-04567-7" }),
    ).toEqual({ tipo: "B01", motivo: "CONTRIBUYENTE" });
  });

  it("Consumidor Final row → B02 CONSUMIDOR_FINAL even if a stray RNC is present", () => {
    expect(
      seleccionarTipoNcf({ esConsumidorFinal: true, identificacionFiscal: "131045677" }),
    ).toEqual({ tipo: "B02", motivo: "CONSUMIDOR_FINAL" });
  });

  it("named client without a fiscal id → B02 DATOS_DEGENERADOS (fail-closed)", () => {
    expect(
      seleccionarTipoNcf({ esConsumidorFinal: false, identificacionFiscal: null }),
    ).toEqual({ tipo: "B02", motivo: "DATOS_DEGENERADOS" });
  });

  it("invalid mod-11 RNC → B02 DATOS_DEGENERADOS (fail-closed, never B01)", () => {
    // Same prefix, wrong check digit (8 ≠ 7).
    expect(
      seleccionarTipoNcf({ esConsumidorFinal: false, identificacionFiscal: "131045678" }),
    ).toEqual({ tipo: "B02", motivo: "DATOS_DEGENERADOS" });
    // Wrong length (11 → not a 9-digit RNC shape under validarRnc).
    expect(
      seleccionarTipoNcf({ esConsumidorFinal: false, identificacionFiscal: "13104567788" }),
    ).toEqual({ tipo: "B02", motivo: "DATOS_DEGENERADOS" });
  });
});
