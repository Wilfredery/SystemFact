/**
 * Integration tests — S1 admin-only sucursal listing (real DB, RLS enforced).
 *
 * TEN-LIST: the admin sees exactly the empresa's ACTIVE branches; inactive and
 * foreign-empresa branches never appear; a non-admin ctx is denied before any
 * read. Runs through `withTenantTransaction` (app role + RLS GUCs).
 */

import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import { withTenantTransaction } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import { listarSucursalesDeEmpresa } from "@/modules/tenant/application/listarSucursalesDeEmpresa";
import { TEN_OPS_NO_AUTORIZADO } from "@/modules/tenant/domain/errors";
import { getHarnessDb, seedTenantFixture, type TenantFixture } from "./setup/fixtures";

describe("listarSucursalesDeEmpresa (real DB)", () => {
  let fixture: TenantFixture;
  let ctxA: TenantCtx;

  beforeEach(async () => {
    fixture = await seedTenantFixture();
    ctxA = {
      empresaId: fixture.empresaA.id,
      sucursalId: fixture.sucursalA1.id,
      usuarioId: fixture.usuarios.adminA.id,
      esAdmin: true,
    };
  });

  it("TEN-LIST-01-A: admin sees active A1,A2 only — inactive A3 and empresa-B branches excluded", async () => {
    const db = getHarnessDb();
    const sucursalA3Inactiva = await db.sucursal.create({
      data: {
        empresaId: fixture.empresaA.id,
        nombre: "A3",
        direccion: "x",
        telefono: "0",
        activa: false,
      },
    });

    const result = await withTenantTransaction(ctxA, (tx: PrismaTx) =>
      listarSucursalesDeEmpresa(ctxA, tx),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const nombres = result.sucursales.map((s) => s.nombre).sort();
    // Fixture branches A1/A2 are active by default; narrow select: id + nombre.
    expect(nombres).toEqual(["A1", "A2"].sort());
    expect(result.sucursales.map((s) => s.id)).not.toContain(sucursalA3Inactiva.id);
    expect(result.sucursales.map((s) => s.id)).not.toContain(fixture.sucursalB1.id);
    // Narrow select: no deep tenant data escapes.
    expect(Object.keys(result.sucursales[0] ?? {})).toEqual(["id", "nombre"]);
  });

  it("TEN-LIST-01-C: non-admin ctx denied BEFORE any read — no row data", async () => {
    const ctxNoAdmin: TenantCtx = { ...ctxA, esAdmin: false };
    const result = await withTenantTransaction(ctxNoAdmin, (tx: PrismaTx) =>
      listarSucursalesDeEmpresa(ctxNoAdmin, tx),
    );

    expect(result).toEqual({
      ok: false,
      code: TEN_OPS_NO_AUTORIZADO,
      message: expect.any(String),
    });
  });
});
