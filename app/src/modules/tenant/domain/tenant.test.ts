/**
 * Unit tests — funciones puras del módulo de dominio tenant.
 *
 * Cobertura:
 *   - `tenantFilter(ctx)` siempre retorna empresaId + sucursalId.
 *   - `buildTenantContext(usuario, roles)` con y sin rol Administrador.
 *   - Inmutabilidad y shape de TenantCtx.
 *
 * Las funciones con efectos en BD (`setTenantContext`, `getCurrentTenantContext`)
 * y el traductor `tenantWhere` (infraestructura) se prueban en R1.C con
 * integration tests contra Supabase real.
 */

import {
  buildTenantContext,
  tenantFilter,
  type TenantCtx,
  type TenantFilter,
} from "@/modules/tenant/domain/tenant";

describe("tenantFilter", () => {
  it("produce empresaId + sucursalId cuando el usuario tiene sucursal asignada", () => {
    const ctx: TenantCtx = {
      empresaId: 1,
      sucursalId: 10,
      usuarioId: 100,
      esAdmin: false,
    };
    const filter = tenantFilter(ctx);
    expect(filter).toEqual({
      empresaId: 1,
      sucursalId: 10,
    });
  });

  it("produce empresaId + sucursalId=0 si el ID válido es 0 (no usamos truthy check)", () => {
    // El ERD usa Int autoincrement que en Postgres arranca en 1, pero el tipo
    // permite 0. Verificamos que NO usamos un check truthy.
    const ctx: TenantCtx = {
      empresaId: 1,
      sucursalId: 0,
      usuarioId: 100,
      esAdmin: true,
    };
    expect(tenantFilter(ctx)).toEqual({
      empresaId: 1,
      sucursalId: 0,
    });
  });

  it("produce un objeto nuevo cada llamada (no muta el ctx)", () => {
    const ctx: TenantCtx = {
      empresaId: 1,
      sucursalId: 10,
      usuarioId: 100,
      esAdmin: false,
    };
    const a = tenantFilter(ctx);
    const b = tenantFilter(ctx);
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});

describe("buildTenantContext", () => {
  it("marca esAdmin=true cuando el usuario tiene el rol Administrador", () => {
    const ctx = buildTenantContext(
      { id: 100, empresaId: 1, sucursalId: 10 },
      ["Despachador", "Administrador"],
    );
    expect(ctx).toEqual({
      empresaId: 1,
      sucursalId: 10,
      usuarioId: 100,
      esAdmin: true,
    });
  });

  it("marca esAdmin=false cuando el usuario NO tiene el rol Administrador", () => {
    const ctx = buildTenantContext(
      { id: 100, empresaId: 1, sucursalId: 10 },
      ["Cobrador"],
    );
    expect(ctx.esAdmin).toBe(false);
  });

  it("marca esAdmin=false cuando el usuario no tiene roles", () => {
    const ctx = buildTenantContext(
      { id: 100, empresaId: 1, sucursalId: 10 },
      [],
    );
    expect(ctx.esAdmin).toBe(false);
  });

  it("preserva empresaId, sucursalId y usuarioId del input", () => {
    const ctx = buildTenantContext(
      { id: 42, empresaId: 7, sucursalId: 99 },
      ["Administrador"],
    );
    expect(ctx.empresaId).toBe(7);
    expect(ctx.sucursalId).toBe(99);
    expect(ctx.usuarioId).toBe(42);
  });

  it("produce un objeto readonly (TypeScript enforces, runtime no — sanity check de igualdad)", () => {
    const ctx = buildTenantContext(
      { id: 1, empresaId: 1, sucursalId: 1 },
      ["Administrador"],
    );
    // Las propiedades son `readonly` por tipo; esto verifica que el objeto
    // es un POJO plano y comparable.
    expect(JSON.stringify(ctx)).toBe(
      JSON.stringify({ empresaId: 1, sucursalId: 1, usuarioId: 1, esAdmin: true }),
    );
  });

  it("no muta el array de roles pasado por el caller", () => {
    const roles = ["Administrador", "Cobrador"];
    const rolesCopy = [...roles];
    buildTenantContext({ id: 1, empresaId: 1, sucursalId: 1 }, roles);
    expect(roles).toEqual(rolesCopy);
  });
});

describe("TenantCtx shape", () => {
  it("produce objeto con exactamente 4 campos en runtime", () => {
    const ctx: TenantCtx = {
      empresaId: 1,
      sucursalId: 1,
      usuarioId: 1,
      esAdmin: false,
    };
    expect(Object.keys(ctx).sort()).toEqual(
      ["empresaId", "esAdmin", "sucursalId", "usuarioId"].sort(),
    );
  });
});

describe("TenantFilter shape", () => {
  it("tiene exactamente 2 campos", () => {
    const f: TenantFilter = { empresaId: 1, sucursalId: 10 };
    expect(Object.keys(f).sort()).toEqual(["empresaId", "sucursalId"].sort());
  });
});
