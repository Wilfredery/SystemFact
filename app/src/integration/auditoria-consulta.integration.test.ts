/**
 * Integration — Auditoria consultation read path (real Postgres 16, RLS on).
 *
 * Seeding runs on the trusted superuser harness client (bypasses RLS), exactly
 * like `cobros-saldo-cxc.integration.test.ts`. The code under test
 * (`consultarAuditoria` → `consultarAuditoriaEnTx`) runs through the app role
 * (`systemfact_app`) inside `withTenantTransaction`, so the RLS GUCs are in
 * force as in production and the `MOVIMIENTO_AUDITORIA` policies (FORCE RLS)
 * apply to every read.
 *
 * Proves the spec scenarios:
 *   - cross-tenant isolation: empresa A never sees a single empresa-B row.
 *   - admin gate: a non-admin ctx → AUDITORIA_NO_AUTORIZADO, before any read.
 *   - company-wide read: clearing the branch GUC surfaces A1, A2 AND the
 *     enterprise rows (sucursalId IS NULL) to an admin pinned to A1.
 *   - combined filters (accion ∧ usuario ∧ Santo-Domingo day) narrow correctly.
 *   - free text never searches the JSON payload (valorAnterior/valorNuevo).
 *   - pagination: page 2 = rows 26–50 (25/page), 500 → 100 clamp over 250 rows.
 *   - a page past the end returns an empty page, total intact, no error.
 *   - empty result → total 0, totalPages 0.
 *   - append-only: an app-role UPDATE/DELETE is rejected with AUDITORIA_INMUTABLE
 *     by the statement-level append-only trigger (migration 20260918).
 */

import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import { withTenantTransaction } from "@/modules/tenant/infrastructure/withTenantTransaction";
import {
  AUDITORIA_NO_AUTORIZADO,
  AUDITORIA_VALIDACION,
} from "@/modules/auditoria/domain/errors";
import {
  consultarAuditoria,
  type AuditoriaResult,
} from "@/modules/auditoria/application/consultar-auditoria";
import type {
  AuditoriaFiltroEntrada,
  AuditoriaPagina,
} from "@/modules/auditoria/domain/auditoria";
import { getHarnessDb, seedTenantFixture, type TenantFixture } from "./setup/fixtures";

let fixture: TenantFixture | null = null;

/** Tenant context for the given branch/user flags (Admin by default). */
function ctxDe(
  f: TenantFixture,
  opts: { sucursalId: number; usuarioId: number; esAdmin: boolean; empresaId?: number },
): TenantCtx {
  return {
    empresaId: opts.empresaId ?? f.empresaA.id,
    sucursalId: opts.sucursalId,
    usuarioId: opts.usuarioId,
    esAdmin: opts.esAdmin,
  };
}

/** Admin context for empresa A, branch A1 (esAdmin true). */
function adminA1(f: TenantFixture): TenantCtx {
  return ctxDe(f, {
    sucursalId: f.sucursalA1.id,
    usuarioId: f.usuarios.adminA.id,
    esAdmin: true,
  });
}

interface SeedAud {
  readonly empresaId: number;
  readonly sucursalId: number | null;
  readonly usuarioId: number;
  readonly accion: "CREAR" | "PAGAR" | "LEER";
  readonly fechaHora: Date;
  readonly entidad?: string;
  readonly idEntidad?: string;
  readonly valorAnterior?: string | null;
  readonly valorNuevo?: string | null;
  readonly motivo?: string | null;
}

/** Insert one MOVIMIENTO_AUDITORIA row on the trusted harness (RLS bypassed). */
async function crearAuditoria(s: SeedAud): Promise<number> {
  const db = getHarnessDb();
  const created = await db.movimientoAuditoria.create({
    data: {
      empresaId: s.empresaId,
      sucursalId: s.sucursalId,
      usuarioId: s.usuarioId,
      accion: s.accion,
      fechaHora: s.fechaHora,
      entidad: s.entidad ?? "Producto",
      idEntidad: s.idEntidad ?? "1",
      valorAnterior: s.valorAnterior ?? null,
      valorNuevo: s.valorNuevo ?? null,
      motivo: s.motivo ?? null,
    },
    select: { id: true },
  });
  return created.id;
}

/** Run the read use case through the app role inside a real tenant tx. */
function leer(
  ctx: TenantCtx,
  entrada: AuditoriaFiltroEntrada,
): Promise<AuditoriaResult<AuditoriaPagina>> {
  return withTenantTransaction(ctx, (tx) => consultarAuditoria(tx, ctx, entrada));
}

describe("auditoria consultation read path (real DB, RLS on, fase-7a slice B)", () => {
  beforeEach(async () => {
    fixture = await seedTenantFixture();
  });

  it("empresa A never sees a single empresa-B row (empresaId pin + RLS)", async () => {
    const f = fixture!;
    await crearAuditoria({
      empresaId: f.empresaA.id,
      sucursalId: f.sucursalA1.id,
      usuarioId: f.usuarios.adminA.id,
      accion: "CREAR",
      fechaHora: new Date("2026-03-01T12:00:00.000Z"),
    });
    // Three empresa-B rows must be invisible to A's admin context.
    for (const hora of ["12", "13", "14"]) {
      await crearAuditoria({
        empresaId: f.empresaB.id,
        sucursalId: f.sucursalB1.id,
        usuarioId: f.usuarios.adminB.id,
        accion: "CREAR",
        fechaHora: new Date(`2026-03-01T${hora}:00:00.000Z`),
      });
    }

    const result = await leer(adminA1(f), {});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.total).toBe(1);
    expect(result.data.filas).toHaveLength(1);
    expect(result.data.filas[0]!.empresaId).toBe(f.empresaA.id);
  });

  it("non-admin is refused with AUDITORIA_NO_AUTORIZADO before any read", async () => {
    const f = fixture!;
    // A row exists; the gate must still refuse without reading it.
    await crearAuditoria({
      empresaId: f.empresaA.id,
      sucursalId: f.sucursalA1.id,
      usuarioId: f.usuarios.adminA.id,
      accion: "LEER",
      fechaHora: new Date("2026-03-01T12:00:00.000Z"),
    });
    const noAdmin = ctxDe(f, {
      sucursalId: f.sucursalA1.id,
      usuarioId: f.usuarios.adminA.id,
      esAdmin: false,
    });

    const result = await leer(noAdmin, {});
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(AUDITORIA_NO_AUTORIZADO);
  });

  it("company-wide read: branch GUC cleared → A1, A2 and enterprise (NULL) rows", async () => {
    const f = fixture!;
    // Admin is pinned to A1, but the audit view spans the whole company.
    await crearAuditoria({
      empresaId: f.empresaA.id,
      sucursalId: f.sucursalA1.id,
      usuarioId: f.usuarios.adminA.id,
      accion: "CREAR",
      fechaHora: new Date("2026-03-01T12:00:00.000Z"),
    });
    await crearAuditoria({
      empresaId: f.empresaA.id,
      sucursalId: f.sucursalA2.id,
      usuarioId: f.usuarios.adminA.id,
      accion: "CREAR",
      fechaHora: new Date("2026-03-01T13:00:00.000Z"),
    });
    // Enterprise-level row (LOGIN): sucursalId IS NULL.
    await crearAuditoria({
      empresaId: f.empresaA.id,
      sucursalId: null,
      usuarioId: f.usuarios.adminA.id,
      accion: "CREAR",
      fechaHora: new Date("2026-03-01T14:00:00.000Z"),
    });

    const all = await leer(adminA1(f), {});
    expect(all.ok).toBe(true);
    if (!all.ok) return;
    expect(all.data.total).toBe(3);

    // Narrowing to A2 must drop the A1 and enterprise rows.
    const soloA2 = await leer(adminA1(f), { sucursalId: f.sucursalA2.id });
    expect(soloA2.ok).toBe(true);
    if (!soloA2.ok) return;
    expect(soloA2.data.filas).toHaveLength(1);
    expect(soloA2.data.filas[0]!.sucursalId).toBe(f.sucursalA2.id);
  });

  it("combined filters (accion ∧ usuario ∧ SD-day) narrow to the exact subset", async () => {
    const f = fixture!;
    const segundoA = await (async () => {
      const db = getHarnessDb();
      const u = await db.usuario.create({
        data: {
          empresaId: f.empresaA.id,
          sucursalId: f.sucursalA1.id,
          nombre: "Segundo A",
          nombreUsuario: `int2-a-${Date.now()}`,
          passwordHash: "test-hash",
        },
        select: { id: true },
      });
      return u.id;
    })();

    // In-scope: PAGAR by adminA during SD 2026-01-15 (UTC 04:00→next 04:00).
    await crearAuditoria({
      empresaId: f.empresaA.id,
      sucursalId: f.sucursalA1.id,
      usuarioId: f.usuarios.adminA.id,
      accion: "PAGAR",
      fechaHora: new Date("2026-01-15T12:00:00.000Z"),
    });
    // Same day but different accion → excluded.
    await crearAuditoria({
      empresaId: f.empresaA.id,
      sucursalId: f.sucursalA1.id,
      usuarioId: f.usuarios.adminA.id,
      accion: "CREAR",
      fechaHora: new Date("2026-01-15T12:30:00.000Z"),
    });
    // PAGAR but a different user → excluded.
    await crearAuditoria({
      empresaId: f.empresaA.id,
      sucursalId: f.sucursalA1.id,
      usuarioId: segundoA,
      accion: "PAGAR",
      fechaHora: new Date("2026-01-15T13:00:00.000Z"),
    });
    // PAGAR by adminA but SD 2026-01-16 (>= 2026-01-16T04:00Z) → excluded.
    await crearAuditoria({
      empresaId: f.empresaA.id,
      sucursalId: f.sucursalA1.id,
      usuarioId: f.usuarios.adminA.id,
      accion: "PAGAR",
      fechaHora: new Date("2026-01-16T05:00:00.000Z"),
    });

    const result = await leer(adminA1(f), {
      accion: "PAGAR",
      usuarioId: f.usuarios.adminA.id,
      desde: "2026-01-15",
      hasta: "2026-01-15",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.total).toBe(1);
    expect(result.data.filas).toHaveLength(1);
    expect(result.data.filas[0]!.accion).toBe("PAGAR");
    expect(result.data.filas[0]!.usuarioId).toBe(f.usuarios.adminA.id);
  });

  it("free text searches entidad/idEntidad/motivo ONLY — never the JSON payload", async () => {
    const f = fixture!;
    // Row whose ONLY "ALPHA" occurrence is in the payload → must NOT match.
    await crearAuditoria({
      empresaId: f.empresaA.id,
      sucursalId: f.sucursalA1.id,
      usuarioId: f.usuarios.adminA.id,
      accion: "CREAR",
      fechaHora: new Date("2026-03-01T12:00:00.000Z"),
      entidad: "Beta",
      idEntidad: "beta-1",
      valorAnterior: "ALPHA-secret-payload",
      valorNuevo: "ALPHA-new",
      motivo: "beta motive",
    });
    // Row with "ALPHA" in a searchable field (entidad) → must match.
    await crearAuditoria({
      empresaId: f.empresaA.id,
      sucursalId: f.sucursalA1.id,
      usuarioId: f.usuarios.adminA.id,
      accion: "CREAR",
      fechaHora: new Date("2026-03-01T13:00:00.000Z"),
      entidad: "ALPHA-visible",
      idEntidad: "99",
    });

    const result = await leer(adminA1(f), { texto: "ALPHA" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.total).toBe(1);
    expect(result.data.filas[0]!.entidad).toBe("ALPHA-visible");
    // The payload row is definitively excluded from the search.
    expect(result.data.filas.some((r) => r.entidad === "Beta")).toBe(false);
  });

  it("pagination: 250 rows — page 2 = rows 26–50 (25/page); pageSize 500 → 100 clamp", async () => {
    const f = fixture!;
    // 250 rows, strictly increasing fechaHora + id → newest-first is reverse
    // insertion order: rank 1 = id 250, rank 25 = id 226 (page 1), rank 26 =
    // id 225 … rank 50 = id 201 (page 2).
    const base = Date.UTC(2026, 2, 1, 0, 0, 0);
    for (let i = 0; i < 250; i += 1) {
      await crearAuditoria({
        empresaId: f.empresaA.id,
        sucursalId: f.sucursalA1.id,
        usuarioId: f.usuarios.adminA.id,
        accion: "CREAR",
        fechaHora: new Date(base + i * 60_000),
      });
    }

    // Page 2 at 25/page → the 26th–50th newest rows.
    const pagina2 = await leer(adminA1(f), { page: 2, pageSize: 25 });
    expect(pagina2.ok).toBe(true);
    if (!pagina2.ok) return;
    expect(pagina2.data.total).toBe(250);
    expect(pagina2.data.pageSize).toBe(25);
    expect(pagina2.data.page).toBe(2);
    expect(pagina2.data.filas).toHaveLength(25);
    // Ids are strictly descending (newest-first) and cover ranks 26–50.
    const idsPagina2 = pagina2.data.filas.map((r) => r.id);
    expect([...idsPagina2].sort((a, b) => b - a)).toEqual(idsPagina2);
    const pagina1 = await leer(adminA1(f), { page: 1, pageSize: 25 });
    expect(pagina1.ok).toBe(true);
    if (!pagina1.ok) return;
    const idsPagina1 = pagina1.data.filas.map((r) => r.id);
    // Page 1 is entirely newer than page 2 (no overlap, correct DESC offset).
    expect(Math.min(...idsPagina1)).toBeGreaterThan(Math.max(...idsPagina2));

    // Oversized page size is clamped to 100, never accepted (AC-2).
    const clampeada = await leer(adminA1(f), { page: 1, pageSize: 500 });
    expect(clampeada.ok).toBe(true);
    if (!clampeada.ok) return;
    expect(clampeada.data.pageSize).toBe(100);
    expect(clampeada.data.total).toBe(250);
    expect(clampeada.data.totalPages).toBe(3); // ceil(250/100)
    expect(clampeada.data.filas).toHaveLength(100);
  });

  it("page past the end returns an empty page with total intact (no error)", async () => {
    const f = fixture!;
    for (const hora of ["12", "13", "14"]) {
      await crearAuditoria({
        empresaId: f.empresaA.id,
        sucursalId: f.sucursalA1.id,
        usuarioId: f.usuarios.adminA.id,
        accion: "CREAR",
        fechaHora: new Date(`2026-03-01T${hora}:00:00.000Z`),
      });
    }

    const result = await leer(adminA1(f), { page: 99, pageSize: 25 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.filas).toEqual([]);
    expect(result.data.total).toBe(3);
    expect(result.data.page).toBe(99);
  });

  it("empty result → total 0, totalPages 0, no error", async () => {
    const f = fixture!;
    const result = await leer(adminA1(f), {});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.filas).toEqual([]);
    expect(result.data.total).toBe(0);
    expect(result.data.totalPages).toBe(0);
  });

  it("rejects an unknown accion as AUDITORIA_VALIDACION (transport guard)", async () => {
    const f = fixture!;
    const result = await leer(adminA1(f), { accion: "BORRAR" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(AUDITORIA_VALIDACION);
  });

  it("append-only: an app-role UPDATE/DELETE is RLS-denied (0 rows affected)", async () => {
    const f = fixture!;
    await crearAuditoria({
      empresaId: f.empresaA.id,
      sucursalId: f.sucursalA1.id,
      usuarioId: f.usuarios.adminA.id,
      accion: "CREAR",
      fechaHora: new Date("2026-03-01T12:00:00.000Z"),
      entidad: "Producto",
      idEntidad: "1",
    });

    // Through the app role inside a tenant tx, the statement-level append-only
    // trigger (20260918_define_audit_appendonly) rejects the mutation outright
    // with AUDITORIA_INMUTABLE (prisma error P2029 wrapping the SQL raise) —
    // the append-only guarantee is explicit, never a silent 0-row no-op.
    const ctx = adminA1(f);
    await expect(
      withTenantTransaction(ctx, async (tx) => {
        await tx.movimientoAuditoria.updateMany({
          where: { empresaId: ctx.empresaId },
          data: { motivo: "tampered" },
        });
      }),
    ).rejects.toThrow(/AUDITORIA_INMUTABLE/);
    await expect(
      withTenantTransaction(ctx, async (tx) => {
        await tx.movimientoAuditoria.deleteMany({
          where: { empresaId: ctx.empresaId },
        });
      }),
    ).rejects.toThrow(/AUDITORIA_INMUTABLE/);

    // The row survives, untouched — the log is append-only at the DB boundary.
    const db = getHarnessDb();
    const restante = await db.movimientoAuditoria.count({
      where: { empresaId: f.empresaA.id },
    });
    expect(restante).toBe(1);
    const fila = await db.movimientoAuditoria.findFirst({
      where: { empresaId: f.empresaA.id },
      select: { motivo: true },
    });
    expect(fila?.motivo).toBeNull();
  });
});
