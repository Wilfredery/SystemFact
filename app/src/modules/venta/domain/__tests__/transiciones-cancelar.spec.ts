/**
 * Pure confirmed-cancellation transition tests (spec R-V16, task 3.9 unit half).
 * No DB.
 *
 * `transicionarCancelarConfirmada` accepts ONLY `CONFIRMADA` and yields
 * `CANCELADA`; a `BORRADOR` (which must go through the draft-cancel predicate) and
 * a terminal `CANCELADA` (a repeated cancel) are refused. This is DISTINCT from
 * `puedeCancelar` / `transicionarConfirmar`: the draft-cancel path and the confirm
 * path are asserted unchanged, which is the R-V16 "Draft-cancel path untouched"
 * guarantee (R-V16 via R-V4) — the confirmed side effects are unreachable from a
 * draft and vice-versa.
 */

import {
  ESTADO_VENTA,
  puedeCancelar,
  transicionarCancelarConfirmada,
  transicionarConfirmar,
} from "../venta";

describe("transicionarCancelarConfirmada (R-V16)", () => {
  it("accepts only CONFIRMADA and yields CANCELADA", () => {
    expect(transicionarCancelarConfirmada(ESTADO_VENTA.CONFIRMADA)).toEqual({
      permitido: true,
      estado: ESTADO_VENTA.CANCELADA,
    });
  });

  it("refuses BORRADOR (draft path) and the terminal CANCELADA, reporting the state", () => {
    expect(transicionarCancelarConfirmada(ESTADO_VENTA.BORRADOR)).toEqual({
      permitido: false,
      estadoActual: ESTADO_VENTA.BORRADOR,
    });
    expect(transicionarCancelarConfirmada(ESTADO_VENTA.CANCELADA)).toEqual({
      permitido: false,
      estadoActual: ESTADO_VENTA.CANCELADA,
    });
  });

  it("only CONFIRMADA is cancellable-as-confirmed among the three real states", () => {
    const confirmables = [
      ESTADO_VENTA.BORRADOR,
      ESTADO_VENTA.CONFIRMADA,
      ESTADO_VENTA.CANCELADA,
    ].filter((e) => transicionarCancelarConfirmada(e).permitido);
    expect(confirmables).toEqual([ESTADO_VENTA.CONFIRMADA]);
  });
});

describe("confirmed-cancel does not disturb the other transitions (R-V16)", () => {
  it("the draft-cancel predicate is still BORRADOR-only (never CONFIRMADA)", () => {
    expect(puedeCancelar(ESTADO_VENTA.BORRADOR)).toBe(true);
    expect(puedeCancelar(ESTADO_VENTA.CONFIRMADA)).toBe(false);
    expect(puedeCancelar(ESTADO_VENTA.CANCELADA)).toBe(false);
  });

  it("a CONFIRMADA sale is NOT confirmable again (transicionarConfirmar refuses it)", () => {
    expect(transicionarConfirmar(ESTADO_VENTA.CONFIRMADA)).toEqual({
      permitido: false,
      estadoActual: ESTADO_VENTA.CONFIRMADA,
    });
  });
});
