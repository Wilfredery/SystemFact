/**
 * Integration — Reportes slice B: operational reports + CSV (real Postgres 16, RLS on,
 * `systemfact_app` role; OP-1..OP-6, EXP-2/EXP-4).
 *
 * Seeding runs on the trusted superuser harness client (bypasses RLS), exactly like the slice-A
 * dashboard suite and `auditoria-consulta.integration.test.ts`. The code under test (the four
 * `consultar*` use cases and `generarCsvOperativo`) runs through the app role inside
 * `withTenantTransaction`, so the RLS GUCs are in force as in production and every admin read
 * funnels through the ratified company-wide widen.
 *
 * Proves the spec scenarios slice B owns:
 *   - OP-1  confirmed-only sales grouped by SD calendar day; CANCELADA excluded; B invisible.
 *   - OP-2  units-first product ranking with the monto tie-break (SQL mirrors the domain rule).
 *   - OP-3  branch-scoped inventory valuation at current `costoPromedio`.
 *   - OP-4  estado × tipoNcf grid with the ADR-017 payment state DERIVED live (never stored).
 *   - OP-5  aggregation pushdown (one grouped result per day, Decimal-string money).
 *   - OP-6  pagination (page/pageSize) + combined filters + clamp.
 *   - EXP-2 CSV carries the FULL filtered dataset independent of screen pages and its detail
 *           sums to the screen summary to the cent (parity guard).
 *   - EXP-4 export shares the consultation gate (Cobrador denied) and reaches no audit model.
 *   - DB-2/DB-6 role denial before any read; NO audit rows written by reports.
 */

import { Prisma } from "@/generated/prisma/client";
import { Decimal } from "decimal.js";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import { withTenantTransaction } from "@/modules/tenant/infrastructure/withTenantTransaction";
import {
  consultarEstadoFacturas,
  consultarInventarioValorizado,
  consultarProductosVendidos,
  consultarVentasPorPeriodo,
} from "@/modules/reportes/application/operacional";
import { generarCsvOperativo } from "@/modules/reportes/application/exportar-operativos";
import { normalizarFiltro } from "@/modules/reportes/domain/reporte-filtro";
import { REPORTE_NO_AUTORIZADO } from "@/modules/reportes/domain/errors";
import { REPORTE_ID } from "@/modules/reportes/domain/catalogo";
import {
  getHarnessDb,
  seedTenantFixture,
  type TenantFixture,
} from "./setup/fixtures";

let fixture: TenantFixture | null = null;

/** A fixed midday-UTC instant → unambiguously inside its own SD calendar day (10:00 SD, 15 Apr). */
const AHORA = new Date("2026-04-15T14:00:00.000Z");
/** A clearly-different SD day: 16 Apr 05:00 UTC = 01:00 SD 16. */
const DIA_SIGUIENTE = new Date("2026-04-16T05:00:00.000Z");

/** Monotonic counter so NCF / correlativo-recibo UNIQUE constraints never collide. */
let CONTADOR = 0;
const seq = (): number => {
  CONTADOR += 1;
  return CONTADOR;
};

function adminCtx(f: TenantFixture, sucursalId: number): TenantCtx {
  return {
    empresaId: f.empresaA.id,
    sucursalId,
    usuarioId: f.usuarios.adminA.id,
    esAdmin: true,
  };
}

/** Ensure a ROL row exists and return its id (nombre is not unique in the schema). */
async function rolId(nombre: string): Promise<number> {
  const db = getHarnessDb();
  let rol = await db.rol.findFirst({ where: { nombre } });
  if (rol === null) {
    rol = await db.rol.create({ data: { nombre, descripcion: `${nombre} (reportes B)` } });
  }
  return rol.id;
}

/** Create a USUARIO holding exactly `rolNombre` in empresa/sucursal. */
async function crearUsuarioConRol(
  f: TenantFixture,
  rolNombre: string,
  sucursalId: number,
  empresaId: number,
): Promise<number> {
  const db = getHarnessDb();
  const rid = await rolId(rolNombre);
  const u = await db.usuario.create({
    data: {
      empresaId,
      sucursalId,
      nombre: `${rolNombre} ${empresaId}-${sucursalId}`,
      nombreUsuario: `repB-${rolNombre.toLowerCase()}-${empresaId}-${sucursalId}-${Date.now()}-${seq()}`,
      passwordHash: "test-hash",
      roles: { create: { rolId: rid } },
    },
    select: { id: true },
  });
  return u.id;
}

async function crearCliente(f: TenantFixture, empresaId: number): Promise<number> {
  const db = getHarnessDb();
  const c = await db.cliente.create({
    data: {
      empresaId,
      nombre: `Cliente-${empresaId}-${seq()}`,
      telefono: "0",
      direccion: "x",
      tipoCliente: "MINORISTA",
      esConsumidorFinal: true,
      limiteCredito: new Prisma.Decimal(0),
      plazoCreditoDias: 0,
    },
    select: { id: true },
  });
  return c.id;
}

/** The empresa's first categoria (seeded by the fixture) for new products. */
async function categoriaDe(empresaId: number): Promise<number> {
  const db = getHarnessDb();
  const cat = await db.categoria.findFirst({ where: { empresaId }, select: { id: true } });
  if (cat === null) throw new Error("fixture categoria missing");
  return cat.id;
}

/** Create a product with an explicit `costoPromedio` (for valuation) and `stockMinimo`. */
async function crearProducto(
  empresaId: number,
  opts: { costoPromedio: string; stockMinimo?: number } = { costoPromedio: "0.00" },
): Promise<number> {
  const db = getHarnessDb();
  const categoriaId = await categoriaDe(empresaId);
  const codigo = `PB-${empresaId}-${seq()}`;
  const p = await db.producto.create({
    data: {
      empresaId,
      categoriaId,
      nombre: codigo,
      codigo,
      codigoBarras: `BC-${codigo}`,
      unidadMedida: "u",
      unidadEmpaque: "c",
      stockMinimo: opts.stockMinimo ?? 0,
      precioCompra: new Prisma.Decimal(0),
      precioVenta: new Prisma.Decimal(0),
      costoPromedio: new Prisma.Decimal(opts.costoPromedio),
      tasaItbis: new Prisma.Decimal(18),
      itbisVigenteDesde: new Date("2000-01-01T00:00:00.000Z"),
    },
    select: { id: true, nombre: true },
  });
  nombreCache.set(p.id, p.nombre);
  return p.id;
}

interface LineaVenta {
  readonly productoId: number;
  readonly cantidad: string;
  readonly subtotalLinea: string;
}

/** Create a `Venta` (default CONFIRMADA) with one or more detail lines; total = Σ line montos. */
async function crearVenta(
  f: TenantFixture,
  opts: {
    empresaId: number;
    sucursalId: number;
    usuarioId: number;
    clienteId: number;
    fecha: Date;
    estado?: "CONFIRMADA" | "CANCELADA" | "BORRADOR";
    lineas: readonly LineaVenta[];
  },
): Promise<number> {
  const db = getHarnessDb();
  const total = opts.lineas.reduce((acc, l) => acc.plus(new Decimal(l.subtotalLinea)), new Decimal(0));
  const v = await db.venta.create({
    data: {
      empresaId: opts.empresaId,
      sucursalId: opts.sucursalId,
      usuarioId: opts.usuarioId,
      clienteId: opts.clienteId,
      fecha: opts.fecha,
      estado: opts.estado ?? "CONFIRMADA",
      subtotal: new Prisma.Decimal(total.toFixed(2)),
      descuento: new Prisma.Decimal(0),
      descuentoTipo: "PORCENTAJE",
      itbis: new Prisma.Decimal(0),
      total: new Prisma.Decimal(total.toFixed(2)),
      detalles: {
        create: opts.lineas.map((l) => ({
          productoId: l.productoId,
          cantidad: new Prisma.Decimal(l.cantidad),
          precioUnitario: new Prisma.Decimal(l.subtotalLinea),
          descuentoLinea: new Prisma.Decimal(0),
          descuentoTipo: "PORCENTAJE",
          tasaItbis: new Prisma.Decimal(0),
          itbisLinea: new Prisma.Decimal(0),
          subtotalLinea: new Prisma.Decimal(l.subtotalLinea),
        })),
      },
    },
    select: { id: true },
  });
  return v.id;
}

/** One CONFIRMADA single-line sale of `monto` at `fecha` (for the day-grouping tests). */
async function crearVentaMonto(
  f: TenantFixture,
  opts: {
    empresaId: number;
    sucursalId: number;
    clienteId: number;
    fecha: Date;
    monto: string;
    estado?: "CONFIRMADA" | "CANCELADA" | "BORRADOR";
  },
): Promise<number> {
  const productoId = await crearProducto(opts.empresaId, { costoPromedio: "0.00" });
  return crearVenta(f, {
    empresaId: opts.empresaId,
    sucursalId: opts.sucursalId,
    usuarioId: f.usuarios.adminA.id,
    clienteId: opts.clienteId,
    fecha: opts.fecha,
    estado: opts.estado,
    lineas: [{ productoId, cantidad: "1.000", subtotalLinea: opts.monto }],
  });
}

/** Set a product's current `costoPromedio` (valuation basis). */
async function fijarCostoPromedio(productoId: number, costo: string): Promise<void> {
  const db = getHarnessDb();
  await db.producto.update({
    where: { id: productoId },
    data: { costoPromedio: new Prisma.Decimal(costo) },
  });
}

/** Create a VIGENTE/CANCELADA invoice with a fixed `fechaEmision`. */
async function crearFactura(
  f: TenantFixture,
  opts: {
    empresaId: number;
    sucursalId: number;
    clienteId: number;
    total: string;
    estado: "VIGENTE" | "CANCELADA";
    tipoNcf?: "B01" | "B02";
    fechaEmision?: Date;
  },
): Promise<number> {
  const db = getHarnessDb();
  const total = new Prisma.Decimal(opts.total);
  const ncf = `${opts.tipoNcf ?? "B01"}${String(seq()).padStart(9, "0")}`;
  const fac = await db.factura.create({
    data: {
      empresaId: opts.empresaId,
      sucursalId: opts.sucursalId,
      usuarioId: f.usuarios.adminA.id,
      clienteId: opts.clienteId,
      tipoNcf: opts.tipoNcf ?? "B01",
      ncf,
      correlativoInterno: ncf,
      estado: opts.estado,
      subtotalGravado: total,
      itbis: new Prisma.Decimal(0),
      subtotalExento: new Prisma.Decimal(0),
      descuento: new Prisma.Decimal(0),
      total,
      fechaEmision: opts.fechaEmision ?? AHORA,
    },
    select: { id: true },
  });
  return fac.id;
}

/** Apply a COBRO/APLICADO payment to an invoice (drives the derived payment state). */
async function crearCobro(
  f: TenantFixture,
  opts: {
    empresaId: number;
    sucursalId: number;
    facturaId: number;
    monto: string;
  },
): Promise<void> {
  const db = getHarnessDb();
  await db.pago.create({
    data: {
      empresaId: opts.empresaId,
      sucursalId: opts.sucursalId,
      usuarioId: f.usuarios.adminA.id,
      facturaId: opts.facturaId,
      metodoPago: "EFECTIVO",
      tipo: "COBRO",
      estado: "APLICADO",
      monto: new Prisma.Decimal(opts.monto),
      fecha: AHORA,
      correlativoRecibo: seq(),
    },
  });
}

/** Settle one invoice to an exact derived pending balance, for the estado-grid fixtures. */
async function facturaConEstadoCobro(
  f: TenantFixture,
  opts: {
    empresaId: number;
    sucursalId: number;
    clienteId: number;
    total: string;
    cobrado: string;
    tipoNcf: "B01" | "B02";
    estado?: "VIGENTE" | "CANCELADA";
  },
): Promise<number> {
  const id = await crearFactura(f, {
    empresaId: opts.empresaId,
    sucursalId: opts.sucursalId,
    clienteId: opts.clienteId,
    total: opts.total,
    estado: opts.estado ?? "VIGENTE",
    tipoNcf: opts.tipoNcf,
  });
  if (new Decimal(opts.cobrado).gt(0)) {
    await crearCobro(f, {
      empresaId: opts.empresaId,
      sucursalId: opts.sucursalId,
      facturaId: id,
      monto: opts.cobrado,
    });
  }
  return id;
}

describe("reportes slice B — operational reports + CSV (real DB, RLS on)", () => {
  beforeEach(async () => {
    fixture = await seedTenantFixture();
  });

  it("OP-1: confirmed-only sales grouped by SD calendar day; CANCELADA excluded; B invisible", async () => {
    const f = fixture!;
    const clienteA = await crearCliente(f, f.empresaA.id);
    const clienteB = await crearCliente(f, f.empresaB.id);
    // A1: two CONFIRMADA on SD day 15, one CANCELADA on day 15, one CONFIRMADA on SD day 16.
    await crearVentaMonto(f, { empresaId: f.empresaA.id, sucursalId: f.sucursalA1.id, clienteId: clienteA, fecha: AHORA, monto: "10.00" });
    await crearVentaMonto(f, { empresaId: f.empresaA.id, sucursalId: f.sucursalA1.id, clienteId: clienteA, fecha: new Date("2026-04-15T21:00:00.000Z"), monto: "20.00" });
    await crearVentaMonto(f, { empresaId: f.empresaA.id, sucursalId: f.sucursalA1.id, clienteId: clienteA, fecha: AHORA, monto: "999.00", estado: "CANCELADA" });
    await crearVentaMonto(f, { empresaId: f.empresaA.id, sucursalId: f.sucursalA1.id, clienteId: clienteA, fecha: DIA_SIGUIENTE, monto: "500.00" });
    // B: a sale at the same instant → never appears in A's report.
    await crearVentaMonto(f, { empresaId: f.empresaB.id, sucursalId: f.sucursalB1.id, clienteId: clienteB, fecha: AHORA, monto: "7777.00" });

    const filtro = normalizarFiltro({ desde: "2026-04-15", hasta: "2026-04-16" });
    const ctx = adminCtx(f, f.sucursalA1.id);
    const r = await withTenantTransaction(ctx, (tx) =>
      consultarVentasPorPeriodo(tx, ctx, filtro),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    // Two SD-day rows, newest first; day 15 = 10 + 20 = 30.00 (CANCELADA excluded), day 16 = 500.00.
    expect(r.data.filas.map((x) => x.fechaSD)).toEqual(["2026-04-16", "2026-04-15"]);
    expect(r.data.filas[0]?.neto).toBe("500.00");
    expect(r.data.filas[1]?.neto).toBe("30.00");
    expect(r.data.filas[1]?.operaciones).toBe(2);
    // Summary is page-independent and excludes CANCELADA + tenant B: 30 + 500 = 530.00, 3 sales.
    expect(r.data.resumen.totalNeto).toBe("530.00");
    expect(r.data.resumen.totalOperaciones).toBe("3");
  });

  it("OP-2: products rank units-first, monto is the secondary tie-break", async () => {
    const f = fixture!;
    const clienteA = await crearCliente(f, f.empresaA.id);
    const X = await crearProducto(f.empresaA.id); // 100u @ 500  (units win)
    const Y = await crearProducto(f.empresaA.id); // 90u  @ 4500 (bigger monto, loses on units)
    const T1 = await crearProducto(f.empresaA.id); // 50u @ 100  (units tie, lower monto)
    const T2 = await crearProducto(f.empresaA.id); // 50u @ 900  (units tie, higher monto)
    await crearVenta(f, {
      empresaId: f.empresaA.id,
      sucursalId: f.sucursalA1.id,
      usuarioId: f.usuarios.adminA.id,
      clienteId: clienteA,
      fecha: AHORA,
      lineas: [
        { productoId: X, cantidad: "100.000", subtotalLinea: "500.00" },
        { productoId: Y, cantidad: "90.000", subtotalLinea: "4500.00" },
        { productoId: T1, cantidad: "50.000", subtotalLinea: "100.00" },
        { productoId: T2, cantidad: "50.000", subtotalLinea: "900.00" },
      ],
    });

    const filtro = normalizarFiltro({});
    const ctx = adminCtx(f, f.sucursalA1.id);
    const r = await withTenantTransaction(ctx, (tx) =>
      consultarProductosVendidos(tx, ctx, filtro),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const nombres = r.data.filas.map((x) => x.nombre);
    // Units decide; among the 50-unit tie, higher monto (T2) precedes T1. X beats Y despite monto.
    const [xName, yName, t1Name, t2Name] = [X, Y, T1, T2].map((id) => nombreDe(id));
    expect(nombres).toEqual([xName, yName, t2Name, t1Name]);
    // Both figures survive (units-first primary, monto secondary column rendered).
    const y = r.data.filas.find((x) => x.nombre === yName);
    expect(y?.unidades).toBe("90.000");
    expect(y?.monto).toBe("4500.00");
  });

  it("OP-3: per-branch stock valorized at current costoPromedio, scoped to the filtered branch", async () => {
    const f = fixture!;
    // prodA1 lives in A1 (10.000 units) — valor 10 × 4.00 = 40.00.
    await fijarCostoPromedio(f.productos.prodA1.id, "4.00");
    // prodA2Only lives in A2 (5.000 units) — must NOT appear when filtered to A1.
    await fijarCostoPromedio(f.productos.prodA2Only.id, "2.00");

    const filtro = normalizarFiltro({ sucursalId: f.sucursalA1.id });
    const ctx = adminCtx(f, f.sucursalA1.id);
    const r = await withTenantTransaction(ctx, (tx) =>
      consultarInventarioValorizado(tx, ctx, filtro),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    // Only A1's line; valuation = cantidad × costoPromedio as Decimal-string.
    expect(r.data.filas).toHaveLength(1);
    expect(r.data.filas[0]?.cantidad).toBe("10.000");
    expect(r.data.filas[0]?.costoPromedio).toBe("4.00");
    expect(r.data.filas[0]?.valor).toBe("40.00");
    expect(r.data.filas[0]?.estadoStock).toBe("NORMAL");
    // The page-independent summary reuses the canonical rollup → same 40.00.
    expect(r.data.resumen.valor).toBe("40.00");
  });

  it("OP-4: estado × tipoNcf grid with payment state DERIVED live (never materialized)", async () => {
    const f = fixture!;
    const clienteA = await crearCliente(f, f.empresaA.id);
    // (VIGENTE,B01): one unpaid → pendiente, one 40/100 → parcial.
    await facturaConEstadoCobro(f, { empresaId: f.empresaA.id, sucursalId: f.sucursalA1.id, clienteId: clienteA, total: "100.00", cobrado: "0.00", tipoNcf: "B01" });
    await facturaConEstadoCobro(f, { empresaId: f.empresaA.id, sucursalId: f.sucursalA1.id, clienteId: clienteA, total: "100.00", cobrado: "40.00", tipoNcf: "B01" });
    // (VIGENTE,B02): fully collected → pagada.
    await facturaConEstadoCobro(f, { empresaId: f.empresaA.id, sucursalId: f.sucursalA1.id, clienteId: clienteA, total: "50.00", cobrado: "50.00", tipoNcf: "B02" });
    // (CANCELADA,B01): no payment state applies.
    await facturaConEstadoCobro(f, { empresaId: f.empresaA.id, sucursalId: f.sucursalA1.id, clienteId: clienteA, total: "30.00", cobrado: "0.00", tipoNcf: "B01", estado: "CANCELADA" });

    const filtro = normalizarFiltro({});
    const ctx = adminCtx(f, f.sucursalA1.id);
    const r = await withTenantTransaction(ctx, (tx) =>
      consultarEstadoFacturas(tx, ctx, filtro),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const celda = (estado: string, tipo: string) =>
      r.data.filas.find((c) => c.estado === estado && c.tipoNcf === tipo);

    expect(celda("VIGENTE", "B01")).toMatchObject({ facturas: 2, monto: "200.00", pendientes: 1, parciales: 1, pagadas: 0 });
    expect(celda("VIGENTE", "B02")).toMatchObject({ facturas: 1, monto: "50.00", pendientes: 0, parciales: 0, pagadas: 1 });
    expect(celda("CANCELADA", "B01")).toMatchObject({ facturas: 1, monto: "30.00", pendientes: 0, parciales: 0, pagadas: 0 });
    // Grand summary = Σ cells: 4 invoices, 280.00, 1 pendiente + 1 parcial + 1 pagada.
    expect(r.data.resumen.totalFacturas).toBe("4");
    expect(r.data.resumen.totalMonto).toBe("280.00");
    expect(r.data.resumen.pendientes).toBe("1");
    expect(r.data.resumen.parciales).toBe("1");
    expect(r.data.resumen.pagadas).toBe("1");

    // "never materialized": the FACTURA table has no stored payment-state / balance column.
    const columnas = await getHarnessDb().$queryRaw<{ nombre: string }[]>`
      SELECT "column_name" AS nombre FROM information_schema.columns
      WHERE "table_name" = 'FACTURA'`;
    const prohibidas = columnas.filter((c) => /cobro|pago|saldo|estado_cobro|pagad/i.test(c.nombre));
    expect(prohibidas).toEqual([]);
  });

  it("OP-5/OP-6: aggregation returns one row per SD day, and page/pageSize paginates them", async () => {
    const f = fixture!;
    const clienteA = await crearCliente(f, f.empresaA.id);
    await crearVentaMonto(f, { empresaId: f.empresaA.id, sucursalId: f.sucursalA1.id, clienteId: clienteA, fecha: AHORA, monto: "30.00" });
    await crearVentaMonto(f, { empresaId: f.empresaA.id, sucursalId: f.sucursalA1.id, clienteId: clienteA, fecha: DIA_SIGUIENTE, monto: "500.00" });

    const ctx = adminCtx(f, f.sucursalA1.id);
    // One page of size 1 → the newest SD day only; total reflects BOTH days.
    const filtro1 = normalizarFiltro({ page: 1, pageSize: 1 });
    const r1 = await withTenantTransaction(ctx, (tx) => consultarVentasPorPeriodo(tx, ctx, filtro1));
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    expect(r1.data.filas).toHaveLength(1);
    expect(r1.data.filas[0]?.fechaSD).toBe("2026-04-16");
    expect(r1.data.total).toBe(2);
    expect(r1.data.totalPages).toBe(2);

    // Page 2 → the earlier SD day.
    const filtro2 = normalizarFiltro({ page: 2, pageSize: 1 });
    const r2 = await withTenantTransaction(ctx, (tx) => consultarVentasPorPeriodo(tx, ctx, filtro2));
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect(r2.data.filas[0]?.fechaSD).toBe("2026-04-15");
  });

  it("OP-6: the shared filter clamps pageSize 250 to 100 and AND-combines sucursal + range", async () => {
    const f = fixture!;
    const clienteA = await crearCliente(f, f.empresaA.id);
    await crearVentaMonto(f, { empresaId: f.empresaA.id, sucursalId: f.sucursalA1.id, clienteId: clienteA, fecha: AHORA, monto: "10.00" });
    await crearVentaMonto(f, { empresaId: f.empresaA.id, sucursalId: f.sucursalA2.id, clienteId: clienteA, fecha: AHORA, monto: "20.00" });

    // A1 + range ANDed → only the A1 sale counts (company-wide read narrowed by the filter).
    const filtro = normalizarFiltro({ sucursalId: f.sucursalA1.id, desde: "2026-04-15", hasta: "2026-04-15", pageSize: 250 });
    expect(filtro.pageSize).toBe(100); // DB-5 clamp
    const ctx = adminCtx(f, f.sucursalA1.id);
    const r = await withTenantTransaction(ctx, (tx) => consultarVentasPorPeriodo(tx, ctx, filtro));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.resumen.totalNeto).toBe("10.00");
    expect(r.data.resumen.totalOperaciones).toBe("1");
  });

  it("DB-2/EXP-4: a Cobrador is denied both the operational read AND its CSV export", async () => {
    const f = fixture!;
    const clienteA = await crearCliente(f, f.empresaA.id);
    await crearVentaMonto(f, { empresaId: f.empresaA.id, sucursalId: f.sucursalA1.id, clienteId: clienteA, fecha: AHORA, monto: "10.00" });
    const cobradorId = await crearUsuarioConRol(f, "Cobrador", f.sucursalA1.id, f.empresaA.id);
    const ctx: TenantCtx = {
      empresaId: f.empresaA.id,
      sucursalId: f.sucursalA1.id,
      usuarioId: cobradorId,
      esAdmin: false,
    };
    const filtro = normalizarFiltro({});
    const leido = await withTenantTransaction(ctx, (tx) => consultarVentasPorPeriodo(tx, ctx, filtro));
    expect(leido.ok).toBe(false);
    if (leido.ok) return;
    expect(leido.code).toBe(REPORTE_NO_AUTORIZADO);

    const csv = await withTenantTransaction(ctx, (tx) =>
      generarCsvOperativo(tx, ctx, REPORTE_ID.VENTAS, filtro),
    );
    expect(csv.ok).toBe(false);
    if (csv.ok) return;
    expect(csv.code).toBe(REPORTE_NO_AUTORIZADO);
  });

  it("EXP-2: the CSV carries the FULL filtered dataset and its totals equal the screen summary", async () => {
    const f = fixture!;
    const clienteA = await crearCliente(f, f.empresaA.id);
    await crearVentaMonto(f, { empresaId: f.empresaA.id, sucursalId: f.sucursalA1.id, clienteId: clienteA, fecha: AHORA, monto: "30.00" });
    await crearVentaMonto(f, { empresaId: f.empresaA.id, sucursalId: f.sucursalA1.id, clienteId: clienteA, fecha: DIA_SIGUIENTE, monto: "500.00" });
    const ctx = adminCtx(f, f.sucursalA1.id);

    // Screen shows ONE row (pageSize 1) but its summary covers the whole window (530.00).
    const filtro = normalizarFiltro({ pageSize: 1 });
    const pantalla = await withTenantTransaction(ctx, (tx) => consultarVentasPorPeriodo(tx, ctx, filtro));
    expect(pantalla.ok).toBe(true);
    if (!pantalla.ok) return;
    expect(pantalla.data.filas).toHaveLength(1);
    expect(pantalla.data.resumen.totalNeto).toBe("530.00");

    // Export uses the SAME window; the CSV is un-paged (full dataset) regardless of pageSize.
    const csv = await withTenantTransaction(ctx, (tx) =>
      generarCsvOperativo(tx, ctx, REPORTE_ID.VENTAS, filtro),
    );
    expect(csv.ok).toBe(true);
    if (!csv.ok) return;
    expect(csv.data.filename).toBe("ventas-por-periodo.csv");

    const lineas = csv.data.csv.split("\r\n").filter((l) => l.length > 0);
    const [cabecera, ...datos] = lineas;
    expect(cabecera).toBe("Fecha (Santo Domingo),Ventas confirmadas,Monto");
    // Full dataset = 2 detail rows, independent of the 1-row screen page.
    expect(datos).toHaveLength(2);
    // EXP-1: UTF-8 no BOM + CRLF.
    expect(csv.data.csv.charCodeAt(0)).not.toBe(0xfeff);
    expect(csv.data.csv.includes("\r\n")).toBe(true);
    // Totals parity: Σ CSV detail monto == screen summary to the cent.
    const suma = datos.reduce((acc, d) => acc.plus(new Decimal(d.split(",")[2] ?? "0")), new Decimal(0));
    expect(suma.toFixed(2)).toBe(pantalla.data.resumen.totalNeto);
  });

  it("EXP-4: the export guard rejects a non-operational id; no report path reaches audit tables", async () => {
    const f = fixture!;
    const ctx = adminCtx(f, f.sucursalA1.id);
    const db = getHarnessDb();

    const antes = await db.movimientoAuditoria.count();
    const filtro = normalizarFiltro({});
    // Dashboard is NOT an operational CSV export (slice E lands fiscal TXT; audit never).
    const noOperativo = await withTenantTransaction(ctx, (tx) =>
      generarCsvOperativo(tx, ctx, REPORTE_ID.DASHBOARD, filtro),
    );
    expect(noOperativo.ok).toBe(false);
    if (noOperativo.ok) return;
    expect(noOperativo.code).toBe(REPORTE_NO_AUTORIZADO);

    // Run all four reads + three CSV exports; the whole reportes surface writes NOTHING.
    await withTenantTransaction(ctx, (tx) => consultarVentasPorPeriodo(tx, ctx, filtro));
    await withTenantTransaction(ctx, (tx) => consultarProductosVendidos(tx, ctx, filtro));
    await withTenantTransaction(ctx, (tx) => consultarInventarioValorizado(tx, ctx, filtro));
    await withTenantTransaction(ctx, (tx) => consultarEstadoFacturas(tx, ctx, filtro));
    await withTenantTransaction(ctx, (tx) => generarCsvOperativo(tx, ctx, REPORTE_ID.PRODUCTOS, filtro));
    await withTenantTransaction(ctx, (tx) => generarCsvOperativo(tx, ctx, REPORTE_ID.INVENTARIO, filtro));
    await withTenantTransaction(ctx, (tx) => generarCsvOperativo(tx, ctx, REPORTE_ID.FACTURAS, filtro));

    const despues = await db.movimientoAuditoria.count();
    expect(despues).toBe(antes);
  });
});

// --- test-only name resolver (products were created with a deterministic `codigo === nombre`) ---
/**
 * Product `nombre` equals its `codigo` at creation (see `crearProducto`); the fixture exposes
 * the created id only through the harness, so re-derive the display name from the id via a
 * lightweight lookup. Kept as a plain async-free memo because tests await seeding first.
 */
const nombreCache = new Map<number, string>();
function nombreDe(id: number): string {
  const cacheado = nombreCache.get(id);
  if (cacheado !== undefined) return cacheado;
  // Fall back to a synchronous-safe placeholder is impossible; seeding is awaited above,
  // so resolve via a throw if the cache was never populated (guards test wiring mistakes).
  throw new Error(`producto ${id} no registrado en el cache de nombres`);
}
