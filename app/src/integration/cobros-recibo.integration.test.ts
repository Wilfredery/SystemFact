/**
 * Integration — receipt reprint read (R-C4 + R-C5; real Postgres, RLS on).
 *
 * PROVENANCE: authored for CI, NOT executed locally. The local integration harness
 * is DOWN (no Docker): every file dies at `truncateAll` in `setup-env.ts` before any
 * body runs, exactly as the fase-6 PR-1/PR-2/PR-3 integration suites. The pure
 * `consultarRecibo` mapping (null → `PAGO_NO_ENCONTRADO`, Decimal-string kept) is
 * pinned by `application/consultar-recibo.test.ts`, and the reprint UI is pinned by
 * the jsdom suite; THIS spec is the CI runtime proof that a receipt registered by
 * `registrarCobro` is genuinely readable by its empresa-serialized `correlativoRecibo`
 * (the reprint page's data path) and stays tenant-bound.
 *
 * Proves:
 *   1. A committed collection's correlativo reprints with the persisted facts
 *      (monto/ncf/cliente), money as a Decimal-string — never a float.
 *   2. A number absent for this empresa → `PAGO_NO_ENCONTRADO` (no throw).
 *   3. Tenant isolation: correlativos are per-empresa, so empresa A reading number
 *      1 gets A's own receipt, never empresa B's with the same number (the
 *      `empresaId` pin + the RLS EMPRESA GUC bound it).
 */

import { Prisma } from "@/generated/prisma/client";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import { withTenantTransaction } from "@/modules/tenant/infrastructure/withTenantTransaction";
import { consultarRecibo } from "@/modules/cobros/application/consultar-recibo";
import { registrarCobro } from "@/modules/cobros/application/registrar-cobro";
import { getHarnessDb, seedTenantFixture, type TenantFixture } from "./setup/fixtures";

let fixture: TenantFixture | null = null;
let ctx: TenantCtx;
let ctxB: TenantCtx;

function ctxDe(f: TenantFixture, empresa: "A" | "B"): TenantCtx {
  return empresa === "A"
    ? {
        empresaId: f.empresaA.id,
        sucursalId: f.sucursalA1.id,
        usuarioId: f.usuarios.adminA.id,
        esAdmin: true,
      }
    : {
        empresaId: f.empresaB.id,
        sucursalId: f.sucursalB1.id,
        usuarioId: f.usuarios.adminB.id,
        esAdmin: true,
      };
}

async function crearCliente(empresaId: number, nombre: string): Promise<number> {
  const db = getHarnessDb();
  const c = await db.cliente.create({
    data: {
      empresaId,
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
  return c.id;
}

async function crearFacturaVigente(
  ctxT: TenantCtx,
  clienteId: number,
  ncf: string,
  total: string,
): Promise<number> {
  const db = getHarnessDb();
  const f = await db.factura.create({
    data: {
      empresaId: ctxT.empresaId,
      sucursalId: ctxT.sucursalId,
      clienteId,
      usuarioId: ctxT.usuarioId,
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

function cobrar(ctxT: TenantCtx, facturaId: number, monto: string) {
  return withTenantTransaction(ctxT, (tx) =>
    registrarCobro(tx, ctxT, { facturaId, monto }),
  );
}

function leerRecibo(ctxT: TenantCtx, correlativo: number) {
  return withTenantTransaction(ctxT, (tx) =>
    consultarRecibo(tx, ctxT, { correlativoRecibo: correlativo }),
  );
}

describe("cobros receipt reprint read (real DB, RLS on; R-C4 + R-C5)", () => {
  beforeEach(async () => {
    fixture = await seedTenantFixture();
    ctx = ctxDe(fixture, "A");
    ctxB = ctxDe(fixture, "B");
  });

  it("reprints a committed collection by its correlativo with Decimal-string money", async () => {
    const clienteId = await crearCliente(ctx.empresaId, "Reimprimible SA");
    const facturaId = await crearFacturaVigente(ctx, clienteId, "B01000000020", "7000.00");

    const cobro = await cobrar(ctx, facturaId, "2500.00");
    expect(cobro.ok).toBe(true);
    if (!cobro.ok) throw new Error("el cobro debería comprometerse");

    const recibo = await leerRecibo(ctx, cobro.data.correlativoRecibo);
    expect(recibo.ok).toBe(true);
    if (!recibo.ok) throw new Error("el recibo debería leerse");
    expect(recibo.data.monto).toBe("2500.00"); // string, never a float
    expect(recibo.data.correlativoRecibo).toBe(cobro.data.correlativoRecibo);
    expect(recibo.data.facturaNcf).toBe("B01000000020");
    expect(recibo.data.clienteNombre).toBe("Reimprimible SA");
    expect(recibo.data.tipo).toBe("COBRO");
    expect(recibo.data.estado).toBe("APLICADO");
  });

  it("an absent correlativo → PAGO_NO_ENCONTRADO (stable code, no throw)", async () => {
    const result = await leerRecibo(ctx, 9999);
    expect(result.ok === false && result.code).toBe("PAGO_NO_ENCONTRADO");
  });

  it("tenant isolation: correlativos are per-empresa — A reading number 1 gets A's own receipt", async () => {
    // Empresa A and empresa B each issue a first receipt (both number 1).
    const clienteA = await crearCliente(ctx.empresaId, "Acreedor A");
    const facA = await crearFacturaVigente(ctx, clienteA, "B01000000030", "500.00");
    const rA = await cobrar(ctx, facA, "100.00");

    const clienteB = await crearCliente(ctxB.empresaId, "Acreedor B");
    const facB = await crearFacturaVigente(ctxB, clienteB, "B01000000031", "500.00");
    const rB = await cobrar(ctxB, facB, "200.00");
    if (!rA.ok || !rB.ok) throw new Error("ambos cobros deberían comprometerse");
    // Same serialized number in two empresas (per-empresa counter).
    expect(rA.data.correlativoRecibo).toBe(rB.data.correlativoRecibo);

    const reciboA = await leerRecibo(ctx, rA.data.correlativoRecibo);
    if (!reciboA.ok) throw new Error("el recibo de A debería leerse");
    // Empresa A's read is pinned to A — never B's same-numbered receipt.
    expect(reciboA.data.clienteNombre).toBe("Acreedor A");
    expect(reciboA.data.monto).toBe("100.00");
  });
});
