/**
 * Unit — Caja domain Santo-Domingo day window (S5). No database.
 *
 * Pins the day boundary the daily close is defined on: the SD calendar day maps to a HALF-OPEN
 * UTC window [inicio, fin) of exactly 24 h at a fixed UTC-4 (SD does not observe DST). The 04:00
 * UTC crossover is the whole risk of this module — an instant one millisecond before it belongs
 * to the PREVIOUS SD day, and the boundary instant itself belongs to the day.
 */

import { CajaDomainError, CAJA_VALIDACION } from "./errors";
import {
  fechaHoySD,
  fechaSDDe,
  estaEnVentanaSD,
  ventanaDiaActualSD,
  ventanaDiaSD,
} from "./zona";

describe("fechaSDDe — UTC instant → SD calendar date", () => {
  it("03:59 UTC is still the PREVIOUS SD day (23:59 SD)", () => {
    expect(fechaSDDe(new Date("2026-11-11T03:59:00.000Z"))).toBe("2026-11-10");
  });

  it("04:00 UTC is the SD day itself (00:00 SD)", () => {
    expect(fechaSDDe(new Date("2026-11-11T04:00:00.000Z"))).toBe("2026-11-11");
  });

  it("the crossover is millisecond-exact", () => {
    expect(fechaSDDe(new Date("2026-11-11T03:59:59.999Z"))).toBe("2026-11-10");
    expect(fechaSDDe(new Date("2026-11-11T04:00:00.000Z"))).toBe("2026-11-11");
  });

  it("a late-evening UTC instant that is already 'tomorrow' in SD is formatted in SD", () => {
    // 2026-11-12T02:30Z = 2026-11-11 22:30 SD.
    expect(fechaSDDe(new Date("2026-11-12T02:30:00.000Z"))).toBe("2026-11-11");
  });
});

describe("ventanaDiaSD — half-open [inicio, fin) UTC window", () => {
  it("a normal SD day starts 04:00Z and ends the next 04:00Z (fixed UTC-4)", () => {
    const v = ventanaDiaSD("2026-11-11");
    expect(v.fechaSD).toBe("2026-11-11");
    expect(v.inicio.toISOString()).toBe("2026-11-11T04:00:00.000Z");
    expect(v.fin.toISOString()).toBe("2026-11-12T04:00:00.000Z");
  });

  it("is exactly 24 hours wide (SD does NOT observe DST)", () => {
    expect(ventanaDiaSD("2026-11-11").fin.getTime() - ventanaDiaSD("2026-11-11").inicio.getTime()).toBe(
      24 * 60 * 60 * 1000,
    );
  });

  it("keeps the same -4 offset in every month of the year (no DST assumption to break)", () => {
    for (const fecha of ["2026-01-15", "2026-03-15", "2026-07-15", "2026-11-15"]) {
      const v = ventanaDiaSD(fecha);
      expect(v.inicio.toISOString()).toBe(`${fecha}T04:00:00.000Z`);
      expect(v.fin.getTime() - v.inicio.getTime()).toBe(24 * 60 * 60 * 1000);
    }
  });

  it("month end rolls into the 1st at 04:00Z", () => {
    const v = ventanaDiaSD("2026-11-30");
    expect(v.inicio.toISOString()).toBe("2026-11-30T04:00:00.000Z");
    expect(v.fin.toISOString()).toBe("2026-12-01T04:00:00.000Z");
  });

  it("year end rolls into the next year at 04:00Z", () => {
    const v = ventanaDiaSD("2026-12-31");
    expect(v.inicio.toISOString()).toBe("2026-12-31T04:00:00.000Z");
    expect(v.fin.toISOString()).toBe("2027-01-01T04:00:00.000Z");
  });

  it("handles a leap day (2028-02-29) and its rollover", () => {
    const v = ventanaDiaSD("2028-02-29");
    expect(v.inicio.toISOString()).toBe("2028-02-29T04:00:00.000Z");
    expect(v.fin.toISOString()).toBe("2028-03-01T04:00:00.000Z");
  });

  it("rejects a malformed or non-existent calendar date with CAJA_VALIDACION", () => {
    for (const fecha of ["2026-02-31", "2026-13-01", "2026-2-3", "11/11/2026", "", "hoy"]) {
      expect(() => ventanaDiaSD(fecha)).toThrow(CajaDomainError);
      try {
        ventanaDiaSD(fecha);
      } catch (e) {
        expect((e as CajaDomainError).code).toBe(CAJA_VALIDACION);
      }
    }
  });
});

describe("estaEnVentanaSD — half-open membership", () => {
  const v = ventanaDiaSD("2026-11-11");

  it("includes the boundary instant itself (inicio is INclusive)", () => {
    expect(estaEnVentanaSD(new Date("2026-11-11T04:00:00.000Z"), v)).toBe(true);
  });

  it("excludes one millisecond before inicio (previous SD day)", () => {
    expect(estaEnVentanaSD(new Date("2026-11-11T03:59:59.999Z"), v)).toBe(false);
  });

  it("excludes the fin instant itself (fin is EXclusive — it belongs to the next day)", () => {
    expect(estaEnVentanaSD(new Date("2026-11-12T04:00:00.000Z"), v)).toBe(false);
    expect(estaEnVentanaSD(new Date("2026-11-12T03:59:59.999Z"), v)).toBe(true);
  });
});

describe("fechaHoySD / ventanaDiaActualSD — today in SD, never UTC", () => {
  it("resolves 'today' from the SD calendar day, not the UTC one", () => {
    expect(fechaHoySD(new Date("2026-11-11T02:00:00.000Z"))).toBe("2026-11-10");
    expect(fechaHoySD(new Date("2026-11-11T04:00:00.000Z"))).toBe("2026-11-11");
  });

  it("builds today's window from that SD day", () => {
    const v = ventanaDiaActualSD(new Date("2026-11-11T03:59:59.999Z"));
    expect(v.fechaSD).toBe("2026-11-10");
    expect(v.inicio.toISOString()).toBe("2026-11-10T04:00:00.000Z");
    expect(v.fin.toISOString()).toBe("2026-11-11T04:00:00.000Z");
  });

  it("defaults 'now' to the real clock (window is 24 h and contains now)", () => {
    const ahora = new Date();
    const v = ventanaDiaActualSD();
    expect(v.fin.getTime() - v.inicio.getTime()).toBe(24 * 60 * 60 * 1000);
    expect(estaEnVentanaSD(ahora, v)).toBe(true);
  });
});
