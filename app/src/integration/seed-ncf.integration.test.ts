/**
 * Integration — `pnpm seed:ncf` provisioning (spec R-N6, fase-5c task 4.1)
 * against the REAL `systemfact_test` database.
 *
 * Requires the `sf-postgres` container on :5433 (blocked-environment otherwise).
 * Proves the R-N6 scenario end-to-end: a fresh empresa gets active, INDEPENDENT
 * B01/B02 ranges whose values are `%08d`-consistent (deviation-3 reconciliation:
 * the authoritative R-N2 composition is 11 chars — a 9-digit range could never
 * be composed), the re-run is idempotent without ever rewinding a consumed
 * counter, a conflicting real range fails fast, and a seeded range is directly
 * consumable by the engine producing exactly the composed NCF.
 */

import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import { withTenantTransaction } from "@/modules/tenant/infrastructure/withTenantTransaction";
import { consumirNcfEnTx } from "@/modules/ncf/application/consumir-ncf";
import {
  seedNcfParaEmpresa,
  NCF_RANGOS_SEED,
  NCF_MAX_CONSECUTIVO,
} from "../../tools/scripts/seed-ncf";
import { getHarnessDb, seedTenantFixture, type TenantFixture } from "./setup/fixtures";

let fixture: TenantFixture | null = null;

/** Empresa-B admin context: the seed's per-empresa target under test. */
function ctxB(f: TenantFixture): TenantCtx {
  return {
    empresaId: f.empresaB.id,
    sucursalId: f.sucursalB1.id,
    usuarioId: f.usuarios.adminB.id,
    esAdmin: true,
  };
}

async function filasB(empresaId: number) {
  return getHarnessDb().ncfSecuencia.findMany({
    where: { empresaId },
    orderBy: { tipoNcf: "asc" },
  });
}

describe("seed-ncf (real DB, R-N6)", () => {
  beforeEach(async () => {
    fixture = await seedTenantFixture();
  });

  it("provisions active, independent B01 and B02 rows for a fresh empresa", async () => {
    const f = fixture!;
    // Fresh tenant: the base fixture seeds no NCF rows at all.
    expect(await getHarnessDb().ncfSecuencia.count({ where: { empresaId: f.empresaB.id } })).toBe(0);

    await seedNcfParaEmpresa(getHarnessDb(), f.empresaB.id);

    const filas = await filasB(f.empresaB.id);
    expect(filas.map((r) => r.tipoNcf)).toEqual(["B01", "B02"]);
    for (const fila of filas) {
      expect(fila.activa).toBe(true);
      // D7: nothing consumed at provisioning time.
      expect(fila.secuenciaActual).toBe(fila.rangoInicio - 1);
      // %08d-consistent (never 9-digit): both bounds inside the composition space.
      expect(fila.rangoInicio).toBeGreaterThanOrEqual(1);
      expect(fila.rangoFin).toBeLessThanOrEqual(NCF_MAX_CONSECUTIVO);
      // Vigencia through the end of the running year (SD expiry semantics).
      expect(fila.vigenciaFin.getUTCFullYear()).toBe(new Date().getUTCFullYear());
    }
    // Independent: the planned numeric ranges are disjoint.
    const [b01, b02] = filas;
    expect(b01.rangoFin < b02.rangoInicio || b02.rangoFin < b01.rangoInicio).toBe(true);
    expect(NCF_RANGOS_SEED).toHaveLength(2);
  });

  it("seed → consume yields the composed 11-char NCF, and a re-run neither duplicates nor rewinds the counter", async () => {
    const f = fixture!;
    const db = getHarnessDb();
    await seedNcfParaEmpresa(db, f.empresaB.id);

    // Consume B02 through the real engine port inside a tenant transaction.
    const ctx = ctxB(f);
    const { ncf, secuencial } = await withTenantTransaction(ctx, (tx) =>
      consumirNcfEnTx(tx, ctx, "B02"),
    );
    const filaB02 = NCF_RANGOS_SEED.find((r) => r.tipoNcf === "B02")!;
    expect(secuencial).toBe(filaB02.rangoInicio);
    expect(ncf).toBe(`B02${String(secuencial).padStart(8, "0")}`);
    expect(ncf).toHaveLength(11);

    // Re-run the seed: same two rows, advanced counter preserved.
    await seedNcfParaEmpresa(db, f.empresaB.id);
    await seedNcfParaEmpresa(db, f.empresaB.id);
    const despues = await filasB(f.empresaB.id);
    expect(despues).toHaveLength(2);
    const b02 = despues.find((r) => r.tipoNcf === "B02")!;
    expect(b02.secuenciaActual).toBe(filaB02.rangoInicio); // NOT rewound (consumed stays consumed)
    expect(b02.activa).toBe(true);
  });

  it("FAILS FAST when the same-key row holds a different (real DGII) range", async () => {
    const f = fixture!;
    const db = getHarnessDb();
    await seedNcfParaEmpresa(db, f.empresaB.id);
    // Simulate a real authorized range assigned after provisioning.
    await db.ncfSecuencia.update({
      where: { empresaId_tipoNcf: { empresaId: f.empresaB.id, tipoNcf: "B01" } },
      data: { rangoInicio: 500000, rangoFin: 599999 },
    });

    await expect(seedNcfParaEmpresa(db, f.empresaB.id)).rejects.toThrow(/overlap/i);
    // The untouched B02 keeps its planned range (fail-fast before any write).
    const b02 = (await filasB(f.empresaB.id)).find((r) => r.tipoNcf === "B02")!;
    expect(b02.rangoInicio).toBe(NCF_RANGOS_SEED.find((r) => r.tipoNcf === "B02")!.rangoInicio);
  });
});
