/**
 * Integration — canonical derived CxC balance (R-B1, real Postgres, RLS on).
 *
 * Seeding runs on the trusted superuser harness client (bypasses RLS); the code
 * under test (`consultarSaldoCxcEnTx`) runs through the app role inside
 * `withTenantTransaction`, so the RLS GUCs are in force exactly as in production.
 *
 * Proves the two spec scenarios in one fixture:
 *   1. Mixed APLICADO/REVERTIDO — a 10,000.00 VIGENTE invoice with a 4,000.00
 *      COBRO/APLICADO and a 3,000.00 COBRO/REVERTIDO derives pending = 6,000.00
 *      (the REVERTIDO cobro is excluded from the applied sum).
 *   2. Non-current invoices excluded — an ANULADA invoice for the SAME client
 *      never appears; only the VIGENTE invoice is returned.
 */

import { Prisma } from "@/generated/prisma/client";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import { withTenantTransaction } from "@/modules/tenant/infrastructure/withTenantTransaction";
import { consultarSaldoCxcEnTx } from "@/modules/cobros/infrastructure/saldo-cxc.repository";
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

let reciboSeq = 0;

/** Create a CLIENTE (CREDITO) for the tenant; returns its id. */
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

/** Create a FACTURA with the given state/total; returns its id. */
async function crearFactura(
  clienteId: number,
  ncf: string,
  estado: "VIGENTE" | "ANULADA",
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
      estado,
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

/** Create a Pago (COBRO) in a given lifecycle state; unique receipt per empresa. */
async function crearCobro(
  facturaId: number,
  monto: string,
  estado: "APLICADO" | "REVERTIDO",
): Promise<void> {
  const db = getHarnessDb();
  reciboSeq += 1;
  await db.pago.create({
    data: {
      facturaId,
      empresaId: ctx.empresaId,
      sucursalId: ctx.sucursalId,
      usuarioId: ctx.usuarioId,
      metodoPago: "EFECTIVO",
      monto: new Prisma.Decimal(monto),
      fecha: new Date("2026-09-05T12:00:00.000Z"),
      estado,
      tipo: "COBRO",
      correlativoRecibo: reciboSeq,
    },
  });
}

describe("canonical derived CxC balance (real DB, RLS on, R-B1)", () => {
  beforeEach(async () => {
    fixture = await seedTenantFixture();
    ctx = ctxA1(fixture);
    reciboSeq = 0;
  });

  it("mixed APLICADO/REVERTIDO derives 6,000.00 on a 10,000.00 invoice; ANULADA excluded", async () => {
    const clienteId = await crearCliente("Acreedor Mixto");
    const vigente = await crearFactura(clienteId, "B01000000001", "VIGENTE", "10000.00");
    await crearFactura(clienteId, "B01000000002", "ANULADA", "5000.00");

    await crearCobro(vigente, "4000.00", "APLICADO");
    await crearCobro(vigente, "3000.00", "REVERTIDO"); // excluded from applied

    const filas = await withTenantTransaction(ctx, (tx) =>
      consultarSaldoCxcEnTx(tx, ctx),
    );

    // Only the VIGENTE invoice appears; the ANULADA one is excluded.
    expect(filas).toHaveLength(1);
    const [fila] = filas;
    expect(fila.facturaId).toBe(vigente);
    expect(fila.clienteId).toBe(clienteId);

    // Money is Decimal-string across the whole boundary (never a float).
    expect(fila.total).toBe("10000.00");
    expect(fila.cobrosAplicados).toBe("4000.00"); // the 3,000 REVERTIDO excluded
    expect(fila.ajustesCredito).toBe("0.00");
    expect(fila.ajustesDebito).toBe("0.00");
    expect(fila.saldoPendiente).toBe("6000.00");
  });

  it("returns nothing for a tenant with no VIGENTE invoices and never leaks cross-tenant rows", async () => {
    // A receivable seeded under empresa B must not surface for empresa A's ctx.
    const db = getHarnessDb();
    const empresaB = fixture!.empresaB.id;
    const clienteB = await db.cliente.create({
      data: {
        empresaId: empresaB,
        nombre: "Cliente B",
        telefono: "0",
        direccion: "x",
        tipoCliente: "CREDITO",
        creditoHabilitado: true,
        limiteCredito: new Prisma.Decimal("1000.00"),
        plazoCreditoDias: 30,
      },
      select: { id: true },
    });
    await db.factura.create({
      data: {
        empresaId: empresaB,
        sucursalId: fixture!.sucursalB1.id,
        clienteId: clienteB.id,
        usuarioId: fixture!.usuarios.adminB.id,
        tipoNcf: "B01",
        ncf: "B01000000099",
        correlativoInterno: "FAC-99",
        estado: "VIGENTE",
        subtotalGravado: new Prisma.Decimal("900.00"),
        itbis: new Prisma.Decimal("0.00"),
        subtotalExento: new Prisma.Decimal("0.00"),
        descuento: new Prisma.Decimal("0.00"),
        total: new Prisma.Decimal("900.00"),
        fechaEmision: new Date("2026-09-01T12:00:00.000Z"),
      },
    });

    // empresa A has no invoices of its own in this scenario.
    const filas = await withTenantTransaction(ctx, (tx) =>
      consultarSaldoCxcEnTx(tx, ctx),
    );
    expect(filas).toEqual([]);
  });
});
