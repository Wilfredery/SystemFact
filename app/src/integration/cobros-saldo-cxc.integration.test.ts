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
import {
  bloquearYCalcularSaldoFacturaEnTx,
  consultarSaldoCxcEnTx,
} from "@/modules/cobros/infrastructure/saldo-cxc.repository";
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

/** Create a REEMBOLSO pago (cash refund) against the invoice. */
async function crearReembolso(facturaId: number, monto: string): Promise<void> {
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
      fecha: new Date("2026-09-07T12:00:00.000Z"),
      estado: "APLICADO",
      tipo: "REEMBOLSO",
      correlativoRecibo: reciboSeq,
      autorizadoPor: ctx.usuarioId,
      idempotencyKey: `test-reembolso-${reciboSeq}`,
    },
  });
}

/** Create a VIGENTE credit note (base monto + separate ITBIS, as the
 *  devolucion module persists them); unique NCF per empresa. */
async function crearNotaCredito(
  facturaOriginalId: number,
  ncf: string,
  monto: string,
  itbis: string,
): Promise<void> {
  const db = getHarnessDb();
  await db.notaCredito.create({
    data: {
      facturaOriginalId,
      empresaId: ctx.empresaId,
      sucursalId: ctx.sucursalId,
      clienteId: (
        await db.factura.findUniqueOrThrow({
          where: { id: facturaOriginalId },
          select: { clienteId: true },
        })
      ).clienteId,
      usuarioId: ctx.usuarioId,
      ncf,
      estado: "VIGENTE",
      motivo: "devolucion total",
      monto: new Prisma.Decimal(monto),
      itbis: new Prisma.Decimal(itbis),
      fechaEmision: new Date("2026-09-06T12:00:00.000Z"),
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

  it("fully cobrado CONTADO invoice with a full devolucion B04 nets to saldo 0.00, never negative", async () => {
    // The 2026-11-17 devolucion finding: the B04 persists monto (base 150.00)
    // and itbis (27.00) separately while the COBRO is ITBIS-inclusive (177.00).
    // The canonical balance must credit monto + itbis so the saldo lands at 0.
    const clienteId = await crearCliente("Contado Devuelto");
    const vigente = await crearFactura(clienteId, "B01000000003", "VIGENTE", "177.00");
    await crearCobro(vigente, "177.00", "APLICADO");
    await crearNotaCredito(vigente, "B04000000001", "150.00", "27.00");
    await crearReembolso(vigente, "177.00");

    const filas = await withTenantTransaction(ctx, (tx) =>
      consultarSaldoCxcEnTx(tx, ctx),
    );
    expect(filas).toHaveLength(1);
    const [fila] = filas;
    expect(fila.cobrosAplicados).toBe("177.00");
    expect(fila.ajustesCredito).toBe("177.00");
    expect(fila.ajustesDebito).toBe("0.00");
    expect(fila.saldoPendiente).toBe("0.00"); // 177 − 177 + 177 − 177
  });

  it("bloquearYCalcularSaldoFacturaEnTx recomputes saldo with the credit note ITBIS included", async () => {
    const clienteId = await crearCliente("Nota Parcial");
    const vigente = await crearFactura(clienteId, "B01000000004", "VIGENTE", "177.00");
    await crearCobro(vigente, "100.00", "APLICADO");
    await crearNotaCredito(vigente, "B04000000002", "50.00", "9.00");
    await crearReembolso(vigente, "40.00");

    const saldo = await withTenantTransaction(ctx, (tx) =>
      bloquearYCalcularSaldoFacturaEnTx(tx, ctx, vigente),
    );

    expect(saldo).not.toBeNull();
    expect(saldo!.saldoPendiente).toBe("58.00"); // 177 − 100 + 40 − (50 + 9)
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
