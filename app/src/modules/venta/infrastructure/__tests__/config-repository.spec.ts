/**
 * Unit — venta-config DESC_MAX reader (spec R-V17, fase-5c task 4.3).
 *
 * No DB: the reader is exercised against a structural fake of the Prisma tx so
 * the DETERMINISTIC RESOLUTION is pinned at the query level — with two active
 * rows whose validity windows overlap, the read MUST ask for
 * `orderBy: vigenciaInicio desc` so the newest window wins (CodeRabbit F5).
 * The real-DB behavior (latest row actually returned) is proven in
 * `src/integration/venta-config.integration.test.ts`.
 */

import {
  leerConfigVentaEnTx,
  VentaConfigError,
  DESC_MAX_FALTANTE,
} from "../config-repository";

/** Fake tx capturing the findFirst args and returning a scripted row. */
function makeTx(row: { valor: string } | null) {
  const findFirst = jest.fn<Promise<{ valor: string } | null>, [unknown]>(async () => row);
  const tx = { configuracionEmpresa: { findFirst } };
  return { tx: tx as never, findFirst };
}

const FECHA_VENTA = new Date("2026-03-01T00:00:00.000Z");

describe("leerConfigVentaEnTx (R-V17 deterministic window resolution)", () => {
  it("orders the covering-window read by vigenciaInicio DESC (latest window wins)", async () => {
    const { tx, findFirst } = makeTx({ valor: "25.00" });
    const valor = await leerConfigVentaEnTx(tx, 7, FECHA_VENTA);

    expect(valor).toBe("25.00");
    expect(findFirst).toHaveBeenCalledTimes(1);
    const args = findFirst.mock.calls[0][0] as {
      where: { empresaId: number; clave: string; activa: boolean };
      orderBy: unknown;
    };
    // Tenant + key + active + covering-window predicates stay in place.
    expect(args.where.empresaId).toBe(7);
    expect(args.where.clave).toBe("DESC_MAX");
    expect(args.where.activa).toBe(true);
    // R-V17: the pick MUST be deterministic — newest vigenciaInicio first.
    expect(args.orderBy).toEqual({ vigenciaInicio: "desc" });
  });

  it("returns the winning row's percent-form value verbatim", async () => {
    const { tx } = makeTx({ valor: "4" });
    await expect(leerConfigVentaEnTx(tx, 1, FECHA_VENTA)).resolves.toBe("4");
  });

  it("hard-fails DESC_MAX_FALTANTE with zero rows found (unchanged R-C1)", async () => {
    const { tx } = makeTx(null);
    await expect(leerConfigVentaEnTx(tx, 1, FECHA_VENTA)).rejects.toMatchObject({
      code: DESC_MAX_FALTANTE,
    });
  });

  it("rejects a non-numeric stored value (unchanged R-C1 grammar)", async () => {
    const { tx } = makeTx({ valor: "cuatro" });
    await expect(leerConfigVentaEnTx(tx, 1, FECHA_VENTA)).rejects.toBeInstanceOf(
      VentaConfigError,
    );
  });
});
