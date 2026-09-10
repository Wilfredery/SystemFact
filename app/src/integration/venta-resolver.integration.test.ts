/**
 * Integration — venta client resolver (spec R-V10) + CF→named client swap (R-V3).
 *
 * Real DB. Proves the resolver matrix end-to-end: a contado (null) draft
 * materializes/reuses the empresa's single Consumidor Final row via the 5a seam;
 * a foreign or inactive client id is rejected; and swapping a CF draft to an
 * active named client recomputes totals and appends exactly ONE audit row.
 */

import { Prisma } from "@/generated/prisma/client";
import { withTenantTransaction } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import { crearVenta, actualizarVenta } from "@/modules/venta/application/venta-service";
import { getHarnessDb, seedTenantFixture, type TenantFixture } from "./setup/fixtures";
import { crearProductoVenta, categoriaA } from "./setup/venta-helpers";

const CERO = { descuentoTipo: "PORCENTAJE", descuentoValor: "0.00" } as const;

function ctxA1(f: TenantFixture): TenantCtx {
  return { empresaId: f.empresaA.id, sucursalId: f.sucursalA1.id, usuarioId: f.usuarios.adminA.id, esAdmin: true };
}
async function crearClienteA(empresaId: number, nombre: string, activo: boolean) {
  const db = getHarnessDb();
  return db.cliente.create({
    data: {
      empresaId,
      nombre,
      telefono: "0",
      direccion: "x",
      tipoCliente: "MINORISTA",
      esConsumidorFinal: false,
      creditoHabilitado: false,
      limiteCredito: new Prisma.Decimal(0),
      plazoCreditoDias: 30,
      activo,
    },
  });
}

let fixture: TenantFixture | null = null;

describe("venta client resolver (real DB)", () => {
  let prodA: number;

  beforeEach(async () => {
    fixture = await seedTenantFixture();
    const cat = await categoriaA(fixture.empresaA.id);
    const prod = await crearProductoVenta({
      empresaId: fixture.empresaA.id,
      categoriaId: cat,
      codigo: `RES-${Date.now()}`,
      precioVenta: "100.00",
    });
    prodA = prod.id;
  });

  it("a contado draft materializes the empresa's single CF row", async () => {
    const db = getHarnessDb();
    const ctx = ctxA1(fixture!);
    const r = await withTenantTransaction(ctx, (tx) =>
      crearVenta(tx, ctx, {
        clienteId: null,
        fecha: new Date("2026-01-10T00:00:00.000Z"),
        lineas: [{ productoId: prodA, cantidad: "1", precioUnitario: "100.00", descuento: CERO }],
      }),
    );
    expect(r.ok).toBe(true);
    const cfCount = await db.cliente.count({
      where: { empresaId: fixture!.empresaA.id, esConsumidorFinal: true },
    });
    expect(cfCount).toBe(1);
    if (r.ok) {
      const venta = await db.venta.findUnique({ where: { id: r.data.id } });
      const cf = await db.cliente.findFirst({
        where: { empresaId: fixture!.empresaA.id, esConsumidorFinal: true },
      });
      expect(venta?.clienteId).toBe(cf!.id);
    }
  });

  it("an active named client of the same empresa is accepted", async () => {
    const ctx = ctxA1(fixture!);
    const cliente = await crearClienteA(fixture!.empresaA.id, "Activo", true);
    const r = await withTenantTransaction(ctx, (tx) =>
      crearVenta(tx, ctx, {
        clienteId: cliente.id,
        fecha: new Date("2026-01-10T00:00:00.000Z"),
        lineas: [{ productoId: prodA, cantidad: "1", precioUnitario: "100.00", descuento: CERO }],
      }),
    );
    expect(r.ok).toBe(true);
  });

  it("a cross-tenant client id → CLIENTE_NO_ENCONTRADO (no leakage)", async () => {
    const ctx = ctxA1(fixture!);
    // A client owned by empresa B.
    const db = getHarnessDb();
    const clienteB = await db.cliente.create({
      data: {
        empresaId: fixture!.empresaB.id,
        nombre: "B-client",
        telefono: "0",
        direccion: "x",
        tipoCliente: "MINORISTA",
        esConsumidorFinal: false,
        creditoHabilitado: false,
        limiteCredito: new Prisma.Decimal(0),
        plazoCreditoDias: 30,
      },
    });
    const r = await withTenantTransaction(ctx, (tx) =>
      crearVenta(tx, ctx, {
        clienteId: clienteB.id,
        fecha: new Date("2026-01-10T00:00:00.000Z"),
        lineas: [{ productoId: prodA, cantidad: "1", precioUnitario: "100.00", descuento: CERO }],
      }),
    );
    expect(!r.ok && r.code).toBe("CLIENTE_NO_ENCONTRADO");
  });

  it("an inactive client id → CLIENTE_INACTIVO", async () => {
    const ctx = ctxA1(fixture!);
    const inactivo = await crearClienteA(fixture!.empresaA.id, "Inactivo", false);
    const r = await withTenantTransaction(ctx, (tx) =>
      crearVenta(tx, ctx, {
        clienteId: inactivo.id,
        fecha: new Date("2026-01-10T00:00:00.000Z"),
        lineas: [{ productoId: prodA, cantidad: "1", precioUnitario: "100.00", descuento: CERO }],
      }),
    );
    expect(!r.ok && r.code).toBe("CLIENTE_INACTIVO");
  });

  it("swapping a CF draft to a named client recomputes and appends one audit", async () => {
    const db = getHarnessDb();
    const ctx = ctxA1(fixture!);
    const created = await withTenantTransaction(ctx, (tx) =>
      crearVenta(tx, ctx, {
        clienteId: null, // CF draft
        fecha: new Date("2026-01-10T00:00:00.000Z"),
        lineas: [{ productoId: prodA, cantidad: "1", precioUnitario: "100.00", descuento: CERO }],
      }),
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const id = created.data.id;
    const antes = await db.movimientoAuditoria.count({ where: { entidad: "Venta", idEntidad: String(id) } });
    expect(antes).toBe(1); // CREAR only

    const named = await crearClienteA(fixture!.empresaA.id, "Cambio", true);
    const upd = await withTenantTransaction(ctx, (tx) =>
      actualizarVenta(tx, ctx, {
        id,
        clienteId: named.id,
        fecha: new Date("2026-01-10T00:00:00.000Z"),
        lineas: [{ productoId: prodA, cantidad: "2", precioUnitario: "100.00", descuento: CERO }],
      }),
    );
    expect(upd.ok).toBe(true);
    const venta = await db.venta.findUnique({ where: { id } });
    expect(venta?.clienteId).toBe(named.id);
    expect(venta?.subtotal.toFixed(2)).toBe("200.00"); // recomputed (qty 2)
    expect(
      await db.movimientoAuditoria.count({ where: { entidad: "Venta", idEntidad: String(id) } }),
    ).toBe(2); // + one ACTUALIZAR
  });
});
