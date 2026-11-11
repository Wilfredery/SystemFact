/**
 * Unit — Caja HTTP input validation (S6). No DB.
 *
 * The close is TODAY-ONLY by contract (S1: the wireframe has no date selector), so the transport
 * schema must ACCEPT the empty payload and REJECT any attempt to smuggle a day or a paging window
 * in: an unknown key (`fecha`, `fechaSD`, `retro`, `page`, …) is a validation failure, never
 * silently ignored. That is what makes "no retroactive date parameter anywhere" (S6) true at the
 * boundary instead of a convention.
 */

import {
  SESION_INVALIDA,
  VALIDATION_ERROR,
  mensajeTransporte,
  zConsultarCajaInput,
} from "./validations";

describe("caja transport codes", () => {
  it("carries a stable Spanish message for both transport codes", () => {
    expect(mensajeTransporte(VALIDATION_ERROR).length).toBeGreaterThan(0);
    expect(mensajeTransporte(SESION_INVALIDA).length).toBeGreaterThan(0);
    expect(mensajeTransporte(VALIDATION_ERROR)).toBe(mensajeTransporte(VALIDATION_ERROR));
  });

  it("falls back to a generic message for an unknown code", () => {
    expect(mensajeTransporte("OTRO")).toBe("Error");
  });
});

describe("zConsultarCajaInput (today-only, no retro date, no paging)", () => {
  it("accepts the empty payload (the read takes no input)", () => {
    expect(zConsultarCajaInput.safeParse({}).success).toBe(true);
  });

  it.each([
    ["fecha", { fecha: "2026-11-10" }],
    ["fechaSD", { fechaSD: "2026-11-10" }],
    ["retro", { retro: true }],
    ["desde", { desde: "2026-11-10T04:00:00.000Z" }],
    ["page", { page: 2 }],
    ["sucursalId", { sucursalId: 3 }],
    ["empresaId", { empresaId: 9 }],
  ])("rejects an extra %s key (no retroactive day, no paging, no scope override)", (_n, input) => {
    expect(zConsultarCajaInput.safeParse(input).success).toBe(false);
  });
});
