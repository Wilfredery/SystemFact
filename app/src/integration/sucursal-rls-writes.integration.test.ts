/**
 * Integration — role-aware RLS, version and unique name on SUCURSAL (real DB, app role).
 *
 * Migration `20261115120000_sucursal_writes_admin_only` (odd/tasks/
 * administracion-sucursales-crear-editar.md S2, S10): INSERT/UPDATE need
 * `app.current_es_admin = 'true'` plus the empresa match, DELETE is bootstrap
 * only, SELECT is unchanged, and the functional unique index
 * `(empresaId, lower(btrim(nombre)))` refuses duplicate branch names.
 *
 * Everything under test runs through `@/lib/prisma` (least-privilege
 * `systemfact_app`, FORCE RLS). The harness superuser client only seeds and
 * reads back stored data, so every "refused" assertion also proves that the
 * stored rows are unchanged.
 */

import { prisma } from "@/lib/prisma";
import { withTenantTransaction } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import { getHarnessDb, seedTenantFixture, type TenantFixture } from "./setup/fixtures";

const RLS_VIOLATION = /row-level security|violates|policy/i;
const UNIQUE_VIOLATION = /unique constraint|duplicate key|SUCURSAL_empresaId_nombre_lower_key/i;

describe("SUCURSAL role-aware RLS, version and unique name (real DB)", () => {
  let fx: TenantFixture;
  let ctxAdmin: TenantCtx;
  let ctxOperador: TenantCtx;

  const datos = (empresaId: number, nombre: string) => ({
    empresaId,
    nombre,
    direccion: "Calle 1",
    telefono: "8095550000",
  });
  const sucursalesDe = async (empresaId: number) =>
    getHarnessDb().sucursal.findMany({ where: { empresaId }, orderBy: { id: "asc" } });

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
    it("INSERTs a branch of its own empresa, active, with version 1", async () => {
      const creada = await withTenantTransaction(ctxAdmin, (tx) =>
        tx.sucursal.create({ data: datos(fx.empresaA.id, "Nueva") }),
      );
      const stored = await getHarnessDb().sucursal.findUniqueOrThrow({ where: { id: creada.id } });
      expect(stored.empresaId).toBe(fx.empresaA.id);
      expect(stored.activa).toBe(true);
      expect(stored.version).toBe(1);
    });

    it("UPDATEs a branch of its own empresa", async () => {
      const res = await withTenantTransaction(ctxAdmin, (tx) =>
        tx.sucursal.updateMany({
          where: { id: fx.sucursalA2.id, empresaId: fx.empresaA.id },
          data: { nombre: "A2 renombrada", version: { increment: 1 } },
        }),
      );
      expect(res.count).toBe(1);
      const stored = await getHarnessDb().sucursal.findUniqueOrThrow({ where: { id: fx.sucursalA2.id } });
      expect(stored.nombre).toBe("A2 renombrada");
      expect(stored.version).toBe(2);
    });

    it("DELETE is refused (zero rows) and the branch stays", async () => {
      const res = await withTenantTransaction(ctxAdmin, (tx) =>
        tx.sucursal.deleteMany({ where: { id: fx.sucursalA2.id } }),
      );
      expect(res.count).toBe(0);
      expect(await getHarnessDb().sucursal.count({ where: { id: fx.sucursalA2.id } })).toBe(1);
    });
  });

  // ── Operador ──────────────────────────────────────────────────────────
  describe("Operador (esAdmin: false) is refused by the database", () => {
    it("INSERT raises an RLS violation and stores nothing", async () => {
      const before = await getHarnessDb().sucursal.count();
      await expect(
        withTenantTransaction(ctxOperador, (tx) =>
          tx.sucursal.create({ data: datos(fx.empresaA.id, "Intrusa") }),
        ),
      ).rejects.toThrow(RLS_VIOLATION);
      expect(await getHarnessDb().sucursal.count()).toBe(before);
    });

    it("UPDATE touches zero rows and the stored branch is unchanged", async () => {
      const res = await withTenantTransaction(ctxOperador, (tx) =>
        tx.sucursal.updateMany({
          where: { id: fx.sucursalA1.id },
          data: { nombre: "Hackeada", version: { increment: 1 } },
        }),
      );
      expect(res.count).toBe(0);
      const stored = await getHarnessDb().sucursal.findUniqueOrThrow({ where: { id: fx.sucursalA1.id } });
      expect(stored.nombre).toBe("A1");
      expect(stored.version).toBe(1);
    });

    it("DELETE touches zero rows and the branch stays", async () => {
      const res = await withTenantTransaction(ctxOperador, (tx) =>
        tx.sucursal.deleteMany({ where: { id: fx.sucursalA2.id } }),
      );
      expect(res.count).toBe(0);
      expect(await getHarnessDb().sucursal.count({ where: { id: fx.sucursalA2.id } })).toBe(1);
    });
  });

  // ── Cross-empresa ─────────────────────────────────────────────────────
  describe("cross-empresa: admin of A vs empresa B", () => {
    it("cannot INSERT a branch into B", async () => {
      const before = await getHarnessDb().sucursal.count();
      await expect(
        withTenantTransaction(ctxAdmin, (tx) =>
          tx.sucursal.create({ data: datos(fx.empresaB.id, "Cruzada") }),
        ),
      ).rejects.toThrow(RLS_VIOLATION);
      expect(await getHarnessDb().sucursal.count()).toBe(before);
    });

    it("cannot UPDATE a branch of B (zero rows) and B stays unchanged", async () => {
      const res = await withTenantTransaction(ctxAdmin, (tx) =>
        tx.sucursal.updateMany({ where: { id: fx.sucursalB1.id }, data: { nombre: "Tomada" } }),
      );
      expect(res.count).toBe(0);
      const stored = await getHarnessDb().sucursal.findUniqueOrThrow({ where: { id: fx.sucursalB1.id } });
      expect(stored.nombre).toBe("B1");
    });

    it("cannot move one of its own branches to B (WITH CHECK) and the row is unchanged", async () => {
      await expect(
        withTenantTransaction(ctxAdmin, (tx) =>
          tx.sucursal.updateMany({ where: { id: fx.sucursalA2.id }, data: { empresaId: fx.empresaB.id } }),
        ),
      ).rejects.toThrow(RLS_VIOLATION);
      const stored = await getHarnessDb().sucursal.findUniqueOrThrow({ where: { id: fx.sucursalA2.id } });
      expect(stored.empresaId).toBe(fx.empresaA.id);
    });

    it("cannot DELETE a branch of B", async () => {
      const res = await withTenantTransaction(ctxAdmin, (tx) =>
        tx.sucursal.deleteMany({ where: { id: fx.sucursalB1.id } }),
      );
      expect(res.count).toBe(0);
      expect(await getHarnessDb().sucursal.count({ where: { id: fx.sucursalB1.id } })).toBe(1);
    });
  });

  // ── SELECT unchanged ──────────────────────────────────────────────────
  describe("SELECT behaviour is unchanged", () => {
    it.each([
      ["admin", () => ctxAdmin],
      ["non-admin", () => ctxOperador],
    ])("%s reads every branch of its empresa and none of another", async (_label, pick) => {
      const rows = await withTenantTransaction(pick(), (tx) =>
        tx.sucursal.findMany({ select: { id: true }, orderBy: { id: "asc" } }),
      );
      expect(rows.map((r) => r.id)).toEqual([fx.sucursalA1.id, fx.sucursalA2.id]);
      expect(rows.map((r) => r.id)).not.toContain(fx.sucursalB1.id);
    });
  });

  // ── Bootstrap ─────────────────────────────────────────────────────────
  describe("bootstrap exception", () => {
    it("is_bootstrap can INSERT a branch (no tenant, no admin) and DELETE it", async () => {
      const creadaId = await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.is_bootstrap', 'true', true)`;
        const s = await tx.sucursal.create({ data: datos(fx.empresaB.id, "Bootstrap") });
        return s.id;
      });
      expect((await getHarnessDb().sucursal.findUniqueOrThrow({ where: { id: creadaId } })).empresaId).toBe(
        fx.empresaB.id,
      );

      const del = await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.is_bootstrap', 'true', true)`;
        return tx.sucursal.deleteMany({ where: { id: creadaId } });
      });
      expect(del.count).toBe(1);
    });
  });

  // ── Unique name ───────────────────────────────────────────────────────
  describe("unique branch name per empresa (trimmed, case-insensitive)", () => {
    it("refuses an exact duplicate under the app role and stores nothing", async () => {
      await getHarnessDb().sucursal.create({ data: datos(fx.empresaA.id, "Central") });
      const before = (await sucursalesDe(fx.empresaA.id)).length;
      await expect(
        withTenantTransaction(ctxAdmin, (tx) =>
          tx.sucursal.create({ data: datos(fx.empresaA.id, "Central") }),
        ),
      ).rejects.toThrow(UNIQUE_VIOLATION);
      expect((await sucursalesDe(fx.empresaA.id)).length).toBe(before);
    });

    it("refuses a case/whitespace variant ('  Central ' vs 'central')", async () => {
      await getHarnessDb().sucursal.create({ data: datos(fx.empresaA.id, "central") });
      const before = (await sucursalesDe(fx.empresaA.id)).length;
      await expect(
        withTenantTransaction(ctxAdmin, (tx) =>
          tx.sucursal.create({ data: datos(fx.empresaA.id, "  Central ") }),
        ),
      ).rejects.toThrow(UNIQUE_VIOLATION);
      expect((await sucursalesDe(fx.empresaA.id)).length).toBe(before);
    });

    it("refuses renaming a branch to another branch's name (UPDATE) and the row is unchanged", async () => {
      await expect(
        withTenantTransaction(ctxAdmin, (tx) =>
          tx.sucursal.updateMany({ where: { id: fx.sucursalA2.id }, data: { nombre: " a1 " } }),
        ),
      ).rejects.toThrow(UNIQUE_VIOLATION);
      const stored = await getHarnessDb().sucursal.findUniqueOrThrow({ where: { id: fx.sucursalA2.id } });
      expect(stored.nombre).toBe("A2");
    });

    it("allows the same name in ANOTHER empresa", async () => {
      await getHarnessDb().sucursal.create({ data: datos(fx.empresaB.id, "Central") });
      const creada = await withTenantTransaction(ctxAdmin, (tx) =>
        tx.sucursal.create({ data: datos(fx.empresaA.id, "Central") }),
      );
      expect(creada.empresaId).toBe(fx.empresaA.id);
      expect(await getHarnessDb().sucursal.count({ where: { nombre: "Central" } })).toBe(2);
    });
  });

  // ── version default ───────────────────────────────────────────────────
  describe("version column", () => {
    it("defaults to 1 for rows created without it", async () => {
      const rows = await getHarnessDb().sucursal.findMany({
        where: { id: { in: [fx.sucursalA1.id, fx.sucursalA2.id, fx.sucursalB1.id] } },
      });
      expect(rows).toHaveLength(3);
      expect(rows.map((r) => r.version)).toEqual([1, 1, 1]);
    });
  });
});
