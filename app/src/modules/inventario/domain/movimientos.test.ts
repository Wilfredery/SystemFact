/**
 * Pure unit tests — movement history range rules and tipo labels
 * (odd/tasks/inventario-historial.md, S1/S4/S7). No database; `ahora` is injected.
 */

import { TipoMovimiento } from "@/generated/prisma/client";
import {
  DIAS_RANGO_DEFECTO,
  DIAS_RANGO_MAXIMO,
  TIPOS_MOVIMIENTO,
  etiquetaTipoMovimiento,
  resolverRangoMovimientos,
} from "./movimientos";
import { RANGO_FECHAS_EXCEDIDO, RANGO_FECHAS_INVALIDO } from "./errors";

// 2026-11-14 22:30 SD (UTC-4) is already 2026-11-15 02:30Z: "today" must be the SD day.
const AHORA_NOCHE_SD = new Date("2026-11-15T02:30:00.000Z");
const AHORA = new Date("2026-11-14T16:00:00.000Z");

describe("tipo labels", () => {
  it("covers exactly the 7 Prisma TipoMovimiento values", () => {
    expect([...TIPOS_MOVIMIENTO].sort()).toEqual(Object.values(TipoMovimiento).sort());
    expect(TIPOS_MOVIMIENTO).toHaveLength(7);
  });

  it("gives every value a distinct non-empty Spanish label", () => {
    const etiquetas = TIPOS_MOVIMIENTO.map(etiquetaTipoMovimiento);
    for (const e of etiquetas) expect(e.trim().length).toBeGreaterThan(0);
    expect(new Set(etiquetas).size).toBe(7);
  });

  it("pins the labels", () => {
    expect(etiquetaTipoMovimiento("ENTRADA_COMPRA")).toBe("Entrada por compra");
    expect(etiquetaTipoMovimiento("SALIDA_VENTA")).toBe("Salida por venta");
    expect(etiquetaTipoMovimiento("ENTRADA_DEVOLUCION")).toBe("Entrada por devolución");
    expect(etiquetaTipoMovimiento("SALIDA_MERMA")).toBe("Salida por merma");
    expect(etiquetaTipoMovimiento("AJUSTE")).toBe("Ajuste manual");
    expect(etiquetaTipoMovimiento("REPOSICION_CANCELACION")).toBe("Reposición por cancelación");
    expect(etiquetaTipoMovimiento("SALIDA_CANCELACION_COMPRA")).toBe(
      "Salida por cancelación de compra",
    );
  });
});

describe("resolverRangoMovimientos", () => {
  it("defaults to the last 30 SD days ending today", () => {
    const r = resolverRangoMovimientos({}, AHORA);
    expect(r).toMatchObject({ ok: true, rango: { desde: "2026-10-16", hasta: "2026-11-14" } });
    expect(DIAS_RANGO_DEFECTO).toBe(30);
  });

  it("uses the SD day, not the UTC day, for 'today' (22:30 SD is already the next UTC day)", () => {
    const r = resolverRangoMovimientos({}, AHORA_NOCHE_SD);
    expect(r).toMatchObject({ ok: true, rango: { hasta: "2026-11-14", desde: "2026-10-16" } });
  });

  it("builds the half-open UTC window from SD midnights (UTC-4)", () => {
    const r = resolverRangoMovimientos({ desde: "2026-11-01", hasta: "2026-11-10" }, AHORA);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rango.inicio.toISOString()).toBe("2026-11-01T04:00:00.000Z");
    // EXCLUSIVE end = SD 00:00 of the day AFTER hasta.
    expect(r.rango.fin.toISOString()).toBe("2026-11-11T04:00:00.000Z");
  });

  it("accepts a single-day range", () => {
    const r = resolverRangoMovimientos({ desde: "2026-11-05", hasta: "2026-11-05" }, AHORA);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rango.fin.getTime() - r.rango.inicio.getTime()).toBe(24 * 3_600_000);
  });

  it("fills only the missing end: desde alone ends today; hasta alone spans 30 days", () => {
    expect(resolverRangoMovimientos({ desde: "2026-11-01" }, AHORA)).toMatchObject({
      ok: true,
      rango: { desde: "2026-11-01", hasta: "2026-11-14" },
    });
    expect(resolverRangoMovimientos({ hasta: "2026-11-10" }, AHORA)).toMatchObject({
      ok: true,
      rango: { desde: "2026-10-12", hasta: "2026-11-10" },
    });
  });

  it("allows exactly 90 days and rejects 91 (both ends counted)", () => {
    expect(DIAS_RANGO_MAXIMO).toBe(90);
    // 2026-08-17 .. 2026-11-14 = 90 days inclusive.
    expect(resolverRangoMovimientos({ desde: "2026-08-17", hasta: "2026-11-14" }, AHORA).ok).toBe(true);
    expect(resolverRangoMovimientos({ desde: "2026-08-16", hasta: "2026-11-14" }, AHORA)).toEqual({
      ok: false,
      code: RANGO_FECHAS_EXCEDIDO,
    });
  });

  it("rejects an inverted range", () => {
    expect(resolverRangoMovimientos({ desde: "2026-11-10", hasta: "2026-11-09" }, AHORA)).toEqual({
      ok: false,
      code: RANGO_FECHAS_INVALIDO,
    });
    // desde alone in the future is inverted against the default hasta (today).
    expect(resolverRangoMovimientos({ desde: "2026-11-20" }, AHORA)).toEqual({
      ok: false,
      code: RANGO_FECHAS_INVALIDO,
    });
  });

  it("rejects malformed and non-existent calendar dates", () => {
    for (const desde of ["2026-02-31", "2026-13-01", "14/11/2026", "2026-1-1", "x"]) {
      expect(resolverRangoMovimientos({ desde, hasta: "2026-11-14" }, AHORA)).toEqual({
        ok: false,
        code: RANGO_FECHAS_INVALIDO,
      });
    }
    expect(resolverRangoMovimientos({ hasta: "2026-02-30" }, AHORA)).toEqual({
      ok: false,
      code: RANGO_FECHAS_INVALIDO,
    });
  });

  it("handles month/year/leap rollovers in the default start", () => {
    expect(resolverRangoMovimientos({}, new Date("2028-03-10T16:00:00.000Z"))).toMatchObject({
      ok: true,
      rango: { desde: "2028-02-10", hasta: "2028-03-10" },
    });
    expect(resolverRangoMovimientos({}, new Date("2027-01-05T16:00:00.000Z"))).toMatchObject({
      ok: true,
      rango: { desde: "2026-12-07", hasta: "2027-01-05" },
    });
  });
});
