/**
 * Pure confirmation-transition tests (spec R-V15 / R-V13 / R-V16, task 2.3). No DB.
 *
 * `transicionarConfirmar` accepts ONLY `BORRADOR` and yields `CONFIRMADA`; every
 * other already-represented state is refused (the application maps that refusal to
 * `VENTA_INMUTABLE`). The draft-cancel path (`puedeCancelar`) is asserted to stay
 * untouched (R-V16 "Draft-cancel path untouched"). A state value OUTSIDE the enum
 * can never reach the transition: `estadoVentaDesdeDb` fails LOUD on it, which is
 * the fail-loud half of R-V13.
 */

import {
  ESTADO_VENTA,
  EstadoVentaNoRepresentableError,
  estadoVentaDesdeDb,
  transicionarConfirmar,
  puedeCancelar,
} from "../venta";

describe("transicionarConfirmar (R-V15)", () => {
  it("accepts only BORRADOR and yields CONFIRMADA", () => {
    expect(transicionarConfirmar(ESTADO_VENTA.BORRADOR)).toEqual({
      permitido: true,
      estado: ESTADO_VENTA.CONFIRMADA,
    });
  });

  it("refuses CONFIRMADA (retry) and CANCELADA, reporting the current state", () => {
    expect(transicionarConfirmar(ESTADO_VENTA.CONFIRMADA)).toEqual({
      permitido: false,
      estadoActual: ESTADO_VENTA.CONFIRMADA,
    });
    expect(transicionarConfirmar(ESTADO_VENTA.CANCELADA)).toEqual({
      permitido: false,
      estadoActual: ESTADO_VENTA.CANCELADA,
    });
  });
});

describe("exhaustive DB mapping guards the transition (R-V13 fail-loud)", () => {
  it("throws for a stored value outside EstadoVenta before any transition", () => {
    expect(() => estadoVentaDesdeDb("PAGADA")).toThrow(EstadoVentaNoRepresentableError);
    expect(() => estadoVentaDesdeDb("")).toThrow(Error);
  });

  it("only BORRADOR maps into a permitted confirmation among the three real states", () => {
    const confirmables = [ESTADO_VENTA.BORRADOR, ESTADO_VENTA.CONFIRMADA, ESTADO_VENTA.CANCELADA].filter(
      (e) => transicionarConfirmar(e).permitido,
    );
    expect(confirmables).toEqual([ESTADO_VENTA.BORRADOR]);
  });
});

describe("draft-cancel path is untouched by confirmation (R-V16)", () => {
  it("cancel reachability is unchanged: only BORRADOR cancels", () => {
    expect(puedeCancelar(ESTADO_VENTA.BORRADOR)).toBe(true);
    expect(puedeCancelar(ESTADO_VENTA.CANCELADA)).toBe(false);
    expect(puedeCancelar(ESTADO_VENTA.CONFIRMADA)).toBe(false);
  });
});
