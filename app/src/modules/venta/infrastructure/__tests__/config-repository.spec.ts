/**
 * Unit — venta-config readers (spec R-V17, fase-5c task 4.3; F5 audit v2r-11).
 *
 * No DB: the readers are exercised against a structural fake of the Prisma tx so
 * the DETERMINISTIC RESOLUTION is pinned at the query level — with two active
 * rows whose validity windows overlap, the read MUST ask for
 * `orderBy: vigenciaInicio desc` so the newest window wins (CodeRabbit F5).
 * The real-DB behavior (latest row actually returned) is proven in
 * `src/integration/venta-config.integration.test.ts`.
 *
 * The second block covers `leerRetroactivoFechaVentaEnTx`, the sale-date-band
 * horizon added by the F5 remediation, including its GRAMMAR DELTA vs
 * `PLAZO_DEVOLUCION`: `0` is legal there (only today may be recorded) whereas
 * the return window demands a strictly positive day count.
 */

import {
  leerConfigVentaEnTx,
  leerPlazoDevolucionEnTx,
  leerRetroactivoFechaVentaEnTx,
  VentaConfigError,
  DESC_MAX_FALTANTE,
  PLAZO_DEVOLUCION_FALTANTE,
  RETROACTIVO_FECHA_VENTA_FALTANTE,
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

  it("PLAZO_DEVOLUCION: a zero window is REJECTED (strictly positive days)", async () => {
    const { tx } = makeTx({ valor: "0" });
    await expect(leerPlazoDevolucionEnTx(tx, 1, FECHA_VENTA)).rejects.toMatchObject({
      code: PLAZO_DEVOLUCION_FALTANTE,
      details: { motivo: "valor_no_entero_positivo" },
    });
  });
});

describe("leerRetroactivoFechaVentaEnTx (F5 sale-date band horizon)", () => {
  it("reads the RETROACTIVO_FECHA_VENTA_DIAS row with the R-V17 deterministic tie-break", async () => {
    const { tx, findFirst } = makeTx({ valor: "7" });
    const horizonte = await leerRetroactivoFechaVentaEnTx(tx, 7, FECHA_VENTA);

    expect(horizonte).toBe(7);
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
    };
    // Tenant + key + active + covering-window predicates stay in place.
    expect(args.where.empresaId).toBe(7);
    expect(args.where.clave).toBe("RETROACTIVO_FECHA_VENTA_DIAS");
    expect(args.where.activa).toBe(true);
    expect(args.where.vigenciaInicio.lte).toBe(FECHA_VENTA);
    expect(args.where.vigenciaFin.gte).toBe(FECHA_VENTA);
    // Newest vigenciaInicio first, exactly like DESC_MAX / PLAZO_DEVOLUCION.
    expect(args.orderBy).toEqual({ vigenciaInicio: "desc" });
  });

  it("accepts the business-confirmed default and trims surrounding whitespace", async () => {
    const { tx } = makeTx({ valor: " 7 " });
    await expect(leerRetroactivoFechaVentaEnTx(tx, 1, FECHA_VENTA)).resolves.toBe(7);
  });

  it("accepts 0 — a strictly stricter tenant than PLAZO_DEVOLUCION allows", async () => {
    const { tx } = makeTx({ valor: "0" });
    await expect(leerRetroactivoFechaVentaEnTx(tx, 1, FECHA_VENTA)).resolves.toBe(0);
  });

  it("hard-fails RETROACTIVO_FECHA_VENTA_FALTANTE with zero rows found", async () => {
    const { tx } = makeTx(null);
    await expect(leerRetroactivoFechaVentaEnTx(tx, 1, FECHA_VENTA)).rejects.toMatchObject({
      code: RETROACTIVO_FECHA_VENTA_FALTANTE,
    });
  });

  it.each([
    ["non-numeric", "siete"],
    ["negative", "-1"],
    ["over-long (4 digits)", "1000"],
    ["fractional", "7.5"],
    ["empty", ""],
  ])("rejects a %s stored value with the same code + motivo", async (_caso, valor) => {
    const { tx } = makeTx({ valor });
    await expect(leerRetroactivoFechaVentaEnTx(tx, 1, FECHA_VENTA)).rejects.toMatchObject({
      code: RETROACTIVO_FECHA_VENTA_FALTANTE,
      details: { motivo: "valor_no_entero_no_negativo" },
    });
  });

  it("never leaks a legal-default: the throw is a VentaConfigError with Spanish copy", async () => {
    const { tx } = makeTx(null);
    await expect(leerRetroactivoFechaVentaEnTx(tx, 1, FECHA_VENTA)).rejects.toBeInstanceOf(
      VentaConfigError,
    );
    await expect(leerRetroactivoFechaVentaEnTx(tx, 1, FECHA_VENTA)).rejects.toThrow(
      /RETROACTIVO_FECHA_VENTA_DIAS/,
    );
  });
});
