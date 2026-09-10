/**
 * Integration — atomic single-NCF consumption against the REAL test DB
 * (RLS on, app role via `withTenantTransaction`), Phase 1 / pr5c1.
 *
 * Covers R-N1 (single/missing/concurrent consume), R-N4 (exhaustion) and R-N5
 * (SD-day expiry) at the repository boundary, plus R-N3 warning surfacing
 * out-of-band on a successful consume. Mirrors `compra-concurrency.integration
 * .test.ts` for the concurrency fixture style.
 *
 * LOCATION NOTE: the tasks name `.../infrastructure/__tests__/ncf-consume.spec
 * .ts`, but the project's only real-DB harness is `jest.integration.config.js`,
 * which matches files under `src/integration/` named `*.test.ts` (it loads
 * `.env.integration`, uses the superuser harness client, truncates per test and
 * runs in band). A `.spec.ts` under the module tree would instead be collected
 * by the *unit* config (`pnpm test`), which has no DB setup, and would fail.
 * The DB-backed cases therefore live in `src/integration/` — where
 * `compra-concurrency` lives too — and run via `pnpm test:integration`.
 */

import { withTenantTransaction } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import {
  consumirNcfEnTx,
  NcfConsumoError,
  type NcfConsumoErrorCode,
} from "@/modules/ncf/application/consumir-ncf";
import { NCF_UMBRAL_90 } from "@/modules/ncf/domain/ncf-rules";
import { getHarnessDb, seedTenantFixture, type TenantFixture } from "./setup/fixtures";

const VIGENCIA_INICIO = new Date("2000-01-01T00:00:00.000Z");
const VIGENCIA_FIN_VIGENTE = new Date("2099-12-31T23:59:59.000Z");

interface Semilla {
  readonly rangoInicio: number;
  readonly rangoFin: number;
  readonly secuenciaActual: number;
  readonly activa?: boolean;
  readonly vigenciaFin?: Date;
}

async function sembrarRango(
  empresaId: number,
  tipo: "B01" | "B02",
  s: Semilla,
): Promise<void> {
  const db = getHarnessDb();
  await db.ncfSecuencia.create({
    data: {
      empresaId,
      tipoNcf: tipo,
      rangoInicio: s.rangoInicio,
      rangoFin: s.rangoFin,
      secuenciaActual: s.secuenciaActual,
      vigenciaInicio: VIGENCIA_INICIO,
      vigenciaFin: s.vigenciaFin ?? VIGENCIA_FIN_VIGENTE,
      activa: s.activa ?? true,
    },
  });
}

async function leerSecuencia(empresaId: number, tipo: "B01" | "B02"): Promise<number> {
  const db = getHarnessDb();
  const row = await db.ncfSecuencia.findUnique({
    where: { empresaId_tipoNcf: { empresaId, tipoNcf: tipo } },
  });
  return row?.secuenciaActual ?? -1;
}

/** Consume once inside a fresh tenant transaction; returns the port result. */
const consumirUnaVez = (ctx: TenantCtx, tipo: "B01" | "B02") =>
  withTenantTransaction(ctx, (tx) => consumirNcfEnTx(tx, ctx, tipo));

describe("ncf consume (real DB, RLS on)", () => {
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

  it("single consume advances the last-used counter and returns the composed NCF (R-N1)", async () => {
    await sembrarRango(ctx.empresaId, "B02", {
      rangoInicio: 500,
      rangoFin: 1000,
      secuenciaActual: 521,
    });

    const r = await consumirUnaVez(ctx, "B02");

    expect(r.ncf).toBe("B0200000522");
    expect(r.tipo).toBe("B02");
    expect(r.secuencial).toBe(522);
    expect(r.warning).toBeUndefined();
    expect(await leerSecuencia(ctx.empresaId, "B02")).toBe(522);
  });

  it("missing active sequence hard-fails NCF_SEC_INEXISTENTE with zero writes (R-N1)", async () => {
    // No row seeded for B01 at all.
    await expect(consumirUnaVez(ctx, "B01")).rejects.toMatchObject({
      code: "NCF_SEC_INEXISTENTE",
    });
    expect(await leerSecuencia(ctx.empresaId, "B01")).toBe(-1); // still absent
    expect(await getHarnessDb().ncfSecuencia.count()).toBe(0);
  });

  it("inactive sequence row is treated as missing (filter activa=true)", async () => {
    await sembrarRango(ctx.empresaId, "B02", {
      rangoInicio: 500,
      rangoFin: 1000,
      secuenciaActual: 521,
      activa: false,
    });
    await expect(consumirUnaVez(ctx, "B02")).rejects.toMatchObject({
      code: "NCF_SEC_INEXISTENTE",
    });
    // The inactive row is untouched: last-used stays at 521.
    expect(await leerSecuencia(ctx.empresaId, "B02")).toBe(521);
  });

  it("exhausted range blocks with NCF_AGOTADA and advances nothing (R-N4)", async () => {
    await sembrarRango(ctx.empresaId, "B02", {
      rangoInicio: 500,
      rangoFin: 1000,
      secuenciaActual: 1000,
    });
    await expect(consumirUnaVez(ctx, "B02")).rejects.toMatchObject({
      code: "NCF_AGOTADA",
    });
    expect(await leerSecuencia(ctx.empresaId, "B02")).toBe(1000);
  });

  it("expired range (day after, SD) blocks with NCF_VENCIDA and advances nothing (R-N5)", async () => {
    await sembrarRango(ctx.empresaId, "B02", {
      rangoInicio: 500,
      rangoFin: 1000,
      secuenciaActual: 521,
      vigenciaFin: new Date("2020-01-01T00:00:00.000Z"), // SD 2019-12-31, far in the past (no boundary flakiness)
    });
    await expect(consumirUnaVez(ctx, "B02")).rejects.toMatchObject({
      code: "NCF_VENCIDA",
    });
    expect(await leerSecuencia(ctx.empresaId, "B02")).toBe(521);
  });

  it("surfaces the 90% threshold as an out-of-band warning without failing (R-N3)", async () => {
    await sembrarRango(ctx.empresaId, "B02", {
      rangoInicio: 500,
      rangoFin: 1000,
      secuenciaActual: 949,
    });
    const r = await consumirUnaVez(ctx, "B02");
    expect(r.secuencial).toBe(950); // consumed normally
    expect(r.warning).toBe(NCF_UMBRAL_90); // warning attached, not an error
    expect(await leerSecuencia(ctx.empresaId, "B02")).toBe(950);
  });

  it("concurrent consumes serialize to distinct sequentials (R-N1)", async () => {
    await sembrarRango(ctx.empresaId, "B02", {
      rangoInicio: 500,
      rangoFin: 1000,
      secuenciaActual: 521,
    });

    const [ra, rb] = await Promise.all([
      consumirUnaVez(ctx, "B02"),
      consumirUnaVez(ctx, "B02"),
    ]);

    const sequenciales = [ra.secuencial, rb.secuencial].sort((a, b) => a - b);
    expect(sequenciales).toEqual([522, 523]);
    expect(new Set([ra.ncf, rb.ncf]).size).toBe(2);
    // @@unique([empresaId,tipoNcf]) never violated → exactly one row, at 523.
    expect(await leerSecuencia(ctx.empresaId, "B02")).toBe(523);
    expect(await getHarnessDb().ncfSecuencia.count({ where: { empresaId: ctx.empresaId } })).toBe(1);
  });

  it("an aborted transaction burns nothing (R-N1 — retry safety)", async () => {
    await sembrarRango(ctx.empresaId, "B02", {
      rangoInicio: 500,
      rangoFin: 1000,
      secuenciaActual: 521,
    });

    await expect(
      withTenantTransaction(ctx, async (tx) => {
        await consumirNcfEnTx(tx, ctx, "B02");
        throw new Error("boom after consume");
      }),
    ).rejects.toThrow("boom after consume");

    // Rollback restored the counter — nothing was burned.
    expect(await leerSecuencia(ctx.empresaId, "B02")).toBe(521);
  });

  it("typed error exposes a stable code with no Prisma internals leaked", async () => {
    await expect(consumirUnaVez(ctx, "B02")).rejects.toBeInstanceOf(NcfConsumoError);
    let code: NcfConsumoErrorCode | undefined;
    try {
      await consumirUnaVez(ctx, "B02");
    } catch (e) {
      expect(e).toBeInstanceOf(NcfConsumoError);
      code = (e as NcfConsumoError).code;
      // No Prisma error object / stack leak on the thrown domain error.
      expect((e as NcfConsumoError).name).toBe("NcfConsumoError");
    }
    expect(code).toBe("NCF_SEC_INEXISTENTE");
  });
});
