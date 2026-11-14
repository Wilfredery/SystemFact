/**
 * Domain unit tests — ITBIS rates in use (administracion-itbis S1/S3/S4).
 * Pure: no database. SD = America/Santo_Domingo (fixed UTC-4), so the SD day
 * of 2026-11-14 is [2026-11-14T04:00Z, 2026-11-15T04:00Z).
 */

import {
  armarTasasItbisEnUso,
  tasaVigenteHoy,
  type TasaItbisEnUsoLeida,
} from "./itbis-en-uso";

const AHORA = new Date("2026-11-14T15:00:00.000Z"); // SD 11:00 on 2026-11-14

describe("tasaVigenteHoy (window vs today's SD business day)", () => {
  it("is false when the window starts after today's SD day ends", () => {
    expect(tasaVigenteHoy(new Date("2026-11-15T04:00:00.000Z"), null, AHORA)).toBe(false);
  });

  it("is true when the window started before today (open-ended)", () => {
    expect(tasaVigenteHoy(new Date("2026-11-13T04:00:00.000Z"), null, AHORA)).toBe(true);
  });

  it("is true exactly at desde = start of today's SD day", () => {
    expect(tasaVigenteHoy(new Date("2026-11-14T04:00:00.000Z"), null, AHORA)).toBe(true);
  });

  it("is true when desde is the last millisecond of today's SD day", () => {
    expect(tasaVigenteHoy(new Date("2026-11-15T03:59:59.999Z"), null, AHORA)).toBe(true);
  });

  it("is true for an open-ended window (hasta null) far in the past", () => {
    expect(tasaVigenteHoy(new Date("2020-01-01T00:00:00.000Z"), null, AHORA)).toBe(true);
  });

  it("is true when hasta is exactly the start of today's SD day (inclusive, like tasaVigenteEn)", () => {
    expect(
      tasaVigenteHoy(
        new Date("2020-01-01T00:00:00.000Z"),
        new Date("2026-11-14T04:00:00.000Z"),
        AHORA,
      ),
    ).toBe(true);
  });

  it("is false when hasta ended before today's SD day started", () => {
    expect(
      tasaVigenteHoy(
        new Date("2020-01-01T00:00:00.000Z"),
        new Date("2026-11-14T03:59:59.999Z"),
        AHORA,
      ),
    ).toBe(false);
  });

  it("SD day boundary: 03:59 UTC is still the previous SD day", () => {
    const ahora = new Date("2026-11-14T03:59:00.000Z"); // SD 2026-11-13 23:59
    // desde at SD 2026-11-14 00:00 is tomorrow for that instant -> not vigente
    expect(tasaVigenteHoy(new Date("2026-11-14T04:00:00.000Z"), null, ahora)).toBe(false);
    // and a window that ended at SD 2026-11-13 00:00 - 1ms is over
    expect(
      tasaVigenteHoy(
        new Date("2020-01-01T00:00:00.000Z"),
        new Date("2026-11-13T03:59:59.999Z"),
        ahora,
      ),
    ).toBe(false);
    // while the same instant 04:00 UTC is already the next SD day
    expect(
      tasaVigenteHoy(new Date("2026-11-14T04:00:00.000Z"), null, new Date("2026-11-14T04:00:00.000Z")),
    ).toBe(true);
  });
});

function fila(overrides: Partial<TasaItbisEnUsoLeida>): TasaItbisEnUsoLeida {
  return {
    tasaItbis: "18.00",
    vigenteDesde: new Date("2026-01-01T04:00:00.000Z"),
    vigenteHasta: null,
    productos: 1,
    ...overrides,
  };
}

describe("armarTasasItbisEnUso", () => {
  it("returns an empty list for no rows (never a fabricated rate)", () => {
    expect(armarTasasItbisEnUso([], AHORA)).toEqual([]);
  });

  it("keeps the rate as the stored string and serializes the window as ISO / null", () => {
    expect(
      armarTasasItbisEnUso(
        [fila({ tasaItbis: "7.50", vigenteHasta: new Date("2030-01-01T04:00:00.000Z"), productos: 3 })],
        AHORA,
      ),
    ).toEqual([
      {
        tasaItbis: "7.50",
        vigenteDesde: "2026-01-01T04:00:00.000Z",
        vigenteHasta: "2030-01-01T04:00:00.000Z",
        productos: 3,
        vigenteHoy: true,
      },
    ]);
  });

  it("orders by rate descending (numerically) and then by vigente desde ascending", () => {
    const filas = [
      fila({ tasaItbis: "0.00" }),
      fila({ tasaItbis: "18.00", vigenteDesde: new Date("2026-06-01T04:00:00.000Z") }),
      fila({ tasaItbis: "9.00" }),
      fila({ tasaItbis: "18.00", vigenteDesde: new Date("2025-01-01T04:00:00.000Z") }),
    ];
    const r = armarTasasItbisEnUso(filas, AHORA);
    expect(r.map((x) => [x.tasaItbis, x.vigenteDesde])).toEqual([
      ["18.00", "2025-01-01T04:00:00.000Z"],
      ["18.00", "2026-06-01T04:00:00.000Z"],
      ["9.00", "2026-01-01T04:00:00.000Z"],
      ["0.00", "2026-01-01T04:00:00.000Z"],
    ]);
  });

  it("flags vigenteHoy per row for the SD business day", () => {
    const r = armarTasasItbisEnUso(
      [
        fila({ tasaItbis: "18.00" }),
        fila({ tasaItbis: "16.00", vigenteHasta: new Date("2026-11-14T03:59:59.999Z") }),
      ],
      AHORA,
    );
    expect(r.map((x) => [x.tasaItbis, x.vigenteHoy])).toEqual([
      ["18.00", true],
      ["16.00", false],
    ]);
  });
});
