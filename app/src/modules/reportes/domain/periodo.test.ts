/**
 * Unit — Santo-Domingo dashboard period boundaries (DB-1). No DB.
 *
 * Pins the exact claim of the DB-1 scenario: a sale confirmed at 21:00 UTC is 17:00 SD
 * the SAME SD day (must fall inside that day's window), and a sale at 03:00 UTC is 23:00
 * SD the PREVIOUS day (must NOT fall in the current SD day window). The windows are the
 * UTC instants that bracket the SD calendar day/month via the reused Intl seam.
 */

import { ventanaDiaSD, ventanaMesSD } from "./periodo";

describe("ventanaDiaSD — SD calendar day window", () => {
  it("brackets an SD day with the 04:00Z boundaries (SD = fixed UTC-4)", () => {
    // 2026-01-15 14:00 SD is 18:00 UTC; the SD day is 04:00Z -> next 03:59:59.999Z.
    const w = ventanaDiaSD(new Date("2026-01-15T18:00:00.000Z"));
    expect(w.desdeSD).toBe("2026-01-15");
    expect(w.hastaSD).toBe("2026-01-15");
    expect(w.desde.toISOString()).toBe("2026-01-15T04:00:00.000Z");
    expect(w.hasta.toISOString()).toBe("2026-01-16T03:59:59.999Z");
  });

  it("a sale at 21:00 UTC (17:00 SD same day) is INSIDE that SD day's window", () => {
    const w = ventanaDiaSD(new Date("2026-01-15T21:00:00.000Z"));
    const venta = new Date("2026-01-15T21:00:00.000Z");
    expect(w.desdeSD).toBe("2026-01-15");
    expect(venta >= w.desde && venta <= w.hasta).toBe(true);
  });

  it("a sale at 03:00 UTC is 23:00 SD the PREVIOUS day — OUTSIDE the SD 16-day window", () => {
    // Instant 2026-01-16T03:00:00Z is still 2026-01-15 23:00 in SD.
    const venta = new Date("2026-01-16T03:00:00.000Z");
    const dia16 = ventanaDiaSD(new Date("2026-01-16T12:00:00.000Z")); // SD midday = 16
    const dia15 = ventanaDiaSD(venta);
    // It belongs to SD day 15's window, NOT SD day 16's window.
    expect(dia15.desdeSD).toBe("2026-01-15");
    expect(venta >= dia15.desde && venta <= dia15.hasta).toBe(true);
    expect(venta >= dia16.desde && venta <= dia16.hasta).toBe(false);
  });
});

describe("ventanaMesSD — SD calendar month window", () => {
  it("brackets the whole SD month (March 2026: 01..31)", () => {
    const w = ventanaMesSD(new Date("2026-03-15T18:00:00.000Z"));
    expect(w.desdeSD).toBe("2026-03-01");
    expect(w.hastaSD).toBe("2026-03-31");
    expect(w.desde.toISOString()).toBe("2026-03-01T04:00:00.000Z");
    expect(w.hasta.toISOString()).toBe("2026-04-01T03:59:59.999Z");
  });

  it("resolves a 28-day February and a leap February from the calendar (no hand-count)", () => {
    const feb2026 = ventanaMesSD(new Date("2026-02-10T18:00:00.000Z"));
    expect(feb2026.hastaSD).toBe("2026-02-28");
    const feb2024 = ventanaMesSD(new Date("2024-02-10T18:00:00.000Z"));
    expect(feb2024.hastaSD).toBe("2024-02-29");
  });

  it("a late-UTC-day sale (21:00 UTC = 17:00 SD) counts in its SD month", () => {
    const w = ventanaMesSD(new Date("2026-03-31T23:00:00.000Z")); // 19:00 SD Mar 31
    const venta = new Date("2026-03-31T23:00:00.000Z");
    expect(w.hastaSD).toBe("2026-03-31");
    expect(venta <= w.hasta).toBe(true);
  });
});
