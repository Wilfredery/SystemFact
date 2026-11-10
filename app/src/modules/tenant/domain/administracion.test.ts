/**
 * Administración — pure NCF usage math (S2c "% used" of a sequence range).
 *
 * No DB, no Prisma: `calcularPorcentajeUsado` is the single place that turns the
 * stored `secuenciaActual` ("LAST USED value", ncf D7) into the percentage the
 * Configuración tab shows. Exact integer arithmetic (no float money rules here,
 * but the same discipline avoids rounding surprises on the 90% boundary).
 */

import { calcularPorcentajeUsado } from "./administracion";

describe("calcularPorcentajeUsado", () => {
  it("is 0 for a range that has never been used (secuenciaActual 0)", () => {
    // secuenciaActual 0 is the seeded "nothing consumed yet" value and is BELOW
    // rangoInicio, so no negative/oversized percentage may leak to the screen.
    expect(
      calcularPorcentajeUsado({ rangoInicio: 1n, rangoFin: 100n, secuenciaActual: 0n }),
    ).toBe(0);
  });

  it("is 0 when the pointer is below the range start", () => {
    expect(
      calcularPorcentajeUsado({
        rangoInicio: 500n,
        rangoFin: 600n,
        secuenciaActual: 400n,
      }),
    ).toBe(0);
  });

  it("counts the first used number as one of the inclusive range", () => {
    // 1 of 100 used (rangoInicio is itself the first issuable number).
    expect(
      calcularPorcentajeUsado({ rangoInicio: 1n, rangoFin: 100n, secuenciaActual: 1n }),
    ).toBe(1);
  });

  it("rounds to the nearest whole percent", () => {
    // 2 of 3 = 66.67% → 67; 50 of 100 = 50.
    expect(
      calcularPorcentajeUsado({ rangoInicio: 1n, rangoFin: 3n, secuenciaActual: 2n }),
    ).toBe(67);
    expect(
      calcularPorcentajeUsado({ rangoInicio: 1n, rangoFin: 100n, secuenciaActual: 50n }),
    ).toBe(50);
  });

  it("is 100 at the last number of the range", () => {
    expect(
      calcularPorcentajeUsado({
        rangoInicio: 1n,
        rangoFin: 100n,
        secuenciaActual: 100n,
      }),
    ).toBe(100);
  });

  it("reports ABOVE 100 when the stored pointer is past the range (never clamps)", () => {
    // Clamping would hide an exhausted/misconfigured range, which is exactly the
    // condition the Configuración tab exists to surface.
    expect(
      calcularPorcentajeUsado({
        rangoInicio: 1n,
        rangoFin: 100n,
        secuenciaActual: 150n,
      }),
    ).toBe(150);
  });

  it("is 0 for a degenerate (inverted) range instead of throwing", () => {
    expect(
      calcularPorcentajeUsado({ rangoInicio: 100n, rangoFin: 99n, secuenciaActual: 100n }),
    ).toBe(0);
  });
});
