import { TASA_ITBIS_INVALIDA, messageFor } from "./errors";
import { TASAS_ITBIS_VALIDAS, esTasaItbisValida } from "./producto";

describe("producto tasa ITBIS (behavior preserved)", () => {
  it("keeps the exported set 0, 16, 18", () => {
    expect([...TASAS_ITBIS_VALIDAS]).toEqual(["0", "16", "18"]);
  });

  it("accepts 0, 16 and 18; rejects 25", () => {
    expect(esTasaItbisValida("0")).toBe(true);
    expect(esTasaItbisValida("16")).toBe(true);
    expect(esTasaItbisValida("18")).toBe(true);
    expect(esTasaItbisValida("25")).toBe(false);
  });

  it("keeps the error message text", () => {
    expect(messageFor(TASA_ITBIS_INVALIDA)).toBe(
      "La tasa de ITBIS debe ser 0%, 16% o 18%",
    );
  });
});
