/**
 * Integration tests — concurrency of the manual stock adjustment.
 *
 * Two concurrent `withTenantTransaction` calls race on the same inventory row.
 * The repository serializes them with `SELECT ... FOR UPDATE` under
 * ReadCommitted: the winner commits; the loser re-reads the committed quantity
 * and rejects with STOCK_INSUFICIENTE. Observed behavior matches that model —
 * the loser's promise RESOLVES with `{ ok: false, code: "STOCK_INSUFICIENTE" }`
 * (ajustarInventario converts the typed domain error into a result), so the
 * invariants asserted are: stock never negative, exactly one movement.
 */

import { withTenantTransaction } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import { ajustarInventario } from "@/modules/inventario/application/ajustar-inventario";
import { getHarnessDb, seedTenantFixture, type TenantFixture } from "./setup/fixtures";

describe("concurrent adjustments (real DB)", () => {
  let fixture: TenantFixture;
  let ctx: TenantCtx;

  beforeEach(async () => {
    fixture = await seedTenantFixture();
    ctx = {
      empresaId: fixture.empresaA.id,
      sucursalId: fixture.sucursalA1.id,
      usuarioId: fixture.usuarios.adminA.id,
      esAdmin: true,
    };
  });

  it("serializes two concurrent -8 deltas on 10.000 stock: one wins, stock stays non-negative", async () => {
    const attempts = [0, 1].map(() =>
      withTenantTransaction(ctx, (tx) =>
        ajustarInventario(tx, ctx, {
          productoId: fixture.productos.prodA1.id,
          cantidad: "-8",
          motivo: "Salida concurrente",
        }),
      ),
    );

    const settled = await Promise.allSettled(attempts);

    // Neither call may reject: business rejections come back as typed results.
    for (const outcome of settled) {
      expect(outcome.status).toBe("fulfilled");
    }
    const results = settled.map(
      (outcome) =>
        outcome as PromiseFulfilledResult<
          { ok: true; data: unknown } | { ok: false; code: string; message: string }
        >,
    );

    const successes = results.filter((r) => r.value.ok === true);
    const rejections = results.filter((r) => r.value.ok === false && r.value.code === "STOCK_INSUFICIENTE");
    expect(successes).toHaveLength(1);
    expect(rejections).toHaveLength(1);

    const db = getHarnessDb();
    const inventario = await db.inventario.findUnique({
      where: { id: fixture.inventarios.a1ProdA1.id },
    });
    // 10.000 - 8.000 = 2.000: never -6.000, never null.
    expect(inventario).not.toBeNull();
    expect(inventario?.cantidad.toFixed(3)).toBe("2.000");

    const movimientos = await db.movimientoInventario.findMany({
      where: { inventarioId: fixture.inventarios.a1ProdA1.id },
    });
    expect(movimientos).toHaveLength(1);
    expect(movimientos[0]?.cantidadMovida.toFixed(3)).toBe("-8.000");
    expect(movimientos[0]?.cantidadNueva.toFixed(3)).toBe("2.000");
  });
});
