/**
 * Integration — M4 `producto.listed` dedupe + M2 canonical writer round-trip on
 * the REAL Postgres 16 (RLS on, `systemfact_app`).
 *
 * REQ-PROD-010 scenarios on a real ledger:
 *   - the FIRST listing inside an empty window appends exactly ONE row whose
 *     payload `{count: total}` carries the read's FILTERED total (not
 *     `items.length` — a limit-1 page proves items=1 vs count=2);
 *   - a same-actor second listing INSIDE the window appends NOTHING and the
 *     open row is never mutated (append-only: zero UPDATEs even attempted);
 *   - a DIFFERENT actor inside the same window still appends his own row;
 *   - PROD-010-A `producto.created` stays byte-identical ({codigo, tasa});
 *   - same-transaction semantics: a listing that rolls back aborts its audit
 *     row with it;
 *   - the append-only constraint still rejects an UPDATE attempt (matches 0
 *     rows — RLS has no UPDATE policy on `MOVIMIENTO_AUDITORIA`).
 */

import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import { withTenantTransaction } from "@/modules/tenant/infrastructure/withTenantTransaction";
import { listarProductos } from "@/modules/producto/application/listar-productos";
import { registrarProductoCreadoEnTx } from "@/modules/producto/infrastructure/producto-repository";
import {
  getHarnessDb,
  seedTenantFixture,
  type TenantFixture,
} from "./setup/fixtures";
import type { Prisma } from "@/generated/prisma/client";

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

function listarRows(empresaId: number): Promise<Prisma.MovimientoAuditoria[]> {
  return getHarnessDb().movimientoAuditoria.findMany({
    where: { empresaId, accion: "LEER", entidad: "Producto" },
    orderBy: [{ fechaHora: "desc" }],
  });
}

describe("M4 producto.listed dedupe + M2 canonical writer (real DB, RLS on)", () => {
  beforeEach(async () => {
    fixture = await seedTenantFixture();
  });

  it("first listing in the window appends ONE row; count = the read's filtered total (not items.length)", async () => {
    const f = fixture!;
    // Empresa A seeds exactly 2 active products; limit 1 serves 1 item but
    // reports total 2 — the payload must carry total 2 (obs-1069 semantics).
    await withTenantTransaction(adminA(f), (tx) =>
      listarProductos(tx, adminA(f), { page: 1, limit: 1 }),
    ).then((r) => {
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.data.items).toHaveLength(1);
    });

    const rows = await listarRows(f.empresaA.id);
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.usuarioId).toBe(f.usuarios.adminA.id);
    expect(row.idEntidad).toBe("1");
    expect(row.valorNuevo).toBe(JSON.stringify({ count: 2 }));
  });

  it("second listing by the SAME actor inside the window appends NOTHING (no retro-merge)", async () => {
    const f = fixture!;
    await withTenantTransaction(adminA(f), (tx) =>
      listarProductos(tx, adminA(f), { page: 1, limit: 25 }),
    );
    expect(await listarRows(f.empresaA.id)).toHaveLength(1);

    await withTenantTransaction(adminA(f), (tx) =>
      listarProductos(tx, adminA(f), { page: 2, limit: 25 }),
    );

    const rows = await listarRows(f.empresaA.id);
    expect(rows).toHaveLength(1);
    // Idempotence of the re-listing: exactly the opening read's row remains.
    expect(rows[0]!.valorNuevo).toBe(JSON.stringify({ count: 2 }));
  });

  it("a DIFFERENT actor inside the same window still appends his own row", async () => {
    const f = fixture!;
    await withTenantTransaction(adminA(f), (tx) =>
      listarProductos(tx, adminA(f), { page: 1, limit: 25 }),
    );

    await withTenantTransaction(adminB(f), (tx) =>
      listarProductos(tx, adminB(f), { page: 1, limit: 25 }),
    ).then((r) => {
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.data.total).toBe(1);
    });

    // Empresa A's window is untouched; empresa B has its own row/count.
    expect(await listarRows(f.empresaA.id)).toHaveLength(1);
    const bRows = await listarRows(f.empresaB.id);
    expect(bRows).toHaveLength(1);
    expect(bRows[0]!.usuarioId).toBe(f.usuarios.adminB.id);
    expect(bRows[0]!.valorNuevo).toBe(JSON.stringify({ count: 1 }));
  });

  it("PROD-010-A: producto.created stays byte-identical ({codigo, tasa})", async () => {
    const f = fixture!;
    const productoData = await getHarnessDb().producto.findFirstOrThrow({
      where: { empresaId: f.empresaA.id },
    });
    await withTenantTransaction(adminA(f), (tx) =>
      registrarProductoCreadoEnTx(tx, adminA(f), {
        id: productoData.id,
        codigo: productoData.codigo,
        itbis: { tasa: "18" as const },
      } as Parameters<typeof registrarProductoCreadoEnTx>[2]),
    );

    const rows = await getHarnessDb().movimientoAuditoria.findMany({
      where: {
        empresaId: f.empresaA.id,
        accion: "CREAR",
        entidad: "Producto",
      },
    });
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.accion).toBe("CREAR");
    expect(row.entidad).toBe("Producto");
    expect(row.idEntidad).toBe(String(productoData.id));
    expect(row.valorAnterior).toBeNull();
    expect(row.valorNuevo).toBe(
      JSON.stringify({ codigo: productoData.codigo, tasa: "18" }),
    );
    expect(row.motivo).toBeNull();
  });

  it("same-tx semantics: a listing that rolls back aborts its audit row", async () => {
    const f = fixture!;
    const filasAlVuelo = withTenantTransaction(adminA(f), async (tx) => {
      const r = await listarProductos(tx, adminA(f), { page: 1, limit: 25 });
      expect(r.ok).toBe(true);
      const filas = await tx.movimientoAuditoria.count({
        where: { empresaId: f.empresaA.id, accion: "LEER", entidad: "Producto" },
      });
      expect(filas).toBe(1); // visible inside the SAME tx
      throw new Error("rollback-apostado-del-listado");
    });
    await expect(filasAlVuelo).rejects.toThrow(/rollback/);

    expect(await listarRows(f.empresaA.id)).toHaveLength(0);
  });

  it("append-only constraint: a direct UPDATE attempt on MOVIMIENTO_AUDITORIA is rejected", async () => {
    const f = fixture!;
    await withTenantTransaction(adminA(f), (tx) =>
      listarProductos(tx, adminA(f), { page: 1, limit: 25 }),
    );

    // The ledger is enforced immutable by the DB itself (the
    // `AUDITORIA_INMUTABLE` trigger fires on UPDATE/DELETE) — a direct UPDATE
    // must fail loudly, and the row keeps its original payload untouched.
    await expect(
      getHarnessDb().movimientoAuditoria.updateMany({
        where: { empresaId: f.empresaA.id, entidad: "Producto" },
        data: { motivo: "retro-merge attempt" },
      }),
    ).rejects.toThrow(/AUDITORIA_INMUTABLE|append-only/);

    const rows = await listarRows(f.empresaA.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.motivo).toBeNull();
    expect(rows[0]!.valorNuevo).toBe(JSON.stringify({ count: 2 }));
  });
});
