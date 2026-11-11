/**
 * Unit — `consultarResumenDia` (06b / S2 / S6). No DB: the aggregates and the widen are mocked.
 *
 * Pins that 06b reads the SAME canonical `totalesVentaDiaEnTx` aggregate the close uses (so
 * "Ventas del día" can never disagree with 06a's "Total facturado"), that the margin figures come
 * from the pure domain (zero day, profit and LOSS preserved), and the same today-only SD window +
 * Admin widen rules as the close.
 */

import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import { consultarResumenDia } from "./consultar-resumen-dia";
import {
  costoVendidoDiaEnTx,
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

const AHORA = new Date("2026-11-11T12:00:00.000Z");

beforeEach(() => {
  jest.clearAllMocks();
  (totalesVentaDiaEnTx as jest.Mock).mockResolvedValue({ totalFacturado: "0.00", operaciones: 0 });
  (costoVendidoDiaEnTx as jest.Mock).mockResolvedValue({ costoVendido: "0.00" });
});

describe("consultarResumenDia", () => {
  it("a zero day reports 0.00 / 0.00 / 0.00 / 0.0", async () => {
    const r = await consultarResumenDia(tx, ctx(), AHORA);

    expect(r).toEqual({
      ok: true,
      data: {
        fechaSD: "2026-11-11",
        ventas: "0.00",
        costoVendido: "0.00",
        margenBruto: "0.00",
        margenPorcentaje: "0.0",
      },
    });
  });

  it("derives margin and margin % from the day's sales and cost of goods sold", async () => {
    (totalesVentaDiaEnTx as jest.Mock).mockResolvedValue({
      totalFacturado: "1000.00",
      operaciones: 3,
    });
    (costoVendidoDiaEnTx as jest.Mock).mockResolvedValue({ costoVendido: "674.00" });

    const r = await consultarResumenDia(tx, ctx(), AHORA);

    expect(r.ok && r.data).toEqual({
      fechaSD: "2026-11-11",
      ventas: "1000.00",
      costoVendido: "674.00",
      margenBruto: "326.00",
      margenPorcentaje: "32.6",
    });
  });

  it("preserves a NEGATIVE margin (cost above price is a real loss, never clamped)", async () => {
    (totalesVentaDiaEnTx as jest.Mock).mockResolvedValue({
      totalFacturado: "100.00",
      operaciones: 1,
    });
    (costoVendidoDiaEnTx as jest.Mock).mockResolvedValue({ costoVendido: "150.00" });

    const r = await consultarResumenDia(tx, ctx(), AHORA);

    expect(r.ok && r.data.margenBruto).toBe("-50.00");
    expect(r.ok && r.data.margenPorcentaje).toBe("-50.0");
  });

  it("uses the SAME canonical total-facturado aggregate as the close (no second sum)", async () => {
    await consultarResumenDia(tx, ctx(), AHORA);

    expect(totalesVentaDiaEnTx).toHaveBeenCalledTimes(1);
    const [txArg, ctxArg, ventana, sucursal] = (totalesVentaDiaEnTx as jest.Mock).mock
      .calls[0]!;
    expect(ctxArg).toEqual(ctx());
    expect(ventana).toEqual({
      fechaSD: "2026-11-11",
      inicio: new Date("2026-11-11T04:00:00.000Z"),
      fin: new Date("2026-11-12T04:00:00.000Z"),
    });
    expect(sucursal).toBeNull(); // Admin → company-wide
    expect(txArg).toBeDefined();
  });

  it("a non-Admin is pinned to its own branch and never widens", async () => {
    await consultarResumenDia(tx, ctx(false, 5), AHORA);

    expect(conSucursalAmpliadaEnTx).not.toHaveBeenCalled();
    expect((totalesVentaDiaEnTx as jest.Mock).mock.calls[0]![3]).toBe(5);
    expect((costoVendidoDiaEnTx as jest.Mock).mock.calls[0]![3]).toBe(5);
  });

  it("an Admin reads the resumen company-wide (widen runs once for the pair of reads)", async () => {
    await consultarResumenDia(tx, ctx(true, 3), AHORA);

    expect(conSucursalAmpliadaEnTx).toHaveBeenCalledTimes(1);
  });
});
