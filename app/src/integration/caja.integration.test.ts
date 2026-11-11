/**
 * Integration — Caja daily close / day summary against real Postgres (RLS on,
 * `systemfact_app` role; odd/tasks/caja.md T5, S8).
 *
 * Seeding runs on the trusted superuser harness client (bypasses RLS), exactly like every other
 * integration suite. The code under test (`consultarCierreDiario` / `consultarResumenDia`) runs
 * through the app role inside `withTenantTransaction`, so the RLS GUCs are in force as in
 * production.
 *
 * Proves the checklist T2 (S6) handed to T5 — the facts a mocked repository can never establish:
 *
 *   - TENANT ISOLATION through RLS: another empresa's COBRO/REEMBOLSO/VENTA rows of the same day
 *     are NEVER counted, even though they physically exist in the same database.
 *   - ADMIN WIDEN: an Administrador reads company-wide (`conSucursalAmpliadaEnTx`, branch GUC
 *     cleared) so A1 + A2 are summed, while a branch-pinned caller of the same empresa sees only
 *     its own branch.
 *   - HALF-OPEN SD WINDOW: a payment at 03:59Z belongs to the PREVIOUS Santo-Domingo day and one
 *     at 04:00Z to the current one — proven by reading the SAME rows from two "now" instants.
 *   - PAGO filters: only `APLICADO` counts; `REGISTRADO` and `REVERTIDO` are excluded for both
 *     COBRO and REEMBOLSO, and `REEMBOLSO` reduces the corte as a magnitude.
 *   - VENTA filters: only `CONFIRMADA` counts; `BORRADOR` and `CANCELADA` contribute neither to
 *     facturado nor to the cost of goods sold.
 *   - 06b cost: Σ (cantidad × Producto.costoPromedio) over the day's confirmed sale lines, with the
 *     margin figures the pure domain derives from it.
 *
 * Every test is order-independent (the shared setup truncates all tables before each test) and
 * seeds its own fixtures, so nothing here depends on another suite's rows.
 */

import { Prisma } from "@/generated/prisma/client";
import { Decimal } from "decimal.js";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import { withTenantTransaction } from "@/modules/tenant/infrastructure/withTenantTransaction";
import { consultarCierreDiario } from "@/modules/caja/application/consultar-cierre-diario";
import { consultarResumenDia } from "@/modules/caja/application/consultar-resumen-dia";
import { getHarnessDb, seedTenantFixture, type TenantFixture } from "./setup/fixtures";

let fixture: TenantFixture | null = null;

/**
 * A fixed midday-UTC instant → 15 Apr 2026, 10:00 in America/Santo_Domingo. Its close window is
 * `[2026-04-15T04:00Z, 2026-04-16T04:00Z)`, the boundary the day-window test walks.
 */
const AHORA = new Date("2026-04-15T14:00:00.000Z");

/** Monotonic counter so NCF / recibo UNIQUE constraints never collide. */
let CONTADOR = 0;
const seq = (): number => {
  CONTADOR += 1;
  return CONTADOR;
};

function adminCtx(
  f: TenantFixture,
  sucursalId: number,
  empresaId: number = f.empresaA.id,
  usuarioId: number = f.usuarios.adminA.id,
): TenantCtx {
  return { empresaId, sucursalId, usuarioId, esAdmin: true };
}

/** A plain CONTADO client of `empresaId` (sales only need a resolved buyer). */
async function crearCliente(empresaId: number): Promise<number> {
  const db = getHarnessDb();
  const c = await db.cliente.create({
    data: {
      empresaId,
      nombre: `Cliente caja ${empresaId}-${seq()}`,
      telefono: "0",
      direccion: "x",
      tipoCliente: "MINORISTA",
      esConsumidorFinal: false,
      identificacionFiscal: null,
      creditoHabilitado: false,
      limiteCredito: new Prisma.Decimal(0),
      plazoCreditoDias: 0,
    },
    select: { id: true },
  });
  return c.id;
}

/** A VIGENTE invoice of `empresaId` (a PAGO row always hangs off one). */
async function crearFactura(opts: {
  empresaId: number;
  sucursalId: number;
  usuarioId: number;
  clienteId: number;
  total: string;
  fechaEmision: Date;
}): Promise<number> {
  const db = getHarnessDb();
  const total = new Prisma.Decimal(opts.total);
  const ncf = `B01${String(seq()).padStart(9, "0")}`;
  const fac = await db.factura.create({
    data: {
      empresaId: opts.empresaId,
      sucursalId: opts.sucursalId,
      usuarioId: opts.usuarioId,
      clienteId: opts.clienteId,
      tipoNcf: "B01",
      ncf,
      correlativoInterno: ncf,
      estado: "VIGENTE",
      subtotalGravado: total,
      itbis: new Prisma.Decimal(0),
      subtotalExento: new Prisma.Decimal(0),
      descuento: new Prisma.Decimal(0),
      total,
      fechaEmision: opts.fechaEmision,
    },
    select: { id: true },
  });
  return fac.id;
}

/** One PAGO row with an explicit estado/tipo/fecha (the filters under test). */
async function crearPago(opts: {
  empresaId: number;
  sucursalId: number;
  usuarioId: number;
  facturaId: number;
  monto: string;
  fecha: Date;
  estado?: "REGISTRADO" | "APLICADO" | "REVERTIDO";
  tipo?: "COBRO" | "REEMBOLSO";
}): Promise<void> {
  const db = getHarnessDb();
  await db.pago.create({
    data: {
      facturaId: opts.facturaId,
      empresaId: opts.empresaId,
      sucursalId: opts.sucursalId,
      usuarioId: opts.usuarioId,
      metodoPago: "EFECTIVO",
      monto: new Prisma.Decimal(opts.monto),
      fecha: opts.fecha,
      estado: opts.estado ?? "APLICADO",
      tipo: opts.tipo ?? "COBRO",
      autorizadoPor: null,
      correlativoRecibo: seq(),
    },
  });
}

/** An active product of `empresaId` with an explicit `costoPromedio` (the 06b cost basis). */
async function crearProducto(
  empresaId: number,
  costoPromedio: string,
  precioVenta: string,
): Promise<number> {
  const db = getHarnessDb();
  const categoria = await db.categoria.create({
    data: { empresaId, nombre: `cat-caja-${seq()}` },
    select: { id: true },
  });
  const p = await db.producto.create({
    data: {
      empresaId,
      categoriaId: categoria.id,
      nombre: `Producto caja ${seq()}`,
      codigo: `PC-${seq()}`,
      codigoBarras: `BC-${seq()}`,
      unidadMedida: "u",
      unidadEmpaque: "c",
      stockMinimo: 0,
      precioCompra: new Prisma.Decimal(costoPromedio),
      precioVenta: new Prisma.Decimal(precioVenta),
      costoPromedio: new Prisma.Decimal(costoPromedio),
      tasaItbis: new Prisma.Decimal(0),
      itbisVigenteDesde: new Date("2026-01-01T00:00:00.000Z"),
      activo: true,
    },
    select: { id: true },
  });
  return p.id;
}

/** One sale with its detail lines; `total` is the Σ of the lines (no ITBIS in these fixtures). */
async function crearVenta(opts: {
  empresaId: number;
  sucursalId: number;
  usuarioId: number;
  clienteId: number;
  fecha: Date;
  estado?: "BORRADOR" | "CONFIRMADA" | "CANCELADA";
  lineas: readonly { productoId: number; cantidad: string; precioUnitario: string }[];
}): Promise<number> {
  const db = getHarnessDb();
  const total = opts.lineas.reduce(
    (acc, l) => acc.plus(new Decimal(l.cantidad).times(new Decimal(l.precioUnitario))),
    new Decimal(0),
  );
  const totalDecimal = new Prisma.Decimal(total.toFixed(2));
  const v = await db.venta.create({
    data: {
      empresaId: opts.empresaId,
      sucursalId: opts.sucursalId,
      usuarioId: opts.usuarioId,
      clienteId: opts.clienteId,
      fecha: opts.fecha,
      estado: opts.estado ?? "CONFIRMADA",
      subtotal: totalDecimal,
      descuento: new Prisma.Decimal(0),
      descuentoTipo: "PORCENTAJE",
      itbis: new Prisma.Decimal(0),
      total: totalDecimal,
      detalles: {
        create: opts.lineas.map((l) => ({
          productoId: l.productoId,
          cantidad: new Prisma.Decimal(l.cantidad),
          precioUnitario: new Prisma.Decimal(l.precioUnitario),
          descuentoLinea: new Prisma.Decimal(0),
          descuentoTipo: "PORCENTAJE" as const,
          tasaItbis: new Prisma.Decimal(0),
          itbisLinea: new Prisma.Decimal(0),
          subtotalLinea: new Prisma.Decimal(
            new Decimal(l.cantidad).times(new Decimal(l.precioUnitario)).toFixed(2),
          ),
        })),
      },
    },
    select: { id: true },
  });
  return v.id;
}

/** Ensure a ROL row exists and return its id (`nombre` is not unique in the schema). */
async function rolId(nombre: string): Promise<number> {
  const db = getHarnessDb();
  const existente = await db.rol.findFirst({ where: { nombre } });
  if (existente !== null) return existente.id;
  const creado = await db.rol.create({
    data: { nombre, descripcion: `${nombre} (caja integration)` },
    select: { id: true },
  });
  return creado.id;
}

/** A branch-pinned, non-Administrador identity of `empresaId` (the session context shape). */
async function crearUsuarioNoAdmin(
  f: TenantFixture,
  empresaId: number,
  sucursalId: number,
  rolNombre: string,
): Promise<number> {
  const db = getHarnessDb();
  const rid = await rolId(rolNombre);
  const u = await db.usuario.create({
    data: {
      empresaId,
      sucursalId,
      nombre: `${rolNombre} ${empresaId}-${sucursalId}`,
      nombreUsuario: `caja-${rolNombre.toLowerCase()}-${empresaId}-${sucursalId}-${seq()}`,
      passwordHash: "test-hash",
      roles: { create: { rolId: rid } },
    },
    select: { id: true },
  });
  return u.id;
}

/** The close's figures for one "now" instant, inside the caller's tenant transaction. */
async function leerCierre(ctx: TenantCtx, ahora: Date = AHORA) {
  return withTenantTransaction(ctx, (tx) => consultarCierreDiario(tx, ctx, ahora));
}

describe("caja integration — daily close (real DB, RLS on)", () => {
  beforeEach(async () => {
    fixture = await seedTenantFixture();
  });

  it("another empresa's PAGO/VENTA rows of the same day are NEVER counted (RLS + tenant pin)", async () => {
    const f = fixture!;
    const clienteA = await crearCliente(f.empresaA.id);
    const clienteB = await crearCliente(f.empresaB.id);
    // Empresa A: one cash receipt of 100 and one sale of 250 today.
    const facA = await crearFactura({
      empresaId: f.empresaA.id,
      sucursalId: f.sucursalA1.id,
      usuarioId: f.usuarios.adminA.id,
      clienteId: clienteA,
      total: "250.00",
      fechaEmision: AHORA,
    });
    await crearPago({
      empresaId: f.empresaA.id,
      sucursalId: f.sucursalA1.id,
      usuarioId: f.usuarios.adminA.id,
      facturaId: facA,
      monto: "100.00",
      fecha: AHORA,
    });
    const prodA = await crearProducto(f.empresaA.id, "10.00", "250.00");
    await crearVenta({
      empresaId: f.empresaA.id,
      sucursalId: f.sucursalA1.id,
      usuarioId: f.usuarios.adminA.id,
      clienteId: clienteA,
      fecha: AHORA,
      lineas: [{ productoId: prodA, cantidad: "1.000", precioUnitario: "250.00" }],
    });

    // Empresa B: the same kind of rows, SAME day, much larger amounts.
    const facB = await crearFactura({
      empresaId: f.empresaB.id,
      sucursalId: f.sucursalB1.id,
      usuarioId: f.usuarios.adminB.id,
      clienteId: clienteB,
      total: "88888.00",
      fechaEmision: AHORA,
    });
    await crearPago({
      empresaId: f.empresaB.id,
      sucursalId: f.sucursalB1.id,
      usuarioId: f.usuarios.adminB.id,
      facturaId: facB,
      monto: "99999.00",
      fecha: AHORA,
    });
    await crearPago({
      empresaId: f.empresaB.id,
      sucursalId: f.sucursalB1.id,
      usuarioId: f.usuarios.adminB.id,
      facturaId: facB,
      monto: "5000.00",
      fecha: AHORA,
      tipo: "REEMBOLSO",
    });
    const prodB = await crearProducto(f.empresaB.id, "1.00", "88888.00");
    await crearVenta({
      empresaId: f.empresaB.id,
      sucursalId: f.sucursalB1.id,
      usuarioId: f.usuarios.adminB.id,
      clienteId: clienteB,
      fecha: AHORA,
      lineas: [{ productoId: prodB, cantidad: "1.000", precioUnitario: "88888.00" }],
    });

    // The foreign rows really exist (so the exclusion below is the tenant pin, not an absent row).
    const db = getHarnessDb();
    expect(await db.pago.count({ where: { empresaId: f.empresaB.id } })).toBe(2);
    expect(await db.venta.count({ where: { empresaId: f.empresaB.id } })).toBe(1);

    const ctx = adminCtx(f, f.sucursalA1.id);
    const r = await leerCierre(ctx);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.totalCobrado).toBe("100.00");
    expect(r.data.totalFacturado).toBe("250.00");
    expect(r.data.efectivoEsperado).toBe("100.00");
    // No B payment method group leaked in either.
    expect(r.data.metodos).toHaveLength(1);
    expect(r.data.metodos[0]?.cantidad).toBe(1);
  });

  it("an Admin reads company-wide (widen) while a branch-pinned caller stays on its branch", async () => {
    const f = fixture!;
    const clienteA = await crearCliente(f.empresaA.id);
    const facA1 = await crearFactura({
      empresaId: f.empresaA.id,
      sucursalId: f.sucursalA1.id,
      usuarioId: f.usuarios.adminA.id,
      clienteId: clienteA,
      total: "200.00",
      fechaEmision: AHORA,
    });
    await crearPago({
      empresaId: f.empresaA.id,
      sucursalId: f.sucursalA1.id,
      usuarioId: f.usuarios.adminA.id,
      facturaId: facA1,
      monto: "100.00",
      fecha: AHORA,
    });
    const prodA1 = await crearProducto(f.empresaA.id, "0.00", "200.00");
    await crearVenta({
      empresaId: f.empresaA.id,
      sucursalId: f.sucursalA1.id,
      usuarioId: f.usuarios.adminA.id,
      clienteId: clienteA,
      fecha: AHORA,
      lineas: [{ productoId: prodA1, cantidad: "1.000", precioUnitario: "200.00" }],
    });

    const facA2 = await crearFactura({
      empresaId: f.empresaA.id,
      sucursalId: f.sucursalA2.id,
      usuarioId: f.usuarios.adminA.id,
      clienteId: clienteA,
      total: "400.00",
      fechaEmision: AHORA,
    });
    await crearPago({
      empresaId: f.empresaA.id,
      sucursalId: f.sucursalA2.id,
      usuarioId: f.usuarios.adminA.id,
      facturaId: facA2,
      monto: "300.00",
      fecha: AHORA,
    });
    const prodA2 = await crearProducto(f.empresaA.id, "0.00", "400.00");
    await crearVenta({
      empresaId: f.empresaA.id,
      sucursalId: f.sucursalA2.id,
      usuarioId: f.usuarios.adminA.id,
      clienteId: clienteA,
      fecha: AHORA,
      lineas: [{ productoId: prodA2, cantidad: "1.000", precioUnitario: "400.00" }],
    });

    // Administrador assigned to A1 → the whole empresa (A1 + A2), never another tenant.
    const admin = await leerCierre(adminCtx(f, f.sucursalA1.id));
    expect(admin.ok).toBe(true);
    if (!admin.ok) return;
    expect(admin.data.totalCobrado).toBe("400.00"); // 100 + 300
    expect(admin.data.totalFacturado).toBe("600.00"); // 200 + 400

    // Branch-pinned non-Admin of the SAME empresa at A1 → only A1.
    const operadorId = await crearUsuarioNoAdmin(f, f.empresaA.id, f.sucursalA1.id, "Operador");
    const pinned: TenantCtx = {
      empresaId: f.empresaA.id,
      sucursalId: f.sucursalA1.id,
      usuarioId: operadorId,
      esAdmin: false,
    };
    const propio = await leerCierre(pinned);
    expect(propio.ok).toBe(true);
    if (!propio.ok) return;
    expect(propio.data.totalCobrado).toBe("100.00");
    expect(propio.data.totalFacturado).toBe("200.00");
  });

  it("03:59Z belongs to the PREVIOUS SD day and 04:00Z to the current one (half-open window)", async () => {
    const f = fixture!;
    const clienteA = await crearCliente(f.empresaA.id);
    const fac = await crearFactura({
      empresaId: f.empresaA.id,
      sucursalId: f.sucursalA1.id,
      usuarioId: f.usuarios.adminA.id,
      clienteId: clienteA,
      total: "1000.00",
      fechaEmision: AHORA,
    });
    // 23:59 SD on the 14th (03:59Z on the 15th) and the FIRST instant of the 15th (04:00Z).
    const ultimoInstanteDia14 = new Date("2026-04-15T03:59:00.000Z");
    const primerInstanteDia15 = new Date("2026-04-15T04:00:00.000Z");

    await crearPago({
      empresaId: f.empresaA.id,
      sucursalId: f.sucursalA1.id,
      usuarioId: f.usuarios.adminA.id,
      facturaId: fac,
      monto: "10.00",
      fecha: ultimoInstanteDia14,
    });
    await crearPago({
      empresaId: f.empresaA.id,
      sucursalId: f.sucursalA1.id,
      usuarioId: f.usuarios.adminA.id,
      facturaId: fac,
      monto: "20.00",
      fecha: primerInstanteDia15,
    });
    const prod = await crearProducto(f.empresaA.id, "0.00", "11.00");
    await crearVenta({
      empresaId: f.empresaA.id,
      sucursalId: f.sucursalA1.id,
      usuarioId: f.usuarios.adminA.id,
      clienteId: clienteA,
      fecha: ultimoInstanteDia14,
      lineas: [{ productoId: prod, cantidad: "1.000", precioUnitario: "11.00" }],
    });
    await crearVenta({
      empresaId: f.empresaA.id,
      sucursalId: f.sucursalA1.id,
      usuarioId: f.usuarios.adminA.id,
      clienteId: clienteA,
      fecha: primerInstanteDia15,
      lineas: [{ productoId: prod, cantidad: "2.000", precioUnitario: "11.00" }],
    });

    const ctx = adminCtx(f, f.sucursalA1.id);

    // Standing at 04:00Z-15th (00:00 SD) → the 15th's window; the 03:59Z rows are yesterday's.
    const dia15 = await leerCierre(ctx, primerInstanteDia15);
    expect(dia15.ok).toBe(true);
    if (!dia15.ok) return;
    expect(dia15.data.fechaSD).toBe("2026-04-15");
    expect(dia15.data.totalCobrado).toBe("20.00");
    expect(dia15.data.totalFacturado).toBe("22.00");

    // Standing one minute earlier (23:59 SD on the 14th) → the 14th's window.
    const dia14 = await leerCierre(ctx, ultimoInstanteDia14);
    expect(dia14.ok).toBe(true);
    if (!dia14.ok) return;
    expect(dia14.data.fechaSD).toBe("2026-04-14");
    expect(dia14.data.totalCobrado).toBe("10.00");
    expect(dia14.data.totalFacturado).toBe("11.00");

    // And the 16th's window holds NEITHER (the upper bound is exclusive).
    const dia16 = await leerCierre(ctx, new Date("2026-04-16T04:00:00.000Z"));
    expect(dia16.ok).toBe(true);
    if (!dia16.ok) return;
    expect(dia16.data.fechaSD).toBe("2026-04-16");
    expect(dia16.data.totalCobrado).toBe("0.00");
    expect(dia16.data.totalFacturado).toBe("0.00");
    expect(dia16.data.metodos).toEqual([]);
  });

  it("only APLICADO pagos count: REGISTRADO and REVERTIDO are excluded; REEMBOLSO reduces the corte", async () => {
    const f = fixture!;
    const clienteA = await crearCliente(f.empresaA.id);
    const fac = await crearFactura({
      empresaId: f.empresaA.id,
      sucursalId: f.sucursalA1.id,
      usuarioId: f.usuarios.adminA.id,
      clienteId: clienteA,
      total: "2000.00",
      fechaEmision: AHORA,
    });
    const base = {
      empresaId: f.empresaA.id,
      sucursalId: f.sucursalA1.id,
      usuarioId: f.usuarios.adminA.id,
      facturaId: fac,
      fecha: AHORA,
    } as const;
    await crearPago({ ...base, monto: "100.00", estado: "APLICADO" });
    await crearPago({ ...base, monto: "500.00", estado: "REGISTRADO" });
    await crearPago({ ...base, monto: "700.00", estado: "REVERTIDO" });
    // A cash refund reduces the drawer; a non-applied refund must NOT.
    await crearPago({ ...base, monto: "30.00", estado: "APLICADO", tipo: "REEMBOLSO" });
    await crearPago({ ...base, monto: "999.00", estado: "REGISTRADO", tipo: "REEMBOLSO" });

    // A confirmed sale of 2000 so the Diferencia has a real invoiced figure to subtract.
    const prod = await crearProducto(f.empresaA.id, "0.00", "2000.00");
    await crearVenta({
      empresaId: f.empresaA.id,
      sucursalId: f.sucursalA1.id,
      usuarioId: f.usuarios.adminA.id,
      clienteId: clienteA,
      fecha: AHORA,
      lineas: [{ productoId: prod, cantidad: "1.000", precioUnitario: "2000.00" }],
    });

    const r = await leerCierre(adminCtx(f, f.sucursalA1.id));
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    // Método table: ONE EFECTIVO group, made of the single APLICADO COBRO.
    expect(r.data.metodos).toHaveLength(1);
    expect(r.data.metodos[0]?.metodo).toBe("EFECTIVO");
    expect(r.data.metodos[0]?.cobros).toBe("100.00");
    expect(r.data.metodos[0]?.cantidad).toBe(1);
    expect(r.data.totalCobrado).toBe("100.00");

    // Corte: cobros 100 − devoluciones 30 = esperado 70 (the corte is NOT the Diferencia).
    expect(r.data.corte.cobros).toBe("100.00");
    expect(r.data.corte.devoluciones).toBe("30.00");
    expect(r.data.efectivoEsperado).toBe("70.00");
    // Diferencia stays the documented derivation: cobrado − facturado (kept separate from esperado).
    expect(r.data.diferencia).toBe("-1900.00");
  });

  it("only CONFIRMADA ventas count: BORRADOR and CANCELADA contribute nothing", async () => {
    const f = fixture!;
    const clienteA = await crearCliente(f.empresaA.id);
    const prod = await crearProducto(f.empresaA.id, "10.00", "100.00");
    const linea = [{ productoId: prod, cantidad: "2.000", precioUnitario: "100.00" }];
    const base = {
      empresaId: f.empresaA.id,
      sucursalId: f.sucursalA1.id,
      usuarioId: f.usuarios.adminA.id,
      clienteId: clienteA,
      fecha: AHORA,
    } as const;

    await crearVenta({ ...base, lineas: linea, estado: "CONFIRMADA" }); // 200.00, cost 20.00
    await crearVenta({ ...base, lineas: linea, estado: "BORRADOR" });
    await crearVenta({ ...base, lineas: linea, estado: "CANCELADA" });

    const cierre = await leerCierre(adminCtx(f, f.sucursalA1.id));
    expect(cierre.ok).toBe(true);
    if (!cierre.ok) return;
    expect(cierre.data.totalFacturado).toBe("200.00");

    const ctx = adminCtx(f, f.sucursalA1.id);
    const resumen = await withTenantTransaction(ctx, (tx) => consultarResumenDia(tx, ctx, AHORA));
    expect(resumen.ok).toBe(true);
    if (!resumen.ok) return;
    expect(resumen.data.ventas).toBe("200.00");
    // Only the CONFIRMADA sale's 2 units are costed (2 × 10.00), never the draft/cancelled copies.
    expect(resumen.data.costoVendido).toBe("20.00");
  });

  it("the resumen's costo is Σ(cantidad × costoPromedio) over the confirmed lines, and the margin follows", async () => {
    const f = fixture!;
    const clienteA = await crearCliente(f.empresaA.id);
    const p1 = await crearProducto(f.empresaA.id, "12.50", "30.00");
    const p2 = await crearProducto(f.empresaA.id, "4.00", "8.00");
    // 3 × 12.50 = 37.50 and 2.5 × 4.00 = 10.00 → cost 47.50; sales 3×30 + 2.5×8 = 110.00.
    await crearVenta({
      empresaId: f.empresaA.id,
      sucursalId: f.sucursalA1.id,
      usuarioId: f.usuarios.adminA.id,
      clienteId: clienteA,
      fecha: AHORA,
      lineas: [
        { productoId: p1, cantidad: "3.000", precioUnitario: "30.00" },
        { productoId: p2, cantidad: "2.500", precioUnitario: "8.00" },
      ],
    });

    // Independent computation from the STORED detail rows (never from the code under test).
    const db = getHarnessDb();
    const filas = await db.detalleVenta.findMany({
      select: { cantidad: true, producto: { select: { costoPromedio: true } } },
    });
    const costoCierto = filas
      .reduce(
        (acc, fila) =>
          acc.plus(new Decimal(fila.cantidad.toString()).times(fila.producto.costoPromedio.toString())),
        new Decimal(0),
      )
      .toFixed(2);
    expect(costoCierto).toBe("47.50");

    const ctx = adminCtx(f, f.sucursalA1.id);
    const resumen = await withTenantTransaction(ctx, (tx) => consultarResumenDia(tx, ctx, AHORA));
    expect(resumen.ok).toBe(true);
    if (!resumen.ok) return;

    expect(resumen.data.ventas).toBe("110.00");
    expect(resumen.data.costoVendido).toBe(costoCierto);
    expect(resumen.data.margenBruto).toBe("62.50"); // 110.00 − 47.50
    // 62.50 ÷ 110.00 × 100 = 56.8181… → 56.8 at one decimal (half-up).
    expect(resumen.data.margenPorcentaje).toBe("56.8");

    // A zero day is a real state: no division by zero, no invented figures.
    const vacio = await withTenantTransaction(
      adminCtx(f, f.sucursalA1.id),
      (tx) => consultarResumenDia(tx, adminCtx(f, f.sucursalA1.id), new Date("2026-04-20T14:00:00.000Z")),
    );
    expect(vacio.ok).toBe(true);
    if (!vacio.ok) return;
    expect(vacio.data.ventas).toBe("0.00");
    expect(vacio.data.costoVendido).toBe("0.00");
    expect(vacio.data.margenPorcentaje).toBe("0.0");
  });
});
