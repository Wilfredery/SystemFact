/**
 * Administración — Zod transport contracts (no DB, no action collaborators).
 *
 * PURE: this file never imports `./actions.administracion`, so the generated
 * Prisma client stays out of the suite. It proves what the wire ACCEPTS: the
 * page/pageSize defaults belong to `shared/domain/pagination` (not to zod), the
 * search term is trimmed and blank-free, and `activo` is a real tri-state — the
 * `z.coerce.boolean()` trap ("false" → true) must not reappear here.
 */

import { zCambiarSucursalInput, zListarUsuariosQuery } from "./validations";

describe("zListarUsuariosQuery", () => {
  it("accepts an empty object: page/pageSize stay undefined so shared pagination owns the defaults", () => {
    const r = zListarUsuariosQuery.safeParse({});
    expect(r.success).toBe(true);
    expect(r.success && r.data).toEqual({});
  });

  it("coerces string page/pageSize coming from the query string", () => {
    const r = zListarUsuariosQuery.safeParse({ page: "2", pageSize: "50" });
    expect(r.success).toBe(true);
    expect(r.success && r.data).toEqual({ page: 2, pageSize: 50 });
  });

  it("does NOT bound page/pageSize here (the use case clamps through shared pagination)", () => {
    const r = zListarUsuariosQuery.safeParse({ page: "0", pageSize: "250" });
    expect(r.success).toBe(true);
    expect(r.success && r.data).toEqual({ page: 0, pageSize: 250 });
  });

  it("rejects a non-numeric page", () => {
    expect(zListarUsuariosQuery.safeParse({ page: "abc" }).success).toBe(false);
  });

  it("trims the search term", () => {
    const r = zListarUsuariosQuery.safeParse({ buscar: "  maria  " });
    expect(r.success && r.data.buscar).toBe("maria");
  });

  it("rejects a blank / whitespace-only search term and an over-long one", () => {
    expect(zListarUsuariosQuery.safeParse({ buscar: "   " }).success).toBe(false);
    expect(zListarUsuariosQuery.safeParse({ buscar: "x".repeat(101) }).success).toBe(
      false,
    );
  });

  it("accepts activo as a real boolean", () => {
    expect(zListarUsuariosQuery.safeParse({ activo: false }).success).toBe(true);
    const r = zListarUsuariosQuery.safeParse({ activo: true });
    expect(r.success && r.data.activo).toBe(true);
  });

  it('parses the query-string form "false" as FALSE (never the coerce.boolean() truthy trap)', () => {
    const r = zListarUsuariosQuery.safeParse({ activo: "false" });
    expect(r.success && r.data.activo).toBe(false);
    const t = zListarUsuariosQuery.safeParse({ activo: "true" });
    expect(t.success && t.data.activo).toBe(true);
  });

  it("rejects an arbitrary activo value", () => {
    expect(zListarUsuariosQuery.safeParse({ activo: "sí" }).success).toBe(false);
  });
});

describe("zCambiarSucursalInput (pre-existing contract — PRESERVE)", () => {
  // `validations.ts` is shared with the branch-switch action; adding the
  // directory schema must leave that transport contract exactly as it was.
  it("still accepts a positive sucursalId and still rejects 0 / a missing id", () => {
    expect(zCambiarSucursalInput.safeParse({ sucursalId: 10 }).success).toBe(true);
    expect(zCambiarSucursalInput.safeParse({ sucursalId: 0 }).success).toBe(false);
    expect(zCambiarSucursalInput.safeParse({}).success).toBe(false);
  });
});
