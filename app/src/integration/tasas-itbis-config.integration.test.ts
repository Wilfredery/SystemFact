/**
 * Integration — `leerTasasItbisEnTx` on real Postgres (RLS on, feature
 * `itbis-tasas-config`): the fixture list, per-empresa isolation, missing row
 * and malformed value. Every test restores what it changed.
 */

import { withTenantTransaction } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import { TasasItbisConfigError } from "@/shared/domain/tasas-itbis";
import { leerTasasItbisEnTx } from "@/shared/infrastructure/tasas-itbis-config";
import { getHarnessDb, seedTenantFixture, type TenantFixture } from "./setup/fixtures";

const AHORA = new Date("2026-06-01T16:00:00.000Z");

let fixture: TenantFixture;
let ctxA: TenantCtx;
let ctxB: TenantCtx;

async function cambiarFila(
  empresaId: number,
  data: { valor?: string; activa?: boolean },
): Promise<void> {
  await getHarnessDb().configuracionEmpresa.updateMany({
    where: { empresaId, clave: "TASA_ITBIS" },
    data,
  });
}

const leer = (ctx: TenantCtx, fecha: Date) =>
  withTenantTransaction(ctx, (tx) => leerTasasItbisEnTx(tx, ctx.empresaId, fecha));

describe("leerTasasItbisEnTx (real DB)", () => {
  beforeEach(async () => {
    fixture = await seedTenantFixture();
    ctxA = {
      empresaId: fixture.empresaA.id,
      sucursalId: fixture.sucursalA1.id,
      usuarioId: fixture.usuarios.adminA.id,
      esAdmin: true,
    };
    ctxB = {
      empresaId: fixture.empresaB.id,
      sucursalId: fixture.sucursalB1.id,
      usuarioId: fixture.usuarios.adminB.id,
      esAdmin: true,
    };
  });

  it("returns the fixture list in config order for empresa A", async () => {
    await expect(leer(ctxA, AHORA)).resolves.toEqual(["18", "16", "0"]);
  });

  it("empresa B reads its own row, independent of A", async () => {
    try {
      await cambiarFila(fixture.empresaB.id, { valor: "18,0" });
      await expect(leer(ctxB, AHORA)).resolves.toEqual(["18", "0"]);
      await expect(leer(ctxA, AHORA)).resolves.toEqual(["18", "16", "0"]);
    } finally {
      await cambiarFila(fixture.empresaB.id, { valor: "18,16,0" });
    }
    await expect(leer(ctxB, AHORA)).resolves.toEqual(["18", "16", "0"]);
  });

  it("throws motivo ausente when no row covers the instant", async () => {
    const antes = new Date("1999-12-31T00:00:00.000Z");
    const err = await leer(ctxA, antes).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TasasItbisConfigError);
    expect(err).toMatchObject({ code: "TASA_ITBIS_CONFIG_FALTANTE", motivo: "ausente" });
  });

  it("throws motivo ausente when the only row is inactive", async () => {
    try {
      await cambiarFila(fixture.empresaB.id, { activa: false });
      const err = await leer(ctxB, AHORA).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(TasasItbisConfigError);
      expect(err).toMatchObject({ motivo: "ausente" });
    } finally {
      await cambiarFila(fixture.empresaB.id, { activa: true });
    }
  });

  it("throws motivo valor_invalido with detalle for a malformed stored value", async () => {
    try {
      await cambiarFila(fixture.empresaB.id, { valor: "18,abc" });
      const err = await leer(ctxB, AHORA).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(TasasItbisConfigError);
      expect(err).toMatchObject({ motivo: "valor_invalido" });
      expect((err as TasasItbisConfigError).detalle).toEqual(expect.any(String));
    } finally {
      await cambiarFila(fixture.empresaB.id, { valor: "18,16,0" });
    }
  });
});
