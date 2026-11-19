/**
 * Unit — payment-date band gate (board-03 S14).
 *
 * Proves the `America/Santo_Domingo` calendar-day band the cobros collection
 * enforces on an editable `Fecha del pago`: future dates are ALWAYS rejected and
 * the retroactive horizon is a tenant parameter, both compared as SD DAYS against
 * the injected SERVER instant (a stale/hostile client clock can never widen the
 * band). `now` is injected so the rule is deterministic — domain-only, no DB.
 */

import {
  CobroDomainError,
  FECHA_COBRO_FUTURA,
  FECHA_COBRO_RETROACTIVA_EXCEDIDA,
  messageFor,
} from "./errors";
import { hoyEnSD, instanteDeFechaCobroSD, validarFechaCobro } from "./fecha-cobro";

/** 10/08/2026 11:00 in America/Santo_Domingo (UTC-4, no DST). */
const AHORA = new Date("2026-08-10T15:00:00.000Z");
const HORIZONTE = 7;

function codigoDe(fn: () => void): string {
  try {
    fn();
  } catch (err) {
    if (err instanceof CobroDomainError) return err.code;
    throw err;
  }
  throw new Error("se esperaba un CobroDomainError");
}

describe("instanteDeFechaCobroSD — SD calendar date → persisted instant", () => {
  it("anchors the SD date at SD noon (SD is UTC-4, no DST)", () => {
    expect(instanteDeFechaCobroSD("2026-08-10").toISOString()).toBe(
      "2026-08-10T16:00:00.000Z",
    );
  });

  it("fails loud on a malformed SD date instead of inventing an instant", () => {
    expect(() => instanteDeFechaCobroSD("10/08/2026")).toThrow(/fecha/i);
    expect(() => instanteDeFechaCobroSD("2026-02-31")).toThrow(/fecha/i);
  });
});

describe("hoyEnSD — the SD calendar day of a server instant", () => {
  it("renders the SD day even when UTC is already on the next day", () => {
    // 10/08/2026 22:00 SD == 11/08/2026 02:00 UTC.
    expect(hoyEnSD(new Date("2026-08-11T02:00:00.000Z"))).toBe("2026-08-10");
  });
});

describe("validarFechaCobro — SD calendar-day band (inclusive both ends)", () => {
  it("accepts today, yesterday and the horizon boundary", () => {
    expect(() => validarFechaCobro(instanteDeFechaCobroSD("2026-08-10"), HORIZONTE, AHORA)).not.toThrow();
    expect(() => validarFechaCobro(instanteDeFechaCobroSD("2026-08-09"), HORIZONTE, AHORA)).not.toThrow();
    // hoy_SD − 7 días = 03/08/2026 — the inclusive retroactive edge.
    expect(() => validarFechaCobro(instanteDeFechaCobroSD("2026-08-03"), HORIZONTE, AHORA)).not.toThrow();
  });

  it("rejects a future SD date with FECHA_COBRO_FUTURA, never widened by config", () => {
    expect(
      codigoDe(() => validarFechaCobro(instanteDeFechaCobroSD("2026-08-11"), HORIZONTE, AHORA)),
    ).toBe(FECHA_COBRO_FUTURA);
    // A zero horizon cannot make a future date legal either.
    expect(
      codigoDe(() => validarFechaCobro(instanteDeFechaCobroSD("2026-08-11"), 0, AHORA)),
    ).toBe(FECHA_COBRO_FUTURA);
  });

  it("rejects one SD day beyond the horizon with FECHA_COBRO_RETROACTIVA_EXCEDIDA", () => {
    expect(
      codigoDe(() => validarFechaCobro(instanteDeFechaCobroSD("2026-08-02"), HORIZONTE, AHORA)),
    ).toBe(FECHA_COBRO_RETROACTIVA_EXCEDIDA);
  });

  it("judges the band on the SD day, not the UTC day", () => {
    // 09/08/2026 22:00 SD (10/08 02:00 UTC) is "today" in SD
    // 10/08/2026 00:00 SD (10/08 04:00 UTC) is still "today" in SD.
    const ahoraTarde = new Date("2026-08-11T02:00:00.000Z");
    expect(() => validarFechaCobro(instanteDeFechaCobroSD("2026-08-10"), 0, ahoraTarde)).not.toThrow();
    // 11/08 SD IS future at that instant even though UTC already moved to 11/08.
    expect(
      codigoDe(() => validarFechaCobro(instanteDeFechaCobroSD("2026-08-11"), 0, ahoraTarde)),
    ).toBe(FECHA_COBRO_FUTURA);
  });

  it("fails loud (plain Error, no catalog code) on a config horizon defect", () => {
    expect(() => validarFechaCobro(instanteDeFechaCobroSD("2026-08-10"), -1, AHORA)).toThrow(
      /horizonteDias/,
    );
    expect(() => validarFechaCobro(instanteDeFechaCobroSD("2026-08-10"), 1.5, AHORA)).toThrow(
      /horizonteDias/,
    );
  });

  it("carries the catalog message, never a stack trace or internal detail", () => {
    try {
      validarFechaCobro(instanteDeFechaCobroSD("2026-08-11"), HORIZONTE, AHORA);
    } catch (err) {
      expect(err).toBeInstanceOf(CobroDomainError);
      const e = err as CobroDomainError;
      expect(e.message).toBe(messageFor(FECHA_COBRO_FUTURA));
      expect(e.message).not.toMatch(/Prisma|Error:|at .*\.ts/);
      expect(e.details).toMatchObject({ fechaCobro: "2026-08-11T16:00:00.000Z" });
    }
  });
});
