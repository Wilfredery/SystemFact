import { formatearFechaSD } from "./date";

/**
 * Behavioural LOCK for the shared `formatearFechaSD` (F0.3). The four spec
 * scenarios (format spec) plus the unparseable fallback:
 *  1. UTC instant resolves to the SD calendar day (UTC-4 off-by-one day).
 *  2. Same-day instant stays exact.
 *  3. Bare `YYYY-MM-DD` (already an SD date) renders the same day — no shift.
 *  4. `""` / `not-a-date` → `—`.
 */
describe("formatearFechaSD (America/Santo_Domingo display, shared F0.3)", () => {
  it("resolves a UTC instant to the SD calendar day (off-by-one at UTC-4)", () => {
    // 2026-01-01T02:30Z = 2025-12-31 22:30 in Santo Domingo.
    expect(formatearFechaSD("2026-01-01T02:30:00.000Z")).toBe("31/12/2025");
  });

  it("keeps a same-day UTC instant exact", () => {
    // 2026-10-13T14:00Z = 10:00 SD on 2026-10-13.
    expect(formatearFechaSD("2026-10-13T14:00:00.000Z")).toBe("13/10/2026");
  });

  it("renders a bare SD date unchanged (no tz shift, zero-padded)", () => {
    expect(formatearFechaSD("2026-01-31")).toBe("31/01/2026");
  });

  it("accepts a Date instance", () => {
    expect(formatearFechaSD(new Date("2026-01-01T02:30:00.000Z"))).toBe(
      "31/12/2025",
    );
  });

  it("falls back to an em-dash for empty and unparseable input", () => {
    expect(formatearFechaSD("")).toBe("—");
    expect(formatearFechaSD("not-a-date")).toBe("—");
  });

  it("falls back to an em-dash for an invalid Date instance", () => {
    expect(formatearFechaSD(new Date("not-a-date"))).toBe("—");
  });
});
