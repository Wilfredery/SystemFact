/**
 * ITBIS-in-use reader — query shape with a fake tx (no DB). One groupBy over
 * active products pinned to the empresa; the Decimal stays a string with the
 * stored scale; no per-product loop.
 */

import { Decimal } from "decimal.js";
import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import { leerTasasItbisEnUsoEnTx } from "./administracion-config-repository";

function makeTx(rows: unknown[] = []): PrismaTx {
  return {
    producto: { groupBy: jest.fn().mockResolvedValue(rows) },
  } as unknown as PrismaTx;
}

describe("leerTasasItbisEnUsoEnTx", () => {
  it("issues ONE groupBy over active products of the empresa", async () => {
    const tx = makeTx();

    await leerTasasItbisEnUsoEnTx(tx, 7);

    expect(tx.producto.groupBy).toHaveBeenCalledTimes(1);
    const args = (tx.producto.groupBy as jest.Mock).mock.calls[0][0];
    expect(args.where).toEqual({ empresaId: 7, activo: true });
    expect(args.by).toEqual(["tasaItbis", "itbisVigenteDesde", "itbisVigenteHasta"]);
    expect(args._count).toEqual({ _all: true });
  });

  it("maps groups keeping the Decimal as a fixed-scale string (never a number)", async () => {
    const desde = new Date("2026-01-01T04:00:00.000Z");
    const tx = makeTx([
      {
        tasaItbis: new Decimal("18"),
        itbisVigenteDesde: desde,
        itbisVigenteHasta: null,
        _count: { _all: 4 },
      },
      {
        tasaItbis: new Decimal("0.5"),
        itbisVigenteDesde: desde,
        itbisVigenteHasta: desde,
        _count: { _all: 1 },
      },
    ]);

    const r = await leerTasasItbisEnUsoEnTx(tx, 7);

    expect(r).toEqual([
      { tasaItbis: "18.00", vigenteDesde: desde, vigenteHasta: null, productos: 4 },
      { tasaItbis: "0.50", vigenteDesde: desde, vigenteHasta: desde, productos: 1 },
    ]);
  });

  it("returns an empty list when the empresa has no active products", async () => {
    expect(await leerTasasItbisEnUsoEnTx(makeTx([]), 7)).toEqual([]);
  });
});
