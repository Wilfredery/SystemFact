/**
 * `getCurrentTenantContext` — the third caller of the sub-keyed identity
 * resolution (test gap R3-002 from the native bounded review on v2r-01).
 *
 * `getCurrentUser` and `resolverUsuarioDeSesion` (logout) are pinned directly
 * by `auth-identity.test.ts`; this caller was not, although it is the function
 * that decides which `TenantCtx` an entire request runs under. These tests
 * pin exactly that: resolution by `sub` (never email), the enumerated select
 * (no over-fetch), the login-flow RLS pin, and the derived `esAdmin`.
 */
import { getCurrentTenantContext } from "@/modules/tenant/infrastructure/tenant-runtime";

const SUB_A = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";

// The Prisma client is mocked at the module boundary, mirroring
// `auth-identity.test.ts` (doubles created INSIDE the factory because Jest
// hoists `jest.mock` above every statement in this file).
jest.mock("@/lib/prisma", () => {
  const usuario = {
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    updateMany: jest.fn(),
  };
  const movimientoAuditoria = { create: jest.fn() };
  const tx = { usuario, movimientoAuditoria, $executeRaw: jest.fn() };
  const prisma = { $transaction: jest.fn() };
  return { prisma, __usuario: usuario, __tx: tx };
});

const { prisma, __usuario: usuario, __tx: tx } = jest.requireMock("@/lib/prisma") as {
  prisma: { $transaction: jest.Mock };
  __usuario: { findFirst: jest.Mock; findUnique: jest.Mock; updateMany: jest.Mock };
  __tx: { $executeRaw: jest.Mock };
};

/** Fake `SupabaseClient` exposing the session through `getUser()` only. */
function supabaseWithUser(user: { id: string; email?: string | null } | null) {
  return {
    auth: {
      getUser: jest.fn().mockResolvedValue({ data: { user }, error: null }),
      signOut: jest.fn().mockResolvedValue({ error: null }),
    },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  prisma.$transaction.mockImplementation((fn: (t: unknown) => Promise<unknown>) =>
    fn({ usuario, $executeRaw: tx.$executeRaw }),
  );
  usuario.findFirst.mockResolvedValue(null);
  usuario.findUnique.mockResolvedValue(null);
  usuario.updateMany.mockResolvedValue({ count: 1 });
  tx.$executeRaw.mockResolvedValue(0);
});

describe("getCurrentTenantContext — resolution by sub, NOT by email", () => {
  it("builds the TenantCtx from the row resolved by sub", async () => {
    usuario.findFirst.mockResolvedValue({
      id: 42,
      empresaId: 7,
      sucursalId: 3,
      activo: true,
      roles: [{ rol: { nombre: "Administrador" } }],
    });

    const ctx = await getCurrentTenantContext(
      supabaseWithUser({ id: SUB_A, email: "ana@users.systemfact.internal" }) as never,
    );

    // esAdmin is DERIVED from the roles relation, not a separate flag (P6).
    expect(ctx).toEqual({
      empresaId: 7,
      sucursalId: 3,
      usuarioId: 42,
      esAdmin: true,
    });
  });

  it("derives esAdmin=false for a non-admin role", async () => {
    usuario.findFirst.mockResolvedValue({
      id: 42,
      empresaId: 7,
      sucursalId: 3,
      activo: true,
      roles: [{ rol: { nombre: "Cajero" } }],
    });

    await expect(
      getCurrentTenantContext(
        supabaseWithUser({ id: SUB_A, email: null }) as never,
      ),
    ).resolves.toEqual({
      empresaId: 7,
      sucursalId: 3,
      usuarioId: 42,
      esAdmin: false,
    });
  });

  it("only queries by authUserId with an enumerated select (no over-fetch)", async () => {
    usuario.findFirst.mockResolvedValue({
      id: 42,
      empresaId: 7,
      sucursalId: 3,
      activo: true,
      roles: [],
    });

    await getCurrentTenantContext(
      supabaseWithUser({ id: SUB_A, email: null }) as never,
    );

    // The exact where/select shape: keyed on sub only. Reintroducing an
    // email-keyed lookup, an extra column, or a wildcard select fails here —
    // the same guards `auth-identity.test.ts` pins for the other two callers.
    expect(usuario.findFirst).toHaveBeenCalledTimes(1);
    expect(usuario.findFirst.mock.calls[0]?.[0]).toStrictEqual({
      where: { authUserId: SUB_A },
      select: {
        id: true,
        empresaId: true,
        sucursalId: true,
        activo: true,
        roles: { select: { rol: { select: { nombre: true } } } },
      },
    });
    expect(usuario.findUnique).not.toHaveBeenCalled();
    // `setLoginFlow` is what makes this pre-tenant SELECT legal under RLS.
    expect(
      tx.$executeRaw.mock.calls.some(
        (call: readonly unknown[]) => String(call[0]).includes("app.is_login_flow"),
      ),
    ).toBe(true);
  });

  it("returns null for an unlinked row without building a context", async () => {
    usuario.findFirst.mockResolvedValue(null);

    await expect(
      getCurrentTenantContext(supabaseWithUser({ id: SUB_A, email: null }) as never),
    ).resolves.toBeNull();
  });

  it("treats an inactive user as unauthenticated", async () => {
    usuario.findFirst.mockResolvedValue({
      id: 42,
      empresaId: 7,
      sucursalId: 3,
      activo: false,
      roles: [{ rol: { nombre: "Administrador" } }],
    });

    await expect(
      getCurrentTenantContext(
        supabaseWithUser({ id: SUB_A, email: "ana@users.systemfact.internal" }) as never,
      ),
    ).resolves.toBeNull();
  });

  it("fails closed without querying when there is no session", async () => {
    await expect(
      getCurrentTenantContext(supabaseWithUser(null) as never),
    ).resolves.toBeNull();
    expect(usuario.findFirst).not.toHaveBeenCalled();
  });

  it("fails closed without querying when the sub claim is malformed", async () => {
    for (const bad of ["", "   ", "not-a-uuid", "aaaaaaaa111141118111aaaaaaaaaaaa"]) {
      await expect(
        getCurrentTenantContext(supabaseWithUser({ id: bad, email: null }) as never),
      ).resolves.toBeNull();
    }
    expect(usuario.findFirst).not.toHaveBeenCalled();
  });
});
