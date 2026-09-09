/**
 * Integration — production retention-config seed (fase-3-4b task 1.6, capability
 * `retencion-config-seeding`) against the REAL `systemfact_test` database.
 *
 * Requires the `sf-postgres` container on :5433 (blocked-environment otherwise).
 *
 * The base fixture seeds empresa A's four `RET_*` keys but leaves empresa B
 * unseeded, which mirrors the production gap: an unseeded tenant cannot confirm
 * or receive. These tests prove (a) a fresh tenant is blocked before the seed
 * and works after, (b) the seed is idempotent (one active row per key), and
 * (c) the fixtures' retention VALUES are unchanged by the seed (same window).
 */

import { withTenantTransaction } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import { leerTasasRetencionEnTx } from "@/modules/compra/infrastructure/configuracion-repository";
import {
  seedRetencionConfig,
  seedRetencionConfigParaEmpresa,
  RETENCION_SEED_VALORES,
} from "../../tools/scripts/seed-retencion-config";
import {
  getHarnessDb,
  seedTenantFixture,
  type TenantFixture,
} from "./setup/fixtures";

const CLAVES = Object.keys(RETENCION_SEED_VALORES) as (keyof typeof RETENCION_SEED_VALORES)[];

function ctxForEmpresaB(fixture: TenantFixture): TenantCtx {
  return {
    empresaId: fixture.empresaB.id,
    sucursalId: fixture.sucursalB1.id,
    usuarioId: fixture.usuarios.adminB.id,
    esAdmin: true,
  };
}

describe("seed-retencion-config (real DB)", () => {
  let fixture: TenantFixture;

  beforeEach(async () => {
    fixture = await seedTenantFixture();
  });

  it("an unseeded tenant has no RET_ITBIS_100, so the reader blocks it (confirm/receipt unreachable)", async () => {
    const ctx = ctxForEmpresaB(fixture);
    await expect(
      withTenantTransaction(ctx, (tx) =>
        leerTasasRetencionEnTx(tx, ctx.empresaId, ["RET_ITBIS_100"]),
      ),
    ).rejects.toMatchObject({ code: "CONFIG_RETENCION_FALTANTE" });
  });

  it("after the seed, the previously-unseeded tenant's config reads succeed", async () => {
    const db = getHarnessDb();
    await seedRetencionConfigParaEmpresa(db, fixture.empresaB.id);

    const ctx = ctxForEmpresaB(fixture);
    const rates = await withTenantTransaction(ctx, (tx) =>
      leerTasasRetencionEnTx(tx, ctx.empresaId, ["RET_ITBIS_100", "RET_ISR_15"]),
    );
    // Percent-form values, config-driven from the seeded rows (no fallback).
    expect(rates.itbis100).toBe("100");
    expect(rates.isr15).toBe("15");
  });

  it("seed re-run is idempotent: one active row per (empresa, clave), no duplicates", async () => {
    const db = getHarnessDb();
    await seedRetencionConfig(db);
    await seedRetencionConfig(db); // second run must not duplicate

    for (const empresaId of [fixture.empresaA.id, fixture.empresaB.id]) {
      for (const clave of CLAVES) {
        const activas = await db.configuracionEmpresa.count({
          where: { empresaId, clave, activa: true },
        });
        expect(activas).toBe(1);
      }
    }
  });

  it("the seed leaves the fixture's existing retention values in place (no dup, same window)", async () => {
    const db = getHarnessDb();
    // empresa A already carries the four canonical-window keys from the fixture.
    await seedRetencionConfigParaEmpresa(db, fixture.empresaA.id);

    const rows = await db.configuracionEmpresa.findMany({
      where: { empresaId: fixture.empresaA.id, clave: "RET_ISR_15" },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].valor).toBe("15");
    expect(rows[0].activa).toBe(true);
  });
});
