/**
 * Unit — Santo Domingo → UTC range conversion (AC-3). No DB.
 *
 * Santo Domingo is a fixed UTC-4 with no DST, so SD midnight of a day is that day's
 * UTC midnight at 04:00Z, and the SD day ends the last millisecond before the next
 * day's 04:00Z. These tests pin those exact instants and the fail-loud guards.
 */

import { AUDITORIA_VALIDACION, AuditoriaDomainError } from "./errors";
import { fechaSDaUTC, rangoFechasAUTC } from "./zona-horaria";

describe("fechaSDaUTC (SD calendar date → UTC instant)", () => {
  it("maps start-of-day to the UTC 04:00Z boundary (SD = UTC-4, no DST)", () => {
    expect(fechaSDaUTC("2026-01-15", "inicio").toISOString()).toBe(
      "2026-01-15T04:00:00.000Z",
    );
  });

  it("maps end-of-day to the last millisecond before the next day's 04:00Z", () => {
    expect(fechaSDaUTC("2026-01-15", "fin").toISOString()).toBe(
      "2026-01-16T03:59:59.999Z",
    );
  });

  it("a single SD day spans exactly one day (24h minus 1ms)", () => {
    const inicio = fechaSDaUTC("2026-03-01", "inicio").getTime();
    const fin = fechaSDaUTC("2026-03-01", "fin").getTime();
    expect(fin - inicio).toBe(86_400_000 - 1);
  });

  it("rejects a non-existent calendar date with AUDITORIA_VALIDACION", () => {
    expect.assertions(2);
    try {
      fechaSDaUTC("2026-02-31", "inicio");
    } catch (e) {
      expect(e).toBeInstanceOf(AuditoriaDomainError);
      expect((e as AuditoriaDomainError).code).toBe(AUDITORIA_VALIDACION);
    }
  });

  it("rejects a malformed date string that is not YYYY-MM-DD", () => {
    expect(() => fechaSDaUTC("2026-1-5", "fin")).toThrow(AuditoriaDomainError);
  });
});

describe("rangoFechasAUTC (optional SD range → UTC bounds)", () => {
  it("returns an empty object when both ends are omitted", () => {
    expect(rangoFechasAUTC({})).toEqual({});
  });

  it("converts only the provided end, leaving the other undefined", () => {
    const solo = rangoFechasAUTC({ desde: "2026-01-15" });
    expect(solo.desde?.toISOString()).toBe("2026-01-15T04:00:00.000Z");
    expect(solo.hasta).toBeUndefined();
  });

  it("converts a full closed range into inclusive UTC bounds", () => {
    const rango = rangoFechasAUTC({ desde: "2026-01-15", hasta: "2026-01-16" });
    expect(rango.desde?.toISOString()).toBe("2026-01-15T04:00:00.000Z");
    expect(rango.hasta?.toISOString()).toBe("2026-01-17T03:59:59.999Z");
  });
});
