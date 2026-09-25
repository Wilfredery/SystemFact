/**
 * Integration — audit WRITE port wired into cobros (R-C8, AU-2 #3, AU-3;
 * real Postgres 16, RLS on, `systemfact_app` role).
 *
 * Seeding runs on the trusted superuser harness (bypasses RLS); the code under
 * test (`registrarCobro` / `registrarReembolso`) always runs through the app role
 * inside `withTenantTransaction`, so the `MOVIMIENTO_AUDITORIA` RLS policies
 * (FORCE RLS) apply to every audit INSERT exactly as in production.
 *
 * Proves the spec scenarios:
 *   - a committed collection appends EXACTLY one PAGAR row referencing the new Pago.
 *   - a rejected collection (COBRO_EXCEDE_SALDO) writes NO Pago and NO audit row.
 *   - a first refund audits once; replaying the key stays audit-FLAT (no double
 *     audit — the key is proven fresh before the audit call).
 *   - tenant isolation still holds for the new write: empresa B's admin consultation
 *     sees none of empresa A's PAGAR rows, while empresa A's admin sees exactly them.
 */

import { Prisma } from "@/generated/prisma/client";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import { withTenantTransaction } from "@/modules/tenant/infrastructure/withTenantTransaction";
import {
  COBRO_EXCEDE_SALDO,
  PAGO_IDEMPOTENCIA_CONFLICTO,
} from "@/modules/cobros/domain/errors";
import { registrarCobro } from "@/modules/cobros/application/registrar-cobro";
import { registrarReembolso } from "@/modules/cobros/application/registrar-reembolso";
import { consultarAuditoria } from "@/modules/auditoria/application/consultar-auditoria";
import { getHarnessDb, seedTenantFixture, type TenantFixture } from "./setup/fixtures";

let fixture: TenantFixture | null = null;
let ctx: TenantCtx;

function ctxA1(f: TenantFixture): TenantCtx {
  return {
    empresaId: f.empresaA.id,
    sucursalId: f.sucursalA1.id,
    usuarioId: f.usuarios.adminA.id,
    esAdmin: true,
  };
}

function ctxB1(f: TenantFixture): TenantCtx {
  return {
    empresaId: f.empresaB.id,
    sucursalId: f.sucursalB1.id,
    usuarioId: f.usuarios.adminB.id,
    esAdmin: true,
  };
}

/** Create a CREDITO client for the tenant; returns its id. */
async function crearCliente(nombre: string): Promise<number> {
  const db = getHarnessDb();
  const cliente = await db.cliente.create({
    data: {
      empresaId: ctx.empresaId,
      nombre,
      telefono: "0",
      direccion: "x",
      tipoCliente: "CREDITO",
      creditoHabilitado: true,
      limiteCredito: new Prisma.Decimal("20000.00"),
      plazoCreditoDias: 30,
    },
    select: { id: true },
  });
  return cliente.id;
}

/** Create a VIGENTE invoice with the given total; returns its id. */
async function crearFacturaVigente(
  clienteId: number,
  ncf: string,
  total: string,
): Promise<number> {
  const db = getHarnessDb();
  const f = await db.factura.create({
    data: {
      empresaId: ctx.empresaId,
      sucursalId: ctx.sucursalId,
      clienteId,
      usuarioId: ctx.usuarioId,
      tipoNcf: "B01",
      ncf,
      correlativoInterno: `FAC-${ncf}`,
      estado: "VIGENTE",
      subtotalGravado: new Prisma.Decimal(total),
      itbis: new Prisma.Decimal("0.00"),
      subtotalExento: new Prisma.Decimal("0.00"),
      descuento: new Prisma.Decimal("0.00"),
      total: new Prisma.Decimal(total),
      fechaEmision: new Date("2026-09-01T12:00:00.000Z"),
    },
    select: { id: true },
  });
  return f.id;
}

/** Count persisted PAGAR audit rows for a company on the trusted harness. */
async function contarPagar(empresaId: number): Promise<number> {
  const db = getHarnessDb();
  return db.movimientoAuditoria.count({
    where: { empresaId, accion: "PAGAR" },
  });
}

/** Company-wide admin count of PAGAR rows through the READ path (RLS enforced). */
function leerPagarComoAdmin(adminCtx: TenantCtx): Promise<number> {
  return withTenantTransaction(adminCtx, (tx) =>
    consultarAuditoria(tx, adminCtx, { accion: "PAGAR" }),
  ).then((r) => (r.ok ? r.data.total : -1));
}

function cobrar(facturaId: number, monto: string) {
  return withTenantTransaction(ctx, (tx) =>
    registrarCobro(tx, ctx, { facturaId, monto }),
  );
}

function reembolsar(facturaId: number, monto: string, idempotencyKey: string) {
  return withTenantTransaction(ctx, (tx) =>
    registrarReembolso(tx, ctx, { facturaId, monto, idempotencyKey }),
  );
}

describe("audit write port wired into cobros (real DB, RLS on; R-C8/AU-2/AU-3)", () => {
  beforeEach(async () => {
    fixture = await seedTenantFixture();
    ctx = ctxA1(fixture);
  });

  it("committed cobro appends exactly one PAGAR row referencing the new Pago", async () => {
    const f = fixture!;
    const clienteId = await crearCliente("Acreedor Auditado");
    const facturaId = await crearFacturaVigente(clienteId, "B01000000201", "10000.00");

    expect(await contarPagar(f.empresaA.id)).toBe(0);

    const result = await cobrar(facturaId, "1000.00");
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("el cobro debería comprometerse");

    const rows = await getHarnessDb().movimientoAuditoria.findMany({
      where: { empresaId: f.empresaA.id, accion: "PAGAR" },
      orderBy: { id: "desc" },
    });
    // Exactly one PAGAR row for the committed collection.
    expect(rows).toHaveLength(1);
    const [row] = rows;
    // Correctly scoped: empresa + acting branch/user, company-wide UTC timestamp.
    expect(row!.empresaId).toBe(f.empresaA.id);
    expect(row!.sucursalId).toBe(f.sucursalA1.id);
    expect(row!.usuarioId).toBe(f.usuarios.adminA.id);
    // References the resulting Pago.
    expect(row!.idEntidad).toBe(String(result.data.pagoId));
    expect(row!.entidad).toBe("Pago");
    expect(row!.fechaHora.getTime()).toBeGreaterThan(0);
  });

  it("rejected cobro (COBRO_EXCEDE_SALDO) leaves no Pago and no audit row", async () => {
    const f = fixture!;
    const clienteId = await crearCliente("Acreedor Sobrepago");
    const facturaId = await crearFacturaVigente(clienteId, "B01000000202", "1000.00");

    const result = await cobrar(facturaId, "9999.00");
    expect(!result.ok && result.code).toBe(COBRO_EXCEDE_SALDO);

    // Neither effect persisted — the guard returned before the Pago and audit.
    const db = getHarnessDb();
    expect(await db.pago.count({ where: { empresaId: f.empresaA.id } })).toBe(0);
    expect(await contarPagar(f.empresaA.id)).toBe(0);
  });

  it("first refund audits once; replaying the key keeps the audit row count flat", async () => {
    const f = fixture!;
    const clienteId = await crearCliente("Acreedor Reembolso");
    const facturaId = await crearFacturaVigente(clienteId, "B01000000203", "5000.00");

    // v2r-02: a refund is bound to actually-collected money, so seed a partial
    // cobro FIRST — the pre-guard fixture refunded an unpaid invoice, which the
    // bound now correctly rejects with REEMBOLSO_EXCEDE_SALDO.
    const cobro = await cobrar(facturaId, "2000.00");
    expect(cobro.ok).toBe(true);

    const primero = await reembolsar(facturaId, "500.00", "K-AUDIT");
    expect(primero.ok).toBe(true);
    if (!primero.ok) throw new Error("el primer reembolso debería comprometerse");

    // One Pago + one PAGAR audit row per committed effect (the cobro AND the refund).
    expect(await getHarnessDb().pago.count({ where: { empresaId: f.empresaA.id } })).toBe(2);
    expect(await contarPagar(f.empresaA.id)).toBe(2);

    // Replay: stable conflict, audit count flat (the key gate runs before the audit).
    const replay = await reembolsar(facturaId, "500.00", "K-AUDIT");
    expect(!replay.ok && replay.code).toBe(PAGO_IDEMPOTENCIA_CONFLICTO);
    expect(await getHarnessDb().pago.count({ where: { empresaId: f.empresaA.id } })).toBe(2);
    expect(await contarPagar(f.empresaA.id)).toBe(2);
  });

  it("the new A PAGAR rows are invisible to empresa B's admin consultation", async () => {
    const f = fixture!;
    const clienteId = await crearCliente("Acreedor Aislamiento");
    const facturaId = await crearFacturaVigente(clienteId, "B01000000204", "10000.00");
    const result = await cobrar(facturaId, "2000.00");
    expect(result.ok).toBe(true);

    // A's admin (company-wide branch-GUC cleared) sees its own single PAGAR row…
    expect(await leerPagarComoAdmin(ctxA1(f))).toBe(1);
    // …while B's admin sees none — the empresa pin + RLS hold for the new write.
    expect(await leerPagarComoAdmin(ctxB1(f))).toBe(0);
  });
});
