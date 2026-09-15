/**
 * Integration — collection concurrency (R-C2, R-C4; real Postgres, RLS on).
 *
 * Seeding runs on the trusted superuser harness client (bypasses RLS); the code
 * under test (`registrarCobro`) always runs through the app role inside
 * `withTenantTransaction`, so the RLS GUCs are in force exactly as in production.
 *
 * Proves the two critical concurrency scenarios:
 *   1. (R-C2) Two PARALLEL 8,000.00 collections against a 10,000.00 balance: the
 *      invoice `FOR UPDATE` lock makes each transaction recompute the balance at
 *      its own snapshot, so EXACTLY ONE commits and the other returns
 *      `COBRO_EXCEDE_SALDO`; the derived balance is 2,000.00, never negative.
 *   2. (R-C4) Two PARALLEL collections on DIFFERENT invoices: the `EMPRESA`
 *      row lock serializes the receipt allocation, so the numbers are unique and
 *      consecutive with NO duplicate-key abort.
 */

import { Prisma } from "@/generated/prisma/client";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import { withTenantTransaction } from "@/modules/tenant/infrastructure/withTenantTransaction";
import { consultarSaldoCxcEnTx } from "@/modules/cobros/infrastructure/saldo-cxc.repository";
import { registrarCobro } from "@/modules/cobros/application/registrar-cobro";
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

/** One `registrarCobro` through the real tenant wrapper (returns the typed result). */
function cobrar(facturaId: number, monto: string) {
  return withTenantTransaction(ctx, (tx) =>
    registrarCobro(tx, ctx, { facturaId, monto }),
  );
}

describe("cobros collection concurrency (real DB, RLS on; R-C2 + R-C4)", () => {
  beforeEach(async () => {
    fixture = await seedTenantFixture();
    ctx = ctxA1(fixture);
  });

  it("R-C2: two parallel 8,000.00 cobros on a 10,000.00 balance — one commits, other COBRO_EXCEDE_SALDO, no negative", async () => {
    const clienteId = await crearCliente("Acreedor Paralelo");
    const facturaId = await crearFacturaVigente(clienteId, "B01000000010", "10000.00");

    const settled = await Promise.allSettled([
      cobrar(facturaId, "8000.00"),
      cobrar(facturaId, "8000.00"),
    ]);

    // Business rejections resolve as typed results, never a rejected promise.
    for (const outcome of settled) {
      expect(outcome.status).toBe("fulfilled");
    }
    const results = settled.map(
      (o) => (o as PromiseFulfilledResult<Awaited<ReturnType<typeof registrarCobro>>>).value,
    );
    const exitos = results.filter((r) => r.ok);
    const rechazos = results.filter((r) => !r.ok);
    expect(exitos).toHaveLength(1);
    expect(rechazos).toHaveLength(1);
    expect(rechazos[0] && !rechazos[0].ok ? rechazos[0].code : null).toBe(
      "COBRO_EXCEDE_SALDO",
    );

    const db = getHarnessDb();
    // Exactly one APLICADO cobro persisted, at the committed amount.
    const cobros = await db.pago.findMany({
      where: { facturaId, tipo: "COBRO", estado: "APLICADO" },
    });
    expect(cobros).toHaveLength(1);
    expect(cobros[0].monto.toFixed(2)).toBe("8000.00");

    // The canonical aggregate recomputes 2,000.00 pending — never negative.
    const filas = await withTenantTransaction(ctx, (tx) =>
      consultarSaldoCxcEnTx(tx, ctx),
    );
    expect(filas).toHaveLength(1);
    expect(filas[0].saldoPendiente).toBe("2000.00");
    expect(new Prisma.Decimal(filas[0].saldoPendiente).isNegative()).toBe(false);
  });

  it("R-C4: two parallel cobros on different invoices — unique consecutive receipts, no duplicate-key abort", async () => {
    const clienteId = await crearCliente("Acreedor Multifactura");
    const facA = await crearFacturaVigente(clienteId, "B01000000011", "5000.00");
    const facB = await crearFacturaVigente(clienteId, "B01000000012", "5000.00");

    const [ra, rb] = await Promise.all([
      cobrar(facA, "1000.00"),
      cobrar(facB, "1000.00"),
    ]);
    // Both fit their own balance, so both commit (no rejection expected).
    expect(ra.ok).toBe(true);
    expect(rb.ok).toBe(true);
    if (!ra.ok || !rb.ok) throw new Error("ambos cobros deberían comprometerse");

    const correlativos = [ra.data.correlativoRecibo, rb.data.correlativoRecibo].sort(
      (x, y) => x - y,
    );
    // Unique and consecutive from the empresa counter, with no dup.
    expect(correlativos).toEqual([1, 2]);

    const db = getHarnessDb();
    const pagados = await db.pago.findMany({
      where: { empresaId: ctx.empresaId, tipo: "COBRO", estado: "APLICADO" },
      orderBy: { correlativoRecibo: "asc" },
    });
    expect(pagados).toHaveLength(2);
    expect(pagados.map((p) => p.correlativoRecibo)).toEqual([1, 2]);
  });
});
