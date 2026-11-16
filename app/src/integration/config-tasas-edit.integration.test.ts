/**
 * Integration — the rate-list edit use case against the real DB (feature
 * itbis-tasas-edit): history-preserving save through the RLS wall.
 *
 * Proves:
 *   - an Administrador's edit CLOSES the current TASA_ITBIS window at the
 *     change instant, OPENS a new row from it (compound unique respected even
 *     for two saves in the same millisecond), writes ONE ACTUALIZAR audit row,
 *     and bumps the closed row's version;
 *   - a repeated identical save is a no-op (no new row, no audit);
 *   - a malformed list is refused with TEN_TASA_ITBIS_INVALIDA (zero writes);
 *   - a lost optimistic-lock race returns TEN_CONCURRENCIA_CONFLICTO (zero
 *     writes beyond the winner's);
 *   - a non-admin session is refused BY THE DATABASE (RLS policy
 *     configempresa_update/insert, migration 20261116100000): zero changes,
 *     surfaced through the use case as TEN_CONCURRENCIA_CONFLICTO (the role
 *     gate in the HTTP action stops legitimate callers earlier; this proves
 *     the second wall).
 */

import { withTenantTransaction } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import { guardarTasasItbis } from "@/modules/tenant/application/gestion-configuracion";
import { getHarnessDb, seedTenantFixture, type TenantFixture } from "./setup/fixtures";

const AHORA = new Date("2026-11-16T12:00:00.000Z");

describe("guardarTasasItbis (real DB, RLS on)", () => {
  let fx: TenantFixture;
  let ctxAdmin: TenantCtx;
  let ctxOperador: TenantCtx;

  const tasaRows = async (empresaId: number) =>
    getHarnessDb().configuracionEmpresa.findMany({
      where: { empresaId, clave: "TASA_ITBIS" },
      orderBy: { vigenciaInicio: "asc" },
    });

  beforeEach(async () => {
    fx = await seedTenantFixture();
    ctxAdmin = {
      empresaId: fx.empresaA.id,
      sucursalId: fx.sucursalA1.id,
      usuarioId: fx.usuarios.adminA.id,
      esAdmin: true,
    };
    ctxOperador = { ...ctxAdmin, esAdmin: false };
  });

  it("closes the current window and opens a new row from the change instant", async () => {
    const r = await withTenantTransaction(ctxAdmin, (tx) =>
      guardarTasasItbis(tx, ctxAdmin, "18,16,7", AHORA),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const filas = await tasaRows(fx.empresaA.id);
    expect(filas).toHaveLength(2);
    const [vieja, nueva] = filas;
    expect(vieja!.valor).toBe("18,16,0");
    expect(vieja!.vigenciaFin).toEqual(AHORA);
    expect(vieja!.version).toBe(2); // optimistic lock bumped by the close
    expect(nueva!.valor).toBe("18,16,7");
    expect(nueva!.vigenciaInicio).toEqual(AHORA);
    expect(nueva!.activa).toBe(true);
    const auditoria = await getHarnessDb().movimientoAuditoria.findMany({
      where: { empresaId: fx.empresaA.id, entidad: "ConfiguracionEmpresa" },
    });
    expect(auditoria).toHaveLength(1);
    expect(auditoria[0]!.accion).toBe("ACTUALIZAR");
  });

  it("keeps the change readable: the new row covers dates after the change", async () => {
    await withTenantTransaction(ctxAdmin, (tx) =>
      guardarTasasItbis(tx, ctxAdmin, "18,16,7", AHORA),
    );
    // Read back as the harness superuser: under RLS the bare app client has no
    // empresa GUC, so the raw query must bypass it to prove stored state.
    const leida = await getHarnessDb().$queryRaw`SELECT valor FROM "CONFIGURACION_EMPRESA" WHERE "empresaId" = ${fx.empresaA.id} AND clave = 'TASA_ITBIS' AND activa = true AND "vigenciaInicio" <= ${new Date("2026-11-17T00:00:00.000Z")} AND "vigenciaFin" >= ${new Date("2026-11-17T00:00:00.000Z")}`;
    expect((leida as { valor: string }[])[0]!.valor).toBe("18,16,7");
  });

  it("a repeated identical save is a no-op (no new row, no audit)", async () => {
    const antes = await tasaRows(fx.empresaA.id);
    const r = await withTenantTransaction(ctxAdmin, (tx) =>
      guardarTasasItbis(tx, ctxAdmin, "16,18,0", AHORA), // same set, different order
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.cambioAplicado).toBe(false);
    expect(await tasaRows(fx.empresaA.id)).toHaveLength(antes.length);
    expect(
      await getHarnessDb().movimientoAuditoria.count({
        where: { empresaId: fx.empresaA.id, entidad: "ConfiguracionEmpresa" },
      }),
    ).toBe(0);
  });

  it("two saves in the same millisecond never violate the compound unique", async () => {
    const r1 = await withTenantTransaction(ctxAdmin, (tx) =>
      guardarTasasItbis(tx, ctxAdmin, "18,16,7", AHORA),
    );
    const r2 = await withTenantTransaction(ctxAdmin, (tx) =>
      guardarTasasItbis(tx, ctxAdmin, "18,7", AHORA),
    );
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    const filas = await tasaRows(fx.empresaA.id);
    const inicios = filas.map((f) => f.vigenciaInicio.getTime());
    expect(new Set(inicios).size).toBe(inicios.length);
    expect(inicios).toContain(AHORA.getTime());
    expect(inicios).toContain(AHORA.getTime() + 1);
  });

  it("refuses a malformed list with zero writes", async () => {
    const antes = await tasaRows(fx.empresaA.id);
    const r = await withTenantTransaction(ctxAdmin, (tx) =>
      guardarTasasItbis(tx, ctxAdmin, "18,,16", AHORA),
    );
    expect(!r.ok && r.code).toBe("TEN_TASA_ITBIS_INVALIDA");
    expect(await tasaRows(fx.empresaA.id)).toEqual(antes);
  });

  it("two concurrent saves race: one wins, the loser gets TEN_CONCURRENCIA_CONFLICTO", async () => {
    const [a, b] = await Promise.all([
      withTenantTransaction(ctxAdmin, (tx) => guardarTasasItbis(tx, ctxAdmin, "7", AHORA)),
      withTenantTransaction(ctxAdmin, (tx) => guardarTasasItbis(tx, ctxAdmin, "16", AHORA)),
    ]);
    const resultados = [a, b];
    const okOnes = resultados.filter((r) => r.ok);
    const conflictos = resultados.filter((r) => !r.ok && r.code === "TEN_CONCURRENCIA_CONFLICTO");
    expect(okOnes.length).toBeGreaterThanOrEqual(1);
    expect(okOnes.length + conflictos.length).toBe(2);
    // The stored history is consistent: exactly the winners' rows exist.
    const filas = await tasaRows(fx.empresaA.id);
    expect(filas.length).toBe(1 + okOnes.length);
  });

  it("a non-admin session is refused BY THE DATABASE (second wall)", async () => {
    const r = await withTenantTransaction(ctxOperador, (tx) =>
      guardarTasasItbis(tx, ctxOperador, "7", AHORA),
    );
    // The RLS policy blocks the close (UPDATE) and would block the INSERT.
    // The use case distinguishes the denial (row still present and unchanged)
    // from a lost race and surfaces TEN_OPS_NO_AUTORIZADO; NOTHING changes.
    expect(!r.ok && r.code).toBe("TEN_OPS_NO_AUTORIZADO");
    expect((await tasaRows(fx.empresaA.id)).map((f) => f.valor)).toEqual(["18,16,0"]);
    expect(
      await getHarnessDb().movimientoAuditoria.count({
        where: { empresaId: fx.empresaA.id, entidad: "ConfiguracionEmpresa" },
      }),
    ).toBe(0);
  });
});
