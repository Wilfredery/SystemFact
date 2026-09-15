/**
 * Integration — the cobros credit gate over the canonical aggregate
 * (R-K1 + R-K2; real Postgres, RLS on).
 *
 * Proves the two things the unit rules cannot: that the gate's PENDING/mora
 * facts come from the SAME canonical derived-CxC aggregate as the board (so a
 * `REVERTIDO` cobro can never make the credit verdict diverge from the balance),
 * and that the port is the only cross-module surface (`venta` consumes exactly
 * this; the test drives it directly to prove the typed allow/reject contract).
 *
 * Seeding runs on the trusted superuser harness client; the code under test
 * (`evaluarCreditoCliente`) always runs through the app role inside
 * `withTenantTransaction`, so the RLS GUCs are in force exactly as in production.
 */

import { Prisma } from "@/generated/prisma/client";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import { withTenantTransaction } from "@/modules/tenant/infrastructure/withTenantTransaction";
import { evaluarCreditoPort } from "@/modules/cobros/application/credit-port";
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

// A fixed clock so the SD mora window is deterministic (never the wall clock).
const HOY = new Date("2026-03-03T12:00:00.000Z");

interface ClienteOpts {
  limite?: string;
  habilitado?: boolean;
  plazo?: number;
  tipoCliente?: "CREDITO" | "MINORISTA";
  esConsumidorFinal?: boolean;
}

async function crearCliente(nombre: string, opts: ClienteOpts = {}): Promise<number> {
  const db = getHarnessDb();
  const c = await db.cliente.create({
    data: {
      empresaId: ctx.empresaId,
      nombre,
      telefono: "0",
      direccion: "x",
      tipoCliente: opts.tipoCliente ?? "CREDITO",
      esConsumidorFinal: opts.esConsumidorFinal ?? false,
      creditoHabilitado: opts.habilitado ?? true,
      limiteCredito: new Prisma.Decimal(opts.limite ?? "20000.00"),
      plazoCreditoDias: opts.plazo ?? 30,
    },
    select: { id: true },
  });
  return c.id;
}

async function crearFacturaVigente(
  clienteId: number,
  ncf: string,
  total: string,
  fechaEmision: Date,
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
      fechaEmision,
    },
    select: { id: true },
  });
  return f.id;
}

let reciboSeq = 0;
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
      fecha: HOY,
      estado,
      tipo: "COBRO",
      correlativoRecibo: reciboSeq,
    },
  });
}

function evaluar(clienteId: number, totalVenta: string) {
  return withTenantTransaction(ctx, (tx) =>
    evaluarCreditoPort.evaluarCreditoCliente(tx, ctx, { clienteId, totalVenta, fecha: HOY }),
  );
}

type ResultadoPort = Awaited<ReturnType<typeof evaluar>>;

/** Assert the sale IS a credit sale (else fail) and narrow to the `CREDITO` variant. */
function requireCredito(r: ResultadoPort): Extract<ResultadoPort, { forma: "CREDITO" }> {
  if (r.forma !== "CREDITO") throw new Error(`esperado forma CREDITO, recibido ${r.forma}`);
  return r;
}

describe("credit gate over the canonical aggregate (real DB, RLS on; R-K1 + R-K2)", () => {
  beforeEach(async () => {
    fixture = await seedTenantFixture();
    ctx = ctxA1(fixture);
    reciboSeq = 0;
  });

  it("R-K1: port-only coupling — a contado (non-CREDITO) client yields CONTADO, a clean credit client yields a typed allow", async () => {
    const contado = await crearCliente("Contado", { tipoCliente: "MINORISTA" });
    const cf = await crearCliente("Consumidor Final", { esConsumidorFinal: true, tipoCliente: "MINORISTA" });
    const limpio = await crearCliente("Crédito limpio", { limite: "20000.00" });

    // A contado / CF sale is never gated, even at a huge total.
    expect((await evaluar(contado, "50000.00")).forma).toBe("CONTADO");
    expect((await evaluar(cf, "50000.00")).forma).toBe("CONTADO");

    // A clean credit client (no receivables, under limit) → a typed allow.
    expect(requireCredito(await evaluar(limpio, "5000.00")).permitido).toBe(true);
  });

  it("R-K2: over-limit — pending 18,000 + sale 5,000 = 23,000 > 20,000 → LIMITE_CREDITO_EXCEDIDO", async () => {
    const clienteId = await crearCliente("Excedido", { limite: "20000.00", plazo: 0 });
    // plazo 0 → due == emission; keep the invoice fresh so mora (HOY vs emission) is not the reason.
    await crearFacturaVigente(clienteId, "B01000000001", "18000.00", new Date("2026-03-01T12:00:00.000Z"));

    const r = requireCredito(await evaluar(clienteId, "5000.00"));
    expect(r.permitido).toBe(false);
    if (!r.permitido) expect(r.code).toBe("LIMITE_CREDITO_EXCEDIDO");
  });

  it("R-K2: inclusive boundary — pending 15,000 + sale 5,000 = 20,000 = limit → allowed", async () => {
    const clienteId = await crearCliente("Al límite", { limite: "20000.00", plazo: 0 });
    await crearFacturaVigente(clienteId, "B01000000002", "15000.00", new Date("2026-03-01T12:00:00.000Z"));

    expect(requireCredito(await evaluar(clienteId, "5000.00")).permitido).toBe(true);
  });

  it("R-K2: 31-days-overdue unpaid invoice → CLIENTE_EN_MORA (kept under limit so mora is the reason)", async () => {
    const clienteId = await crearCliente("Moroso", { limite: "100000.00", plazo: 30 });
    // Emission 61 days before HOY → due (30d) 31 days before HOY → exactly 31 overdue.
    await crearFacturaVigente(clienteId, "B01000000003", "1000.00", new Date("2026-01-01T12:00:00.000Z"));

    const r = requireCredito(await evaluar(clienteId, "5000.00"));
    expect(r.permitido).toBe(false);
    if (!r.permitido) expect(r.code).toBe("CLIENTE_EN_MORA");
  });

  it("R-K2: exactly 30 days overdue (not more) does NOT block", async () => {
    const clienteId = await crearCliente("Casi moroso", { limite: "100000.00", plazo: 30 });
    // Emission 60 days before HOY → due 30 days before HOY → exactly 30 (not > 30) → not blocking.
    await crearFacturaVigente(clienteId, "B01000000004", "1000.00", new Date("2026-01-02T12:00:00.000Z"));

    expect(requireCredito(await evaluar(clienteId, "5000.00")).permitido).toBe(true);
  });

  it("REVERTIDO excluded from the applied sum so the credit verdict uses the canonical pending", async () => {
    const clienteId = await crearCliente("Con reverso", { limite: "20000.00", plazo: 0 });
    // 20,000 invoice with an 8,000 APLICADO + an 8,000 REVERTIDO → canonical pending 12,000
    // (the REVERTIDO does NOT reduce it). A second source counting REVERTIDO as paid
    // (pending 4,000) would wrongly ALLOW a 9,000 sale.
    const fac = await crearFacturaVigente(clienteId, "B01000000005", "20000.00", new Date("2026-03-01T12:00:00.000Z"));
    await crearCobro(fac, "8000.00", "APLICADO");
    await crearCobro(fac, "8000.00", "REVERTIDO");

    // Sanity: the canonical aggregate itself reports pending 12,000 (REVERTIDO excluded).
    const filas = await withTenantTransaction(ctx, (tx) => consultarSaldoCxcEnTx(tx, ctx));
    expect(filas[0].saldoPendiente).toBe("12000.00");

    // 12,000 + 5,000 = 17,000 ≤ 20,000 → allowed.
    expect(requireCredito(await evaluar(clienteId, "5000.00")).permitido).toBe(true);
    // 12,000 + 9,000 = 21,000 > 20,000 → rejected (proves pending is 12,000, not 4,000).
    const no = requireCredito(await evaluar(clienteId, "9000.00"));
    expect(no.permitido).toBe(false);
    if (!no.permitido) expect(no.code).toBe("LIMITE_CREDITO_EXCEDIDO");
  });
});
