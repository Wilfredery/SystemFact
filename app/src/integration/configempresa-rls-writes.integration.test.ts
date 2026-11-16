/**
 * Integration — role-aware RLS on CONFIGURACION_EMPRESA (real DB, app role).
 *
 * Migration `20261116100000_configempresa_writes_admin_only` (odd/tasks/
 * itbis-tasas-edit.md S4): INSERT/UPDATE need `app.current_es_admin = 'true'`
 * plus the empresa match, DELETE is bootstrap only, SELECT is unchanged
 * (empresa-scoped). The table carries the fiscal TASA_ITBIS parameter, so the
 * database is the second, independent wall behind the application role gate.
 *
 * Everything under test runs through `@/lib/prisma` (least-privilege
 * `systemfact_app`, FORCE RLS). The harness superuser client only seeds and
 * reads back stored data, so every "refused" assertion also proves that the
 * stored rows are unchanged.
 */

import { withTenantTransaction } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import { getHarnessDb, seedTenantFixture, type TenantFixture } from "./setup/fixtures";

const RLS_VIOLATION = /row-level security|violates|policy/i;

describe("CONFIGURACION_EMPRESA role-aware RLS (real DB)", () => {
  let fx: TenantFixture;
  let ctxAdmin: TenantCtx;
  let ctxOperador: TenantCtx;

  const fila = (empresaId: number, clave: string, valor: string) => ({
    empresaId,
    clave,
    valor,
    vigenciaInicio: new Date("2026-01-01T00:00:00.000Z"),
    vigenciaFin: new Date("2099-12-31T23:59:59.000Z"),
    activa: true,
  });
  // The fixture seeds several config rows; the tests pin the TASA_ITBIS row.
  const configDe = async (empresaId: number) =>
    getHarnessDb().configuracionEmpresa.findMany({
      where: { empresaId, clave: "TASA_ITBIS" },
      orderBy: { id: "asc" },
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

  // ── Administrador ─────────────────────────────────────────────────────
  describe("Administrador (esAdmin: true)", () => {
    it("INSERTs a config row of its own empresa", async () => {
      const creada = await withTenantTransaction(ctxAdmin, (tx) =>
        tx.configuracionEmpresa.create({
          data: fila(fx.empresaA.id, "TASA_ITBIS", "18,16,0"),
        }),
      );
      const stored = await getHarnessDb().configuracionEmpresa.findUniqueOrThrow({
        where: { id: creada.id },
      });
      expect(stored.empresaId).toBe(fx.empresaA.id);
      expect(stored.valor).toBe("18,16,0");
    });

    it("UPDATEs (closes the window of) a row of its own empresa", async () => {
      const [filaTasa] = await configDe(fx.empresaA.id);
      const res = await withTenantTransaction(ctxAdmin, (tx) =>
        tx.configuracionEmpresa.updateMany({
          where: { id: filaTasa!.id, empresaId: fx.empresaA.id },
          data: { vigenciaFin: new Date("2026-11-16T23:59:59.000Z") },
        }),
      );
      expect(res.count).toBe(1);
      const stored = await getHarnessDb().configuracionEmpresa.findUniqueOrThrow({
        where: { id: filaTasa!.id },
      });
      expect(stored.vigenciaFin).toEqual(new Date("2026-11-16T23:59:59.000Z"));
    });

    it("DELETE is refused (zero rows) and the row stays", async () => {
      const [filaTasa] = await configDe(fx.empresaA.id);
      const res = await withTenantTransaction(ctxAdmin, (tx) =>
        tx.configuracionEmpresa.deleteMany({ where: { id: filaTasa!.id } }),
      );
      expect(res.count).toBe(0);
      expect(await getHarnessDb().configuracionEmpresa.count({ where: { id: filaTasa!.id } })).toBe(1);
    });
  });

  // ── Operador ──────────────────────────────────────────────────────────
  describe("Operador (esAdmin: false) is refused by the database", () => {
    it("INSERT raises an RLS violation and stores nothing", async () => {
      const before = await getHarnessDb().configuracionEmpresa.count();
      await expect(
        withTenantTransaction(ctxOperador, (tx) =>
          tx.configuracionEmpresa.create({
            data: fila(fx.empresaA.id, "TASA_ITBIS", "7"),
          }),
        ),
      ).rejects.toThrow(RLS_VIOLATION);
      expect(await getHarnessDb().configuracionEmpresa.count()).toBe(before);
    });

    it("UPDATE touches zero rows and the stored row is unchanged", async () => {
      const [filaTasa] = await configDe(fx.empresaA.id);
      const res = await withTenantTransaction(ctxOperador, (tx) =>
        tx.configuracionEmpresa.updateMany({
          where: { id: filaTasa!.id },
          data: { valor: "7" },
        }),
      );
      expect(res.count).toBe(0);
      const stored = await getHarnessDb().configuracionEmpresa.findUniqueOrThrow({
        where: { id: filaTasa!.id },
      });
      expect(stored.valor).toBe("18,16,0");
    });

    it("DELETE touches zero rows and the row stays", async () => {
      const [filaTasa] = await configDe(fx.empresaA.id);
      const res = await withTenantTransaction(ctxOperador, (tx) =>
        tx.configuracionEmpresa.deleteMany({ where: { id: filaTasa!.id } }),
      );
      expect(res.count).toBe(0);
      expect(await getHarnessDb().configuracionEmpresa.count({ where: { id: filaTasa!.id } })).toBe(1);
    });
  });

  // ── Cross-empresa ─────────────────────────────────────────────────────
  describe("cross-empresa: admin of A vs empresa B", () => {
    it("cannot INSERT a config row into B", async () => {
      const before = await getHarnessDb().configuracionEmpresa.count({
        where: { empresaId: fx.empresaB.id },
      });
      await expect(
        withTenantTransaction(ctxAdmin, (tx) =>
          tx.configuracionEmpresa.create({
            data: fila(fx.empresaB.id, "TASA_ITBIS", "18,16,0"),
          }),
        ),
      ).rejects.toThrow(RLS_VIOLATION);
      expect(
        await getHarnessDb().configuracionEmpresa.count({ where: { empresaId: fx.empresaB.id } }),
      ).toBe(before);
    });

    it("cannot UPDATE B's rows (zero rows touched)", async () => {
      const [filaB] = (await getHarnessDb().configuracionEmpresa.findMany({
        where: { empresaId: fx.empresaB.id, clave: "TASA_ITBIS" },
      })) ?? [];
      const res = await withTenantTransaction(ctxAdmin, (tx) =>
        tx.configuracionEmpresa.updateMany({
          where: { id: filaB!.id },
          data: { valor: "7" },
        }),
      );
      expect(res.count).toBe(0);
      const stored = await getHarnessDb().configuracionEmpresa.findUniqueOrThrow({
        where: { id: filaB!.id },
      });
      expect(stored.valor).toBe("18,16,0");
    });

    it("still READS only its own empresa rows", async () => {
      const leidas = await withTenantTransaction(ctxAdmin, (tx) =>
        tx.configuracionEmpresa.findMany({ where: { clave: "TASA_ITBIS" } }),
      );
      expect(leidas).toHaveLength(1);
      expect(leidas[0]!.empresaId).toBe(fx.empresaA.id);
    });
  });
});
