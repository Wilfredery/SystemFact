/**
 * Unit — the ONE canonical ConfiguracionEmpresa active-window reader seam
 * (shared `R-QC-08`, venta `R-C4`; design D8).
 *
 * No DB: the seam is exercised against a structural fake of the Prisma tx so
 * the SINGLE canonical predicate is pinned at the query level — every consumer
 * module (venta, compra, reportes, reportes-DGII) must reach the same read and
 * must NOT re-encode it (grep guard: `activa: true` in production code lives
 * only here). Real-window behavior (overlap, expiry, per-key coverage) is
 * proven on Postgres in `src/integration/config-seam.integration.test.ts`.
 *
 * The cutoff instant is FIXED at `2026-03-01T16:00:00.000Z`, whose Santo
 * Domingo wall time is 12:00 local (UTC−4, DST-free zone). The seam compares
 * ABSOLUTE `timestamptz` instants by design (risk #8): SD resolution is the
 * callers' job (they pass already-converted instants); the seam never
 * re-derives a calendar day.
 */

import {
  leerConfigActivaEnTx,
  leerConfigsActivasEnTx,
} from "./configuracion-empresa";

/** 2026-03-01T16:00Z === 2026-03-01 12:00 America/Santo_Domingo (UTC−4, no DST). */
const FECHA_CORTE_SD = new Date("2026-03-01T16:00:00.000Z");

interface FakeTxShape {
  configuracionEmpresa: {
    findFirst: jest.Mock;
    findMany: jest.Mock;
  };
}

function makeTx(row: { clave: string; valor: string } | null): {
  tx: never;
  findFirst: jest.Mock;
  findMany: jest.Mock;
} {
  const findFirst = jest.fn<Promise<typeof row>, [unknown]>(async () => row);
  const findMany = jest
    .fn<Promise<Array<typeof row>>, [unknown]>(async () =>
      row === null ? [] : [row],
    );
  const tx: FakeTxShape = { configuracionEmpresa: { findFirst, findMany } };
  return { tx: tx as never, findFirst, findMany };
}

describe("leerConfigActivaEnTx — the canonical single-key reader (D8)", () => {
  it("fires ONE findFirst with THE canonical active-window predicate verbatim", async () => {
    const { tx, findFirst } = makeTx({ clave: "DESC_MAX", valor: "4.00" });
    const fila = await leerConfigActivaEnTx(tx, 7, "DESC_MAX", FECHA_CORTE_SD);

    expect(fila).toEqual({ clave: "DESC_MAX", valor: "4.00" });
    expect(findFirst).toHaveBeenCalledTimes(1);
    const args = findFirst.mock.calls[0][0] as {
      where: {
        empresaId: number;
        clave: string;
        activa: boolean;
        vigenciaInicio: { lte: Date };
        vigenciaFin: { gte: Date };
      };
      orderBy: unknown;
      select: { clave: boolean; valor: boolean };
    };
    expect(args.where.empresaId).toBe(7);
    expect(args.where.clave).toBe("DESC_MAX");
    expect(args.where.activa).toBe(true);
    // The caller's cutoff instant flows into the window bounds VERBATIM — the
    // seam never re-derives a calendar day (risk #8: instant comparison).
    expect(args.where.vigenciaInicio.lte).toBe(FECHA_CORTE_SD);
    expect(args.where.vigenciaFin.gte).toBe(FECHA_CORTE_SD);
    // R-V17 deterministic tie-break: overlapping windows resolve to the
    // NEWEST residency — the pick MUST be ordered, never an arbitrary row.
    expect(args.orderBy).toEqual({ vigenciaInicio: "desc" });
    expect(args.select).toEqual({ clave: true, valor: true });
  });

  it("null row → null (absent key and expired window share the missing treatment)", async () => {
    const { tx, findFirst } = makeTx(null);
    await expect(
      leerConfigActivaEnTx(tx, 1, "DESC_MAX", FECHA_CORTE_SD),
    ).resolves.toBeNull();
    // Missing-key-vs-expired collapse happens ABOVE the seam: the consumer's
    // window filter makes an expired row invisible to the read itself.
    expect((findFirst.mock.calls[0][0] as { where: unknown }).where).toMatchObject({
      activa: true,
      vigenciaInicio: { lte: FECHA_CORTE_SD },
      vigenciaFin: { gte: FECHA_CORTE_SD },
    });
  });

  it("keeps per-module clave semantics OUT of the seam — it is a verbatim key pass-through", async () => {
    // Sanity: an arbitrary module clave (not modeled by the seam) is passed as-is.
    const { tx, findFirst } = makeTx({ clave: "UMBRAL_CONSUMO_607", valor: "250000.00" });
    await expect(
      leerConfigActivaEnTx(tx, 9, "UMBRAL_CONSUMO_607", FECHA_CORTE_SD),
    ).resolves.toEqual({ clave: "UMBRAL_CONSUMO_607", valor: "250000.00" });
    expect((findFirst.mock.calls[0][0] as { where: { clave: string } }).where.clave).toBe(
      "UMBRAL_CONSUMO_607",
    );
  });
});

describe("leerConfigsActivasEnTx — the canonical multi-key reader (compra's findMany shape)", () => {
  it("fires ONE findMany with batched `clave in` + the same active-window predicate", async () => {
    const rows = [
      { clave: "RET_ISR_15", valor: "10.00" },
      { clave: "RET_ITBIS_30", valor: "30.00" },
    ];
    const findMany = jest.fn<Promise<typeof rows>, [unknown]>(async () => rows);
    const tx: FakeTxShape = {
      configuracionEmpresa: { findFirst: jest.fn(), findMany },
    };

    const filas = await leerConfigsActivasEnTx(
      tx as never,
      3,
      ["RET_ISR_15", "RET_ISR_2", "RET_ITBIS_100", "RET_ITBIS_30"],
      FECHA_CORTE_SD,
    );

    expect(filas).toEqual(rows);
    expect(findMany).toHaveBeenCalledTimes(1);
    const args = findMany.mock.calls[0][0] as {
      where: {
        empresaId: number;
        clave: { in: string[] };
        activa: boolean;
        vigenciaInicio: { lte: Date };
        vigenciaFin: { gte: Date };
      };
      select: { clave: boolean; valor: boolean };
    };
    expect(args.where.empresaId).toBe(3);
    expect(args.where.clave).toEqual({ in: ["RET_ISR_15", "RET_ISR_2", "RET_ITBIS_100", "RET_ITBIS_30"] });
    expect(args.where.activa).toBe(true);
    expect(args.where.vigenciaInicio.lte).toBe(FECHA_CORTE_SD);
    expect(args.where.vigenciaFin.gte).toBe(FECHA_CORTE_SD);
    expect(args.select).toEqual({ clave: true, valor: true });
  });

  it("returns only the rows the fake serves — no synthesis for missing keys", async () => {
    const tx: FakeTxShape = {
      configuracionEmpresa: {
        findFirst: jest.fn(),
        findMany: jest.fn<
          Promise<Array<{ clave: string; valor: string }>>,
          [unknown]
        >(async () => []),
      },
    };
    await expect(
      leerConfigsActivasEnTx(tx as never, 1, ["DESC_MAX"], FECHA_CORTE_SD),
    ).resolves.toEqual([]);
  });
});
