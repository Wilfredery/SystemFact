/**
 * Integration — audit WRITE port on the auth standalone path (REQ-AUTH-AUD-001,
 * AU-2 #13, AU-1; real Postgres 16, RLS on, `systemfact_app` role).
 *
 * The Supabase credential round-trip is REMOTE and cannot run in a real-DB test,
 * so this suite drives the exact standalone mechanism the login/logout paths use:
 * `registrarAuditoriaSesion` (exported for this) → `setLoginFlow` + pin
 * `app.current_empresa_id` + the auditoria write port. That is the security-
 * critical part this requirement actually owns.
 *
 * Proves the spec scenarios:
 *   - a LOGIN write appends one row with the resolved empresaId/usuarioId and
 *     sucursalId NULL (company-wide action) and a UTC fechaHora.
 *   - a LOGOUT write appends one row likewise.
 *   - the standalone write CANNOT target a foreign company: with the session GUC
 *     pinned to A, an insert for B is RLS-rejected (`audit_insert` WITH CHECK) —
 *     the login-flow exception is never widened beyond the single resolved tenant.
 *   - company-wide visibility: A's admin consultation surfaces A's LOGIN row
 *     (sucursalId NULL); another company's admin sees none.
 *   - resolving identity on the login-flow path ALONE writes no audit row — the
 *     row appears only on an explicit successful-session write, so a rejected
 *     login (which returns before that call) leaves the log untouched.
 */

import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import { prisma } from "@/lib/prisma";
import { setLoginFlow } from "@/modules/tenant/infrastructure/tenant-runtime";
import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import { withTenantTransaction } from "@/modules/tenant/infrastructure/withTenantTransaction";
import { registrarEventoAuditoriaEnTx } from "@/modules/auditoria/application/auditoria-write-port";
import { consultarAuditoria } from "@/modules/auditoria/application/consultar-auditoria";
import { registrarAuditoriaSesion } from "@/modules/auth/infrastructure/auth-service";
import { getHarnessDb, seedTenantFixture, type TenantFixture } from "./setup/fixtures";

let fixture: TenantFixture | null = null;

function adminA(f: TenantFixture): TenantCtx {
  return {
    empresaId: f.empresaA.id,
    sucursalId: f.sucursalA1.id,
    usuarioId: f.usuarios.adminA.id,
    esAdmin: true,
  };
}

function adminB(f: TenantFixture): TenantCtx {
  return {
    empresaId: f.empresaB.id,
    sucursalId: f.sucursalB1.id,
    usuarioId: f.usuarios.adminB.id,
    esAdmin: true,
  };
}

async function contarAccion(
  accion: "LOGIN" | "LOGOUT",
  empresaId: number,
): Promise<number> {
  return getHarnessDb().movimientoAuditoria.count({
    where: { empresaId, accion },
  });
}

/** Company-wide admin count of an action through the READ path (RLS enforced). */
function leerComoAdmin(
  adminCtx: TenantCtx,
  accion: "LOGIN" | "LOGOUT",
): Promise<number> {
  return withTenantTransaction(adminCtx, (tx) =>
    consultarAuditoria(tx, adminCtx, { accion }),
  ).then((r) => (r.ok ? r.data.total : -1));
}

describe("audit write port on the auth standalone path (real DB, RLS on; REQ-AUTH-AUD-001)", () => {
  beforeEach(async () => {
    fixture = await seedTenantFixture();
  });

  it("a successful LOGIN appends one company-wide (sucursalId NULL) row", async () => {
    const f = fixture!;
    expect(await contarAccion("LOGIN", f.empresaA.id)).toBe(0);

    await registrarAuditoriaSesion("LOGIN", {
      empresaId: f.empresaA.id,
      usuarioId: f.usuarios.adminA.id,
    });

    const rows = await getHarnessDb().movimientoAuditoria.findMany({
      where: { empresaId: f.empresaA.id, accion: "LOGIN" },
    });
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.empresaId).toBe(f.empresaA.id);
    expect(row.usuarioId).toBe(f.usuarios.adminA.id);
    // A company-wide session action has NO branch.
    expect(row.sucursalId).toBeNull();
    expect(row.entidad).toBe("Sesion");
    expect(row.idEntidad).toBe(String(f.usuarios.adminA.id));
    expect(row.fechaHora.getTime()).toBeGreaterThan(0);
  });

  it("a successful LOGOUT appends one company-wide row", async () => {
    const f = fixture!;
    await registrarAuditoriaSesion("LOGOUT", {
      empresaId: f.empresaA.id,
      usuarioId: f.usuarios.adminA.id,
    });
    expect(await contarAccion("LOGOUT", f.empresaA.id)).toBe(1);
    const row = await getHarnessDb().movimientoAuditoria.findFirst({
      where: { empresaId: f.empresaA.id, accion: "LOGOUT" },
    });
    expect(row!.sucursalId).toBeNull();
    expect(row!.usuarioId).toBe(f.usuarios.adminA.id);
  });

  it("the standalone write CANNOT target a foreign company (single-empresa RLS pin)", async () => {
    const f = fixture!;
    // Session pinned to empresa A, but the anchor claims empresa B: the RLS
    // `audit_insert` WITH CHECK (empresa GUC = empresaId) must reject it, proving
    // the login-flow exception never widens beyond the one resolved company.
    await expect(
      prisma.$transaction(async (tx) => {
        await setLoginFlow(tx);
        await tx.$executeRaw`SELECT set_config('app.current_empresa_id', ${String(
          f.empresaA.id,
        )}, true)`;
        await registrarEventoAuditoriaEnTx(tx as PrismaTx, {
          empresaId: f.empresaB.id,
          usuarioId: f.usuarios.adminB.id,
        }, {
          accion: "LOGIN",
          entidad: "Sesion",
          idEntidad: String(f.usuarios.adminB.id),
          sucursalId: null,
        });
      }),
    ).rejects.toThrow();

    // No cross-company row leaked in.
    expect(await contarAccion("LOGIN", f.empresaB.id)).toBe(0);
  });

  it("empresa A's admin sees its own LOGIN row; another company's admin sees none", async () => {
    const f = fixture!;
    await registrarAuditoriaSesion("LOGIN", {
      empresaId: f.empresaA.id,
      usuarioId: f.usuarios.adminA.id,
    });
    // The sucursalId-NULL company-wide row surfaces to A's admin (branch GUC cleared).
    expect(await leerComoAdmin(adminA(f), "LOGIN")).toBe(1);
    // …and is invisible to B's admin.
    expect(await leerComoAdmin(adminB(f), "LOGIN")).toBe(0);
  });

  it("resolving identity on the login-flow path ALONE writes no audit row", async () => {
    const f = fixture!;
    // Mirrors a REJECTED login: the identity lookup runs (login-flow), but the
    // explicit success write never happens → the log stays empty (no unauthenticated
    // noise / enumeration side-channel).
    await prisma.$transaction(async (tx) => {
      await setLoginFlow(tx);
      await tx.usuario.findUnique({
        where: { nombreUsuario: f.usuarios.adminA.nombreUsuario },
        select: { id: true, empresaId: true, activo: true },
      });
    });
    expect(await contarAccion("LOGIN", f.empresaA.id)).toBe(0);
  });
});
