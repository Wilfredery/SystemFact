/**
 * Unit — `listarMovimientosInventario` (odd/tasks/inventario-historial.md S4/S5).
 * The repository is mocked; `ahora` is injected.
 */

import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import { listarMovimientosInventario } from "./listar-movimientos-inventario";
import {
  contarMovimientosEnTx,
  listarMovimientosEnTx,
} from "../infrastructure/movimientos-repository";
import {
  LIMITE_PAGINACION_INVALIDO,
  PAGINA_INVALIDA,
  RANGO_FECHAS_EXCEDIDO,
  RANGO_FECHAS_INVALIDO,
  messageFor,
  type InventarioErrorCode,
} from "../domain/errors";

jest.mock("../infrastructure/movimientos-repository", () => ({
  listarMovimientosEnTx: jest.fn(),
  contarMovimientosEnTx: jest.fn(),
}));

const tx = {} as PrismaTx;
const ctx: TenantCtx = { empresaId: 7, sucursalId: 3, usuarioId: 11, esAdmin: true };
const AHORA = new Date("2026-11-14T16:00:00.000Z");

const FILA = {
  id: 1,
  fecha: "2026-11-05T15:00:00.000Z",
  tipo: "AJUSTE" as const,
  productoCodigo: "P-1",
  productoNombre: "Arroz",
  cantidadMovida: "5",
  cantidadAnterior: "10",
  cantidadNueva: "15",
  usuarioNombre: "Ana",
  motivo: "Conteo",
};

beforeEach(() => {
  jest.resetAllMocks();
  (listarMovimientosEnTx as jest.Mock).mockResolvedValue([FILA]);
  (contarMovimientosEnTx as jest.Mock).mockResolvedValue(61);
});

describe("listarMovimientosInventario", () => {
  it("defaults the range to the last 30 SD days and echoes it", async () => {
    const r = await listarMovimientosInventario(tx, ctx, { page: 1, limit: 25 }, AHORA);

    expect(r).toEqual({
      ok: true,
      data: {
        items: [FILA],
        total: 61,
        page: 1,
        limit: 25,
        desde: "2026-10-16",
        hasta: "2026-11-14",
      },
    });
    const filtros = (listarMovimientosEnTx as jest.Mock).mock.calls[0][2];
    expect(filtros.inicio.toISOString()).toBe("2026-10-16T04:00:00.000Z");
    expect(filtros.fin.toISOString()).toBe("2026-11-15T04:00:00.000Z");
  });

  it("passes tipo/producto and the SAME filters to the page and the count", async () => {
    await listarMovimientosInventario(
      tx,
      ctx,
      { page: 2, limit: 10, tipo: "SALIDA_VENTA", producto: "arr", desde: "2026-11-01", hasta: "2026-11-02" },
      AHORA,
    );

    const lista = (listarMovimientosEnTx as jest.Mock).mock.calls[0];
    const cuenta = (contarMovimientosEnTx as jest.Mock).mock.calls[0];
    expect(lista[0]).toBe(tx);
    expect(lista[1]).toBe(ctx);
    expect(lista[2]).toEqual({
      tipo: "SALIDA_VENTA",
      producto: "arr",
      inicio: new Date("2026-11-01T04:00:00.000Z"),
      fin: new Date("2026-11-03T04:00:00.000Z"),
    });
    expect(lista[3]).toEqual({ page: 2, limit: 10 });
    expect(cuenta[2]).toBe(lista[2]);
    expect(listarMovimientosEnTx).toHaveBeenCalledTimes(1);
    expect(contarMovimientosEnTx).toHaveBeenCalledTimes(1);
  });

  it.each<[Parameters<typeof listarMovimientosInventario>[2], InventarioErrorCode]>([
    [{ page: 1, limit: 0 }, LIMITE_PAGINACION_INVALIDO],
    [{ page: 1, limit: 101 }, LIMITE_PAGINACION_INVALIDO],
    [{ page: 0, limit: 25 }, PAGINA_INVALIDA],
    [{ page: 1, limit: 25, desde: "2026-11-10", hasta: "2026-11-09" }, RANGO_FECHAS_INVALIDO],
    [{ page: 1, limit: 25, desde: "2026-02-31", hasta: "2026-11-09" }, RANGO_FECHAS_INVALIDO],
    [{ page: 1, limit: 25, desde: "2026-01-01", hasta: "2026-11-09" }, RANGO_FECHAS_EXCEDIDO],
  ])("returns the typed error for %j and never reads", async (query, code) => {
    const r = await listarMovimientosInventario(tx, ctx, query, AHORA);

    expect(r).toEqual({ ok: false, code, message: messageFor(code) });
    expect(listarMovimientosEnTx).not.toHaveBeenCalled();
    expect(contarMovimientosEnTx).not.toHaveBeenCalled();
  });

  it("returns an empty page with total 0 when nothing matches", async () => {
    (listarMovimientosEnTx as jest.Mock).mockResolvedValue([]);
    (contarMovimientosEnTx as jest.Mock).mockResolvedValue(0);
    const r = await listarMovimientosInventario(tx, ctx, { page: 1, limit: 25 }, AHORA);

    expect(r).toMatchObject({ ok: true, data: { items: [], total: 0 } });
  });
});
