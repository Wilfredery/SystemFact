/**
 * Integration — the printable-invoice read (odd/tasks/factura-print.md T1, S3/S4/S5).
 *
 * Real DB, RLS on (same harness as confirmar-venta). The composed read must return
 * EVERYTHING the DGII 254-06 printed invoice needs, from persisted data only:
 * invoice identity (tipoNcf/ncf/correlativoInterno/estado/fechaEmision), the NCF
 * expiry date resolved from the SEQUENCE RANGE that contains the NCF (never the
 * active sequence blindly, never hardcoded), emisor data, client identity, the
 * frozen sale lines, the per-rate ITBIS breakdown (S3), and the ADR-017 derived
 * balance from the cobros canonical query (VIGENTE only).
 */

import { Prisma } from "@/generated/prisma/client";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import { withTenantTransaction } from "@/modules/tenant/infrastructure/withTenantTransaction";
import { crearVenta } from "@/modules/venta/application/venta-service";
import { confirmarVenta } from "@/modules/venta/application/confirmar-venta";
import { consultarFacturaParaImpresion } from "@/modules/venta/application/consultar-factura-impresion";
import { getHarnessDb, seedTenantFixture, type TenantFixture } from "./setup/fixtures";
import { crearProductoVenta, fijarStock } from "./setup/venta-helpers";

const CERO = { descuentoTipo: "PORCENTAJE", descuentoValor: "0.00" } as const;
const VIG_FIN = new Date("2099-12-31T23:59:59.000Z");

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

async function marcarFacturaAutomatica(empresaId: number): Promise<void> {
  await getHarnessDb().empresa.update({ where: { id: empresaId }, data: { facturaAutomatica: true } });
}

async function sembrarRango(
  empresaId: number,
  tipo: "B01" | "B02",
  s: { rangoInicio: number; rangoFin: number; secuenciaActual: number; vigenciaFin?: Date },
): Promise<void> {
  await getHarnessDb().ncfSecuencia.create({
    data: {
      empresaId,
      tipoNcf: tipo,
      rangoInicio: BigInt(s.rangoInicio),
      rangoFin: BigInt(s.rangoFin),
      secuenciaActual: BigInt(s.secuenciaActual),
      vigenciaInicio: new Date("2000-01-01T00:00:00.000Z"),
      vigenciaFin: s.vigenciaFin ?? VIG_FIN,
      activa: true,
    },
  });
}

async function venderYConfirmar(
  productoId: number,
  cantidad: string,
): Promise<{ ventaId: number; facturaId: number }> {
  return withTenantTransaction(ctx, async (tx) => {
    const r = await crearVenta(tx, ctx, {
      clienteId: null,
      fecha: new Date("2026-01-10T00:00:00.000Z"),
      lineas: [{ productoId, cantidad, precioUnitario: "100.00", descuento: CERO }],
      descuentoCabecera: CERO,
    });
    if (!r.ok) throw new Error(`crearVenta falló: ${r.code}`);
    const c = await confirmarVenta(tx, ctx, { id: r.data.id });
    if (!c.ok) throw new Error(`confirmarVenta falló: ${c.code}`);
    const factura = await tx.factura.findFirstOrThrow({ where: { ventaId: r.data.id } });
    return { ventaId: r.data.id, facturaId: factura.id };
  });
}

describe("consultarFacturaParaImpresion (real DB, RLS on, S3/S4/S5)", () => {
  beforeEach(async () => {
    fixture = await seedTenantFixture();
    ctx = ctxA1(fixture);
    await marcarFacturaAutomatica(ctx.empresaId);
  });

  it("returns the DGII print fields for a confirmed VIGENTE invoice, from persisted data", async () => {
    const db = getHarnessDb();
    const catA = (await db.categoria.findFirst({ where: { empresaId: ctx.empresaId } }))!.id;
    // Two products: one at the general 18% rate, one at the reduced 16% rate, so
    // the per-rate breakdown has two buckets; plus NCF range 500-1000 so the
    // consumed NCF's expiry resolves from the containing range.
    const prod18 = await crearProductoVenta({ empresaId: ctx.empresaId, categoriaId: catA, codigo: "FP18", precioVenta: "100.00", tasa: 18 });
    const prod16 = await crearProductoVenta({ empresaId: ctx.empresaId, categoriaId: catA, codigo: "FP16", precioVenta: "50.00", tasa: 16 });
    await fijarStock(ctx.sucursalId, prod18.id, "10.000");
    await fijarStock(ctx.sucursalId, prod16.id, "10.000");
    await sembrarRango(ctx.empresaId, "B02", {
      rangoInicio: 500,
      rangoFin: 1000,
      secuenciaActual: 521,
      vigenciaFin: new Date("2030-06-30T23:59:59.000Z"),
    });

    const { facturaId } = await withTenantTransaction(ctx, async (tx) => {
      const r = await crearVenta(tx, ctx, {
        clienteId: null,
        fecha: new Date("2026-01-10T00:00:00.000Z"),
        lineas: [
          { productoId: prod18.id, cantidad: "2", precioUnitario: "100.00", descuento: CERO },
          { productoId: prod16.id, cantidad: "1", precioUnitario: "50.00", descuento: CERO },
        ],
        descuentoCabecera: CERO,
      });
      if (!r.ok) throw new Error(`crearVenta falló: ${r.code}`);
      const c = await confirmarVenta(tx, ctx, { id: r.data.id });
      if (!c.ok) throw new Error(`confirmarVenta falló: ${c.code}`);
      const factura = await tx.factura.findFirstOrThrow({ where: { ventaId: r.data.id } });
      return { ventaId: r.data.id, facturaId: factura.id };
    });

    const result = await withTenantTransaction(ctx, (tx) =>
      consultarFacturaParaImpresion(tx, ctx, { facturaId }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const vista = result.data;

    // Invoice identity: NCF 522 consumed from the seeded range (521 was current).
    expect(vista.tipoNcf).toBe("B02");
    expect(vista.ncf).toBe("B0200000522");
    expect(vista.estado).toBe("VIGENTE");
    // DGII: NCF expiry date comes from the RANGE containing the NCF, from data.
    expect(vista.ncfVigenciaFin).toBe("2030-06-30");
    expect(vista.fechaEmision).toBeTruthy();

    // Emisor: tenant data (S3), never hardcoded.
    expect(vista.empresa.nombreComercial).toBeTruthy();
    expect(vista.empresa.rnc).toBeTruthy();
    expect(vista.empresa.direccionFiscal).toBeTruthy();

    // Receptor: B02/Consumidor Final → CF client row with no fiscal id.
    expect(vista.cliente.esConsumidorFinal).toBe(true);

    // Lines and money: frozen values, Decimal-as-string.
    expect(vista.lineas).toHaveLength(2);
    expect(Number(vista.total)).toBeCloseTo(2 * 118 + 58, 2);
    expect(vista.subtotalGravado).toBeTruthy();

    // DGII ITBIS desglosado per rate, pure aggregation of the frozen lines.
    expect(vista.desgloseItbis).toEqual(
      expect.arrayContaining([
        { tasa: "18.00", itbis: "36.00" },
        { tasa: "16.00", itbis: "8.00" },
      ]),
    );
    expect(vista.desgloseItbis).toHaveLength(2);

    // ADR-017: balance derived from the cobros canonical query (VIGENTE invoice).
    // A contado B02 sale has its cash COBRO applied at confirm, so the derived
    // saldo is ZERO and the applied cobros equal the total — from the canonical
    // query, never recomputed.
    expect(vista.saldo).not.toBeNull();
    expect(Number(vista.saldo!.saldoPendiente)).toBeCloseTo(0, 2);
    expect(Number(vista.saldo!.cobrosAplicados)).toBeCloseTo(Number(vista.total), 2);
  });

  it("fails CLOSED with FACTURA_NO_ENCONTRADA for a foreign-TENANT invoice (a real empresa-B row)", async () => {
    const db = getHarnessDb();
    // Seed a REAL invoice belonging to empresa B (the #1 project risk is the
    // cross-tenant leak, so the test must exercise an existing foreign row,
    // not just a nonexistent id).
    const clienteB = await db.cliente.create({
      data: {
        empresaId: fixture!.empresaB.id,
        nombre: "Cliente Forbidden B",
        telefono: "0",
        direccion: "x",
        tipoCliente: "MINORISTA",
        esConsumidorFinal: true,
      },
    });
    const usuarioB = await db.usuario.findFirstOrThrow({ where: { empresaId: fixture!.empresaB.id } });
    const sucursalB = await db.sucursal.findFirstOrThrow({ where: { empresaId: fixture!.empresaB.id } });
    const foreign = await db.factura.create({
      data: {
        empresaId: fixture!.empresaB.id,
        sucursalId: sucursalB.id,
        clienteId: clienteB.id,
        usuarioId: usuarioB.id,
        tipoNcf: "B02",
        ncf: "B0299999001",
        correlativoInterno: "F-FORBIDDEN-001",
        estado: "VIGENTE",
        fechaEmision: new Date("2026-01-15T00:00:00.000Z"),
        subtotalGravado: new Prisma.Decimal("100.00"),
        subtotalExento: new Prisma.Decimal("0.00"),
        descuento: new Prisma.Decimal("0.00"),
        itbis: new Prisma.Decimal("18.00"),
        total: new Prisma.Decimal("118.00"),
      },
    });

    const result = await withTenantTransaction(ctx, (tx) =>
      consultarFacturaParaImpresion(tx, ctx, { facturaId: foreign.id }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("FACTURA_NO_ENCONTRADA");
    // The foreign invoice still exists — nothing was mutated by the denied read.
    expect(await db.factura.count({ where: { id: foreign.id, empresaId: fixture!.empresaB.id } })).toBe(1);
  });

  it("a CANCELLED invoice still reads, with estado CANCELADA and no derived balance (S4)", async () => {
    const db = getHarnessDb();
    const catA = (await db.categoria.findFirst({ where: { empresaId: ctx.empresaId } }))!.id;
    const prod = await crearProductoVenta({ empresaId: ctx.empresaId, categoriaId: catA, codigo: "FPC", precioVenta: "100.00", tasa: 18 });
    await fijarStock(ctx.sucursalId, prod.id, "5.000");
    await sembrarRango(ctx.empresaId, "B02", { rangoInicio: 500, rangoFin: 1000, secuenciaActual: 521 });
    const { ventaId, facturaId } = await venderYConfirmar(prod.id, "1");

    // Cancel the sale (CANCELADA: no fiscal effect, never in 607).
    await db.factura.update({ where: { id: facturaId }, data: { estado: "CANCELADA" } });
    await db.venta.update({ where: { id: ventaId }, data: { estado: "CANCELADA" } });

    const result = await withTenantTransaction(ctx, (tx) =>
      consultarFacturaParaImpresion(tx, ctx, { facturaId }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.estado).toBe("CANCELADA");
    expect(result.data.saldo).toBeNull();
  });
});
