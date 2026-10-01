/**
 * Identity resolution and lazy `authUserId` binding (audit finding v2r-01).
 *
 * What these tests are FOR: v2r-01 was a tamper-resistance hole, not a bug report.
 * Email used to identify the `USUARIO` row, and an Auth admin can change a user's
 * email — so whoever controlled the email attribute controlled which row, and
 * therefore which `empresa`, a request resolved to. A happy-path test cannot catch
 * that class of bug, so most of what follows is deliberately adversarial: same
 * email / different sub, different email / same sub, and a row already bound to
 * another identity.
 *
 * The single most important assertion is `resolves by sub, NOT by email` below.
 * Everything else is bookkeeping around it.
 *
 * The fake Supabase client exposes the session through `getUser()` only, exactly
 * like the real one on the request path.
 */
import { Prisma } from "@/generated/prisma/client";
import {
  getCurrentUser,
  loginWithCredenciales,
  logout,
  registrarAuditoriaSesion,
} from "@/modules/auth/infrastructure/auth-service";
import { enlazarAuthSub } from "@/modules/auth/infrastructure/auth-identity";
import {
  AUTH_CREDENCIALES_INVALIDAS,
  AUTH_ENLACE_CONFLICTO,
  AUTH_ENLACE_DUPLICADO,
  AUTH_ENLACE_NO_RESUELTO,
  AUTH_USUARIO_INACTIVO,
} from "@/modules/auth/domain/errors";

const SUB_A = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const SUB_B = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb";

/** Prisma errors the real client throws, built from the same stub the code imports. */
function p2002(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "test",
  });
}

// The `usuario` table surface the code under test touches, per test.
interface UsuarioStub {
  findFirst: jest.Mock;
  findUnique: jest.Mock;
  updateMany: jest.Mock;
}

// The Prisma client is mocked at the module boundary. The doubles are created
// INSIDE the factory because Jest hoists `jest.mock` above every statement in this
// file: a factory closing over a top-level `const` would hit the temporal dead
// zone. They are read back below with `jest.requireMock`.
jest.mock("@/lib/prisma", () => {
  const usuario = {
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    updateMany: jest.fn(),
  };
  // Successful logins append one audit row through the auditoria write port.
  const movimientoAuditoria = { create: jest.fn() };
  const tx = { usuario, movimientoAuditoria, $executeRaw: jest.fn() };
  const prisma = { $transaction: jest.fn() };
  return { prisma, __usuario: usuario, __tx: tx };
});

interface TxStub {
  usuario: UsuarioStub;
  movimientoAuditoria: { create: jest.Mock };
  $executeRaw: jest.Mock;
}

const { prisma, __usuario: usuario, __tx: tx } = jest.requireMock("@/lib/prisma") as {
  prisma: { $transaction: jest.Mock };
  __usuario: UsuarioStub;
  __tx: TxStub;
};

/** A session whose ONLY usable identity is `id` (the Auth sub). */
function supabaseWithUser(user: { id: string; email?: string | null } | null) {
  return {
    auth: {
      getUser: jest.fn().mockResolvedValue({
        data: { user },
        error: null,
      }),
      signInWithPassword: jest.fn().mockResolvedValue({
        data: { session: user === null ? null : { access_token: "t" }, user },
        error: null,
      }),
      signOut: jest.fn().mockResolvedValue({ error: null }),
    },
  };
}

/** Fake `SupabaseClient` with only the surface auth-service calls. */
function asSupabase(fake: ReturnType<typeof supabaseWithUser>) {
  // Structural cast: the fake implements the exact members these code paths use.
  return fake as unknown as Parameters<typeof getCurrentUser>[0];
}

/** Runs the transaction callback against the stubbed tx client. */
function withTx<T>(impl: (t: TxStub) => Promise<T>): Promise<T> {
  return impl(tx);
}

const empresa = { id: 7, nombreComercial: "Acme" };
const sucursal = { id: 3, nombre: "Principal" };

/**
 * Every `set_config('<key>', <value>, true)` statement issued on the stubbed tx,
 * reconstructed back into the SQL the DB would have received.
 *
 * WHY THIS EXISTS: a tagged-template call reaches a mock as
 * `(strings, ...interpolatedValues)`, so `$executeRaw` was previously only
 * assertable with `toHaveBeenCalled()` — which passes for ANY raw statement,
 * including one that pinned the WRONG company or pinned nothing at all. Rebuilding
 * the statement lets the tests assert the GUC NAME and the VALUE, and the
 * returned array preserves ORDER and DUPLICATES, so an extra/second pin (i.e. the
 * GUC being widened) is visible as a longer list instead of being swallowed.
 *
 * Values are compared as the raw strings Prisma binds, so `String(empresaId)`
 * and a literal `'true'` both show up verbatim.
 */
function gucPins(
  executeRaw: jest.Mock,
): { readonly key: string; readonly value: string }[] {
  return executeRaw.mock.calls.flatMap((call: readonly unknown[]) => {
    const chunks = Array.from(call[0] as ArrayLike<string>);
    const values = call.slice(1);
    let statement = "";
    chunks.forEach((chunk, i) => {
      statement += chunk;
      if (i < values.length) statement += String(values[i]);
    });
    const match = /^SELECT set_config\('([^']+)', (.*), true\)$/.exec(statement);
    return match === null ? [] : [{ key: match[1]!, value: match[2]! }];
  });
}

/** Only the `app.current_empresa_id` pins, as bound strings — the tenant boundary. */
function empresaGucPins(executeRaw: jest.Mock): string[] {
  return gucPins(executeRaw)
    .filter((pin) => pin.key === "app.current_empresa_id")
    .map((pin) => pin.value);
}

/**
 * The `app.is_login_flow` pins, as bound strings — the ONE controlled exception to
 * multi-tenant isolation (ADR-019), and therefore security-critical coverage.
 *
 * Why this filter and not a bare `gucPins` length check: `setLoginFlow` is what unlocks
 * `usuario_select` before a TenantCtx exists, and it is ALSO called by
 * `registrarAuditoriaSesion`. Asserting only "some GUC was pinned" would pass if the
 * flag were dropped from all three identity functions and the audit path kept pinning
 * it, so the KEY must be filtered on explicitly.
 *
 * The value is the raw text Prisma binds, quotes included: `set_config('app.is_login_flow',
 * 'true', true)` has no interpolation, so the reconstructed statement captures `'true'`
 * (with quotes). Asserting the quotes too catches a regression to an unquoted form.
 */
function loginFlowPins(executeRaw: jest.Mock): string[] {
  return gucPins(executeRaw)
    .filter((pin) => pin.key === "app.is_login_flow")
    .map((pin) => pin.value);
}

/** The audit rows appended through the write port, in order. */
function auditRows(): Record<string, unknown>[] {
  return tx.movimientoAuditoria.create.mock.calls.map(
    (call: readonly [{ data: Record<string, unknown> }]) => call[0].data,
  );
}

/**
 * The full shape of the ONE session audit row the port writes. Every field is
 * spelled out (no `expect.any`) so a silent column change — a new non-null
 * default, a dropped `sucursalId: null`, a reworded `entidad` — fails here.
 * `fechaHora` is the only wildcard: it is stamped at write time.
 */
function expectedAuditRow(
  accion: "LOGIN" | "LOGOUT",
  empresaId: number,
  usuarioId: number,
): Record<string, unknown> {
  return {
    empresaId,
    sucursalId: null,
    usuarioId,
    fechaHora: expect.any(Date),
    accion,
    entidad: "Sesion",
    idEntidad: String(usuarioId),
    valorAnterior: null,
    valorNuevo: null,
    motivo: null,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  prisma.$transaction.mockImplementation(withTx);
  usuario.findFirst.mockResolvedValue(null);
  usuario.findUnique.mockResolvedValue(null);
  usuario.updateMany.mockResolvedValue({ count: 1 });
  tx.$executeRaw.mockResolvedValue(0);
  tx.movimientoAuditoria.create.mockResolvedValue({ id: 1 });
});

describe("getCurrentUser — resolution by sub, NOT by email", () => {
  it("resolves the USUARIO row from the session sub, ignoring the email entirely", async () => {
    // The email claims to be a DIFFERENT user's account. Resolution must still
    // land on the row keyed by the sub: that is the whole point of v2r-01.
    const supabase = supabaseWithUser({
      id: SUB_A,
      email: "otrousuario@users.systemfact.internal",
    });
    usuario.findFirst.mockResolvedValue({
      nombre: "Ana",
      nombreUsuario: "ana",
      activo: true,
      empresa,
      sucursal,
    });

    const ctx = await getCurrentUser(asSupabase(supabase));

    expect(ctx).toEqual({
      nombre: "Ana",
      nombreUsuario: "ana",
      empresa,
      sucursal,
    });
    // Asserted explicitly: the query is keyed on authUserId only. A regression
    // that re-derives nombreUsuario from the email fails HERE.
    expect(usuario.findFirst).toHaveBeenCalledTimes(1);
    // The select is ENUMERATED, not wildcarded, because this is the call that
    // carries the no-over-fetch claim (`buscarUsuarioPorAuthSub` promises no path
    // over-fetches `passwordHash`). `toStrictEqual` is exact deep equality, so
    // adding `passwordHash: true` — or any other column — fails here.
    expect(usuario.findFirst.mock.calls[0]?.[0]).toStrictEqual({
      where: { authUserId: SUB_A },
      select: {
        nombre: true,
        nombreUsuario: true,
        activo: true,
        empresa: { select: { id: true, nombreComercial: true } },
        sucursal: { select: { id: true, nombre: true } },
      },
    });
    // No email-keyed lookup is reachable from the request path.
    expect(usuario.findUnique).not.toHaveBeenCalled();
    // `setLoginFlow` is what makes this pre-tenant SELECT legal under RLS
    // (ADR-019). Deleting it from `buscarUsuarioPorAuthSub` leaves [] here.
    expect(loginFlowPins(tx.$executeRaw)).toEqual(["'true'"]);
  });

  it("returns null when the row is not linked yet (authUserId IS NULL)", async () => {
    // findFirst by a real sub finds nothing on an unlinked row — this is the
    // accepted one-time re-login after the column was introduced.
    const supabase = supabaseWithUser({ id: SUB_A, email: null });
    usuario.findFirst.mockResolvedValue(null);

    await expect(getCurrentUser(asSupabase(supabase))).resolves.toBeNull();
  });

  it("returns null for an inactive user even when the sub matches", async () => {
    const supabase = supabaseWithUser({ id: SUB_A, email: null });
    usuario.findFirst.mockResolvedValue({
      nombre: "Ana",
      nombreUsuario: "ana",
      activo: false,
      empresa,
      sucursal,
    });

    await expect(getCurrentUser(asSupabase(supabase))).resolves.toBeNull();
  });

  it("returns null when there is no session", async () => {
    const supabase = supabaseWithUser(null);
    await expect(getCurrentUser(asSupabase(supabase))).resolves.toBeNull();
    // Fail closed: no query at all when there is no identity to trust.
    expect(usuario.findFirst).not.toHaveBeenCalled();
  });

  it("returns null when the sub claim is blank or malformed, without querying", async () => {
    // A malformed sub must not become a DB cast error (an opaque 500).
    for (const bad of ["", "   ", "not-a-uuid", "aaaaaaaa111141118111aaaaaaaaaaaa"]) {
      const supabase = supabaseWithUser({ id: bad, email: null });
      await expect(getCurrentUser(asSupabase(supabase))).resolves.toBeNull();
    }
    expect(usuario.findFirst).not.toHaveBeenCalled();
  });

  it("tolerates a null email on a valid session (never needs the email)", async () => {
    const supabase = supabaseWithUser({ id: SUB_A, email: null });
    usuario.findFirst.mockResolvedValue({
      nombre: "Ana",
      nombreUsuario: "ana",
      activo: true,
      empresa,
      sucursal,
    });

    await expect(getCurrentUser(asSupabase(supabase))).resolves.not.toBeNull();
  });
});

describe("loginWithCredenciales — lazy binding of authUserId", () => {
  const fila = { id: 42, activo: true, empresaId: 7 };

  it("binds the sub on first login and resolves ok", async () => {
    const supabase = supabaseWithUser({
      id: SUB_A,
      email: "ana@users.systemfact.internal",
    });
    // The bootstrap lookup (by nombreUsuario) finds the unlinked row.
    usuario.findUnique.mockResolvedValue(fila);
    // Inside enlazarAuthSub, the read of the current authUserId.
    usuario.findUnique.mockResolvedValueOnce(fila).mockResolvedValueOnce({
      authUserId: null,
    });
    // The audit write goes through its own path; keep the row update observable.
    usuario.updateMany.mockResolvedValue({ count: 1 });

    const res = await loginWithCredenciales(
      asSupabase(supabase),
      "ana",
      "correct-password",
    );

    expect(res.ok).toBe(true);
    // Bind is a compare-and-swap against an unlinked row, scoped to the
    // anchor's company: every statement here runs with the tenant GUC pinned,
    // so an `empresaId`-less filter would be a cross-tenant read/write.
    expect(usuario.updateMany).toHaveBeenCalledWith({
      where: { id: 42, empresaId: 7, authUserId: null },
      data: { authUserId: SUB_A },
    });
    expect(usuario.findUnique).toHaveBeenCalledWith({
      where: { id: 42, empresaId: 7 },
      select: { authUserId: true },
    });

    // REQ-AUTH-AUD-001 #1 — a FULLY successful login appends EXACTLY ONE LOGIN
    // row. COUNT included: `toHaveBeenCalledWith` alone would also pass on two
    // identical rows.
    expect(tx.movimientoAuditoria.create).toHaveBeenCalledTimes(1);
    expect(auditRows()).toEqual([expectedAuditRow("LOGIN", 7, 42)]);

    // The RLS GUC is pinned to the resolved company before every write — twice
    // here, once per standalone transaction (`enlazarAuthSub`, then
    // `registrarAuditoriaSesion`). Both pins must carry the SAME empresa: a
    // second, different value would mean the GUC was widened.
    expect(empresaGucPins(tx.$executeRaw)).toEqual(["7", "7"]);
    // The login-flow exception is raised on ALL THREE pre-tenant transactions of
    // this path, in order: `buscarUsuarioPorNombreUsuario`, `enlazarAuthSub`,
    // `registrarAuditoriaSesion`. The count is what makes this load-bearing —
    // dropping the flag from ANY of the three leaves two pins here and fails, so
    // the RLS `usuario_select` exception can no longer be lost in silence.
    expect(loginFlowPins(tx.$executeRaw)).toEqual(["'true'", "'true'", "'true'"]);
  });

  it("is idempotent when the row is already bound to the SAME sub", async () => {
    const supabase = supabaseWithUser({
      id: SUB_A,
      email: "ana@users.systemfact.internal",
    });
    usuario.findUnique
      .mockResolvedValueOnce(fila) // bootstrap
      .mockResolvedValueOnce({ authUserId: SUB_A }); // already linked to us

    const res = await loginWithCredenciales(asSupabase(supabase), "ana", "pw");

    expect(res.ok).toBe(true);
    // No rewrite: idempotency means the column is left alone.
    expect(usuario.updateMany).not.toHaveBeenCalled();
    // A re-login is a FULLY successful login, so it is auditable like any other.
    expect(auditRows()).toEqual([expectedAuditRow("LOGIN", 7, 42)]);
  });

  it("refuses a row already bound to a DIFFERENT sub and signs the session out", async () => {
    // Same email, different sub == the Auth user was deleted and recreated.
    // Only an admin may re-point the link; the user must not self-heal it.
    const supabase = supabaseWithUser({
      id: SUB_B,
      email: "ana@users.systemfact.internal",
    });
    usuario.findUnique
      .mockResolvedValueOnce(fila) // bootstrap
      .mockResolvedValueOnce({ authUserId: SUB_A }); // bound to the OLD sub

    const res = await loginWithCredenciales(asSupabase(supabase), "ana", "pw");

    expect(res).toEqual({
      ok: false,
      code: AUTH_ENLACE_CONFLICTO,
      message: expect.any(String),
    });
    // Never overwrite an existing link.
    expect(usuario.updateMany).not.toHaveBeenCalled();
    // A session that cannot be bound must not be left standing.
    expect(supabase.auth.signOut).toHaveBeenCalled();
    // REQ-AUTH-AUD-001 #2 — a rejected login appends NOTHING. Proves the link
    // rejection is not logged as a session action.
    expect(tx.movimientoAuditoria.create).not.toHaveBeenCalled();
  });

  it("maps the partial-index violation (P2002) to a typed duplicate error", async () => {
    const supabase = supabaseWithUser({
      id: SUB_A,
      email: "ana@users.systemfact.internal",
    });
    usuario.findUnique.mockResolvedValueOnce(fila).mockResolvedValueOnce({
      authUserId: null,
    });
    usuario.updateMany.mockRejectedValue(p2002());

    const res = await loginWithCredenciales(asSupabase(supabase), "ana", "pw");

    expect(res).toEqual({
      ok: false,
      code: AUTH_ENLACE_DUPLICADO,
      message: expect.any(String),
    });
    // Translated, never leaked as a raw 500 / P2002 string to the caller.
    expect((res as { message: string }).message).not.toContain("P2002");
    expect(supabase.auth.signOut).toHaveBeenCalled();
    // REQ-AUTH-AUD-001 #2 — a rejected login appends NOTHING, even when the
    // failure happened after Auth had already accepted the credentials.
    expect(tx.movimientoAuditoria.create).not.toHaveBeenCalled();
  });

  it("re-validates the concurrent first-login loser as ok, not conflict", async () => {
    // Two concurrent logins: our CAS update lost the race, but the winner bound
    // the SAME sub. That is a success, not a conflict.
    const supabase = supabaseWithUser({
      id: SUB_A,
      email: "ana@users.systemfact.internal",
    });
    usuario.findUnique
      .mockResolvedValueOnce(fila) // bootstrap
      .mockResolvedValueOnce({ authUserId: null }) // first read: unlinked
      .mockResolvedValueOnce({ authUserId: SUB_A }); // re-read: we lost, same sub
    usuario.updateMany.mockResolvedValue({ count: 0 });

    const res = await loginWithCredenciales(asSupabase(supabase), "ana", "pw");

    expect(res.ok).toBe(true);
  });

  it("rejects inactive users before binding and signs out", async () => {
    const supabase = supabaseWithUser({
      id: SUB_A,
      email: "ana@users.systemfact.internal",
    });
    usuario.findUnique.mockResolvedValue({ ...fila, activo: false });

    const res = await loginWithCredenciales(asSupabase(supabase), "ana", "pw");

    expect(res).toEqual({
      ok: false,
      code: AUTH_USUARIO_INACTIVO,
      message: expect.any(String),
    });
    expect(usuario.updateMany).not.toHaveBeenCalled();
    expect(supabase.auth.signOut).toHaveBeenCalled();
    // REQ-AUTH-AUD-001 #2 — an inactive user produces NO audit row: the log is
    // not polluted with failed-authentication noise, and the `AUTH_USUARIO_INACTIVO`
    // signal stays confined to the response (see auth-service's docblock on why
    // that is not an enumeration oracle).
    expect(tx.movimientoAuditoria.create).not.toHaveBeenCalled();
  });

  it("rejects a missing or inactive USUARIO row without binding", async () => {
    const supabase = supabaseWithUser({
      id: SUB_A,
      email: "ana@users.systemfact.internal",
    });
    usuario.findUnique.mockResolvedValue(null);

    const res = await loginWithCredenciales(asSupabase(supabase), "ana", "pw");

    expect(res.ok).toBe(false);
    expect(usuario.updateMany).not.toHaveBeenCalled();
    expect(supabase.auth.signOut).toHaveBeenCalled();
    // REQ-AUTH-AUD-001 #2 — nothing audited for a row that never resolved.
    expect(tx.movimientoAuditoria.create).not.toHaveBeenCalled();
  });

  it("returns the generic credentials error and never queries when Auth rejects", async () => {
    const supabase = supabaseWithUser({ id: SUB_A, email: "ana@users.systemfact.internal" });
    supabase.auth.signInWithPassword.mockResolvedValue({
      data: { session: null, user: null },
      error: { message: "Invalid login credentials" },
    });

    const res = await loginWithCredenciales(asSupabase(supabase), "ana", "wrong");

    expect(res).toEqual({
      ok: false,
      code: AUTH_CREDENCIALES_INVALIDAS,
      message: expect.any(String),
    });
    // No enumeration side channel: nothing is read or written on failure.
    expect(usuario.findUnique).not.toHaveBeenCalled();
    expect(usuario.updateMany).not.toHaveBeenCalled();
    // REQ-AUTH-AUD-001 #2 — the rejection itself is not recorded. Nothing was
    // authenticated, so there is no actor and nothing to attribute a row to.
    expect(tx.movimientoAuditoria.create).not.toHaveBeenCalled();
  });

  it("rejects a successful Auth sign-in whose sub is unusable (never binds '')", async () => {
    const supabase = supabaseWithUser({ id: "not-a-uuid", email: "ana@users.systemfact.internal" });
    usuario.findUnique.mockResolvedValueOnce(fila).mockResolvedValueOnce({ authUserId: null });

    const res = await loginWithCredenciales(asSupabase(supabase), "ana", "pw");

    expect(res.ok).toBe(false);
    // The critical guard: an unusable sub must not be written as a link.
    expect(usuario.updateMany).not.toHaveBeenCalled();
    expect(supabase.auth.signOut).toHaveBeenCalled();
    // REQ-AUTH-AUD-001 #2 — no session was established, so no row.
    expect(tx.movimientoAuditoria.create).not.toHaveBeenCalled();
  });
});

describe("logout — attribution by sub", () => {
  it("writes nothing when the session has no linked USUARIO row", async () => {
    const supabase = supabaseWithUser({ id: SUB_A, email: null });
    usuario.findFirst.mockResolvedValue(null);

    await logout(asSupabase(supabase));

    expect(supabase.auth.signOut).toHaveBeenCalled();
    // No attributable actor → no audit row. Resolution is by sub (findFirst),
    // never by decoding the email.
    expect(usuario.findUnique).not.toHaveBeenCalled();
    // REQ-AUTH-AUD-001 #4 — asserted on the WRITE PORT, not indirectly on the
    // absence of a lookup. A row written against an unattributable logout would
    // have to invent a `usuarioId`; proving the port is never reached is the
    // only way to prove that cannot happen.
    expect(tx.movimientoAuditoria.create).not.toHaveBeenCalled();
  });

  it("closes the session and resolves the actor by sub", async () => {
    const supabase = supabaseWithUser({ id: SUB_A, email: "ana@users.systemfact.internal" });
    usuario.findFirst.mockResolvedValue({ id: 42, empresaId: 7, activo: true });

    await logout(asSupabase(supabase));

    expect(supabase.auth.signOut).toHaveBeenCalled();
    // Enumerated for the same reason as in `getCurrentUser`: `passwordHash` must
    // not appear, so the select is asserted exactly rather than wildcarded.
    expect(usuario.findFirst.mock.calls[0]?.[0]).toStrictEqual({
      where: { authUserId: SUB_A },
      select: { id: true, empresaId: true, activo: true },
    });
    // `resolverUsuarioDeSesion` pins the login-flow flag for its pre-tenant SELECT.
    expect(loginFlowPins(tx.$executeRaw)).toEqual(["'true'", "'true'"]);
    // REQ-AUTH-AUD-001 #3 — exactly ONE LOGOUT row, attributed to the resolved
    // user AND the empresa that owns them. Asserting `empresaId: 7` is the point:
    // a row written under the wrong tenant's GUC would still pass a naive
    // "some row was written" check.
    expect(tx.movimientoAuditoria.create).toHaveBeenCalledTimes(1);
    expect(auditRows()).toEqual([expectedAuditRow("LOGOUT", 7, 42)]);
    // The standalone audit transaction pins the empresa GUC to the resolved
    // company and nothing else — never widened to a second value.
    expect(empresaGucPins(tx.$executeRaw)).toEqual(["7"]);
  });

  it("ignores an inactive user and still signs out", async () => {
    const supabase = supabaseWithUser({ id: SUB_A, email: "ana@users.systemfact.internal" });
    usuario.findFirst.mockResolvedValue({ id: 42, empresaId: 7, activo: false });

    await logout(asSupabase(supabase));

    expect(supabase.auth.signOut).toHaveBeenCalled();
    // An inactive (or deleted) actor is not attributable for audit purposes:
    // the row would be filed against a disabled account, so nothing is written.
    expect(tx.movimientoAuditoria.create).not.toHaveBeenCalled();
  });
});

describe("RLS GUC pinning — the load-bearing defense-in-depth boundary", () => {
  it("enlazarAuthSub pins app.current_empresa_id to exactly the anchor's empresa", async () => {
    usuario.findUnique.mockResolvedValue({ authUserId: null });

    const res = await enlazarAuthSub({ authSub: SUB_A, usuarioId: 42, empresaId: 7 });

    expect(res.ok).toBe(true);
    // EXACTLY one pin, to empresa 7. A missing pin, a pin to any other company,
    // or a second pin widening the GUC each fail this line.
    expect(empresaGucPins(tx.$executeRaw)).toEqual(["7"]);
    // `usuario_modify` does NOT honor the login-flow flag, so the empresa pin above
    // is what authorizes this UPDATE. The login-flow flag is still pinned because
    // the SELECTs on this same transaction (the two `findUnique` reads above) run
    // under `usuario_select`, which DOES honor it. Losing it fails here.
    expect(loginFlowPins(tx.$executeRaw)).toEqual(["'true'"]);
  });

  it("enlazarAuthSub pins a DIFFERENT empresa when the anchor names one (no hardcoding)", async () => {
    // Guards against a "lucky" assertion: the value must track the anchor, so a
    // regression that hardcodes or ignores `anchor.empresaId` is visible here.
    usuario.findUnique.mockResolvedValue({ authUserId: null });

    const res = await enlazarAuthSub({ authSub: SUB_A, usuarioId: 42, empresaId: 99 });

    expect(res.ok).toBe(true);
    expect(empresaGucPins(tx.$executeRaw)).toEqual(["99"]);
  });

  it("registrarAuditoriaSesion pins the empresa GUC to the anchor's empresa, exactly once", async () => {
    await registrarAuditoriaSesion("LOGIN", { empresaId: 7, usuarioId: 42 });

    // The audit row's own empresaId is pinned before the insert, so the
    // `audit_insert` WITH CHECK can only ever be satisfied for this one company.
    expect(empresaGucPins(tx.$executeRaw)).toEqual(["7"]);
    expect(auditRows()).toEqual([expectedAuditRow("LOGIN", 7, 42)]);
  });

  it("a row belonging to another empresa is never bound (fails closed as unresolved)", async () => {
    // The anchor says empresa 7 but the row lives in empresa 99. The empresaId
    // filter hides it from BOTH the read and the CAS, so the update counts 0 and
    // the re-read (same scope) cannot resolve it either → typed refusal, and
    // critically: no write.
    //
    // The code is AUTH_ENLACE_NO_RESUELTO, NOT AUTH_ENLACE_CONFLICTO: nothing was
    // found to conflict with. Reporting the conflict code told support "your access
    // was recreated" for what is really an unresolvable row.
    usuario.findUnique.mockResolvedValue(null);
    usuario.updateMany.mockResolvedValue({ count: 0 });

    const res = await enlazarAuthSub({ authSub: SUB_A, usuarioId: 42, empresaId: 7 });

    expect(res).toEqual({
      ok: false,
      code: AUTH_ENLACE_NO_RESUELTO,
      message: expect.any(String),
    });
    // Tenant-blind: the user-facing text must not disclose that a row exists in
    // another empresa, nor which one. Fails closed without leaking the boundary.
    const message = (res as { message: string }).message;
    expect(message).not.toMatch(/99|otra empresa|empresa 99/i);
    expect(usuario.findUnique).toHaveBeenNthCalledWith(2, {
      where: { id: 42, empresaId: 7 },
      select: { authUserId: true },
    });
    expect(usuario.updateMany).toHaveBeenCalledWith({
      where: { id: 42, empresaId: 7, authUserId: null },
      data: { authUserId: SUB_A },
    });
  });
});
