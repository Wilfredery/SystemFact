/**
 * Unit — `consultarCierreDiario` (S6). No DB: the repository aggregates and the company-wide widen
 * are mocked, so this pins only the USE-CASE orchestration and its composition with the pure domain.
 *
 * Covered: today-only SD window resolution (no retro parameter exists), zero day, method groups,
 * a negative corte (refunds above receipts), the diferencia kept SEPARATE from the corte, and the
 * Admin company-wide widen vs the branch-pinned read.
 */

import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import { CAJA_VALIDACION, CajaDomainError } from "../domain/errors";
import { consultarCierreDiario } from "./consultar-cierre-diario";
import * as zona from "../domain/zona";
import {
  cobrosEfectivoPorMetodoEnTx,
  costoVendidoDiaEnTx,
  reembolsosEfectivoEnTx,
  totalesVentaDiaEnTx,
} from "../infrastructure/caja-repository";
import { conSucursalAmpliadaEnTx } from "@/modules/reportes/infrastructure/widen-sucursal-guc";

jest.mock("../infrastructure/caja-repository", () => ({
  cobrosEfectivoPorMetodoEnTx: jest.fn(),
  reembolsosEfectivoEnTx: jest.fn(),
  totalesVentaDiaEnTx: jest.fn(),
  costoVendidoDiaEnTx: jest.fn(),
}));
jest.mock("@/modules/reportes/infrastructure/widen-sucursal-guc", () => ({
  conSucursalAmpliadaEnTx: jest.fn(
    async (
      _tx: unknown,
      _ctx: unknown,
      lectura: (tx: unknown) => Promise<unknown>,
    ) => lectura({}),
  ),
}));

const tx = {} as PrismaTx;

function ctx(esAdmin = true, sucursalId = 3): TenantCtx {
  return { empresaId: 7, sucursalId, usuarioId: 11, esAdmin };
}

/** A fixed instant inside the SD day 2026-11-11 (12:00Z = 08:00 SD). */
const AHORA = new Date("2026-11-11T12:00:00.000Z");

beforeEach(() => {
  jest.clearAllMocks();
  (cobrosEfectivoPorMetodoEnTx as jest.Mock).mockResolvedValue([]);
  (reembolsosEfectivoEnTx as jest.Mock).mockResolvedValue({ devoluciones: "0.00", cantidad: 0 });
  (totalesVentaDiaEnTx as jest.Mock).mockResolvedValue({ totalFacturado: "0.00", operaciones: 0 });
});

describe("consultarCierreDiario — zero day", () => {
  it("reports the wireframe's RD$ 0.00 everywhere and the SD date of the day", async () => {
    const r = await consultarCierreDiario(tx, ctx(), AHORA);

    expect(r).toEqual({
      ok: true,
      data: {
        fechaSD: "2026-11-11",
        totalFacturado: "0.00",
        totalCobrado: "0.00",
        efectivoEsperado: "0.00",
        diferencia: "0.00",
        metodos: [],
        corte: { cobros: "0.00", devoluciones: "0.00" },
      },
    });
  });
});

describe("consultarCierreDiario — composition with the pure domain", () => {
  it("sums the method groups and derives the corte from the cash column", async () => {
    (cobrosEfectivoPorMetodoEnTx as jest.Mock).mockResolvedValue([
      { metodo: "EFECTIVO", cobros: "1500.50", cantidad: 3 },
    ]);
    (reembolsosEfectivoEnTx as jest.Mock).mockResolvedValue({
      devoluciones: "500.25",
      cantidad: 1,
    });
    (totalesVentaDiaEnTx as jest.Mock).mockResolvedValue({
      totalFacturado: "2000.00",
      operaciones: 4,
    });

    const r = await consultarCierreDiario(tx, ctx(), AHORA);

    expect(r.ok && r.data).toEqual({
      fechaSD: "2026-11-11",
      totalFacturado: "2000.00",
      totalCobrado: "1500.50",
      efectivoEsperado: "1000.25",
      // total cobrado − total facturado, KEPT SEPARATE from the corte (§docs).
      diferencia: "-499.50",
      metodos: [{ metodo: "EFECTIVO", cobros: "1500.50", cantidad: 3 }],
      corte: { cobros: "1500.50", devoluciones: "500.25" },
    });
  });

  it("preserves a NEGATIVE efectivo esperado when refunds exceed cash receipts", async () => {
    (cobrosEfectivoPorMetodoEnTx as jest.Mock).mockResolvedValue([
      { metodo: "EFECTIVO", cobros: "100.00", cantidad: 1 },
    ]);
    (reembolsosEfectivoEnTx as jest.Mock).mockResolvedValue({
      devoluciones: "350.00",
      cantidad: 2,
    });

    const r = await consultarCierreDiario(tx, ctx(), AHORA);

    expect(r.ok && r.data.efectivoEsperado).toBe("-250.00");
    expect(r.ok && r.data.corte).toEqual({ cobros: "100.00", devoluciones: "350.00" });
  });

  it("sums EVERY method group into total cobrado (method-agnostic domain)", async () => {
    (cobrosEfectivoPorMetodoEnTx as jest.Mock).mockResolvedValue([
      { metodo: "EFECTIVO", cobros: "10.00", cantidad: 1 },
      { metodo: "TARJETA", cobros: "20.00", cantidad: 1 },
    ]);

    const r = await consultarCierreDiario(tx, ctx(), AHORA);

    expect(r.ok && r.data.totalCobrado).toBe("30.00");
  });
});

describe("consultarCierreDiario — today-only SD window and tenant scope", () => {
  it("resolves the SD day of `ahora` (03:59Z belongs to the PREVIOUS SD day) and binds a half-open window", async () => {
    await consultarCierreDiario(tx, ctx(), new Date("2026-11-11T03:59:00.000Z"));

    const ventana = (cobrosEfectivoPorMetodoEnTx as jest.Mock).mock.calls[0]![2];
    expect(ventana).toEqual({
      fechaSD: "2026-11-10",
      inicio: new Date("2026-11-10T04:00:00.000Z"),
      fin: new Date("2026-11-11T04:00:00.000Z"),
    });
    // Every aggregate read uses the SAME window instance's values.
    for (const fn of [reembolsosEfectivoEnTx, totalesVentaDiaEnTx] as jest.Mock[]) {
      expect(fn.mock.calls[0]![2]).toEqual(ventana);
    }
  });

  it("an Admin reads company-wide: the widen runs and no branch narrowing is bound", async () => {
    await consultarCierreDiario(tx, ctx(true, 3), AHORA);

    expect(conSucursalAmpliadaEnTx).toHaveBeenCalledTimes(1);
    expect((cobrosEfectivoPorMetodoEnTx as jest.Mock).mock.calls[0]![3]).toBeNull();
    expect((totalesVentaDiaEnTx as jest.Mock).mock.calls[0]![3]).toBeNull();
  });

  it("a non-Admin is pinned to its own branch and never widens", async () => {
    await consultarCierreDiario(tx, ctx(false, 5), AHORA);

    expect(conSucursalAmpliadaEnTx).not.toHaveBeenCalled();
    expect((cobrosEfectivoPorMetodoEnTx as jest.Mock).mock.calls[0]![3]).toBe(5);
    expect((reembolsosEfectivoEnTx as jest.Mock).mock.calls[0]![3]).toBe(5);
    expect((totalesVentaDiaEnTx as jest.Mock).mock.calls[0]![3]).toBe(5);
  });

  it("maps an unresolvable SD day to the stable CAJA_VALIDACION code, reading nothing", async () => {
    const spy = jest
      .spyOn(zona, "ventanaDiaActualSD")
      .mockImplementation(() => {
        throw new CajaDomainError(CAJA_VALIDACION, { campo: "fechaSD" });
      });

    try {
      const r = await consultarCierreDiario(tx, ctx(), AHORA);

      expect(r.ok).toBe(false);
      expect(!r.ok && r.code).toBe(CAJA_VALIDACION);
      expect(!r.ok && r.message.length).toBeGreaterThan(0);
      expect(cobrosEfectivoPorMetodoEnTx).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});

describe("consultarCierreDiario — no extra cost read", () => {
  it("never reads the cost of goods sold (that belongs to the 06b resumen)", async () => {
    await consultarCierreDiario(tx, ctx(), AHORA);

    expect(costoVendidoDiaEnTx).not.toHaveBeenCalled();
  });
});
