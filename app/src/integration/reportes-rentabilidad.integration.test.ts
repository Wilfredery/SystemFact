/**
 * Integration — Reportes slice D: rentabilidad por producto (real Postgres 16, RLS on,
 * `systemfact_app` role; REN-1..REN-3, EXP-2/EXP-4).
 *
 * Seeding runs on the trusted superuser harness client (bypasses RLS), exactly like the slice-B/C
 * suites; the code under test (`consultarRentabilidad`, `leerRentabilidadCompleta`, the CSV
 * exporter and the dispatcher) runs through the app role inside `withTenantTransaction`, so the
 * RLS GUCs are in force as in production and every Admin read funnels through the ratified
 * company-wide widen.
 *
 * Proves the spec scenarios slice D owns:
 *   - REN-1  per-product five metrics + the cantidad-weighted output price, all Decimal; the
 *            current-`costoPromedio` cost basis; PENDIENTE purchases / non-CONFIRMADA sales excluded;
 *            a purchase-only product still surfaces (Salida 0).
 *   - REN-2  the SD date window AND the branch filter are ANDed; sales/purchases scope by their
 *            `sucursalId`, stock by `Inventario.sucursalId`; company-wide (widen) sums every branch.
 *   - REN-3  the cost-basis limitation disclaimer is carried verbatim in the exported CSV payload.
 *   - EXP-2  the CSV carries the full filtered dataset, page-independent, its ΣVentas == the screen
 *            summary; the on-screen summary itself never tracks the page.
 *   - EXP-4 / DB-2  a Cobrador is denied BOTH the rentabilidad read AND its CSV export BEFORE any
 *            aggregate; the whole reportes surface writes NO audit row.
 */

import { Prisma } from "@/generated/prisma/client";
import { Decimal } from "decimal.js";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import { withTenantTransaction } from "@/modules/tenant/infrastructure/withTenantTransaction";
import {
  consultarRentabilidad,
  leerRentabilidadCompleta,
} from "@/modules/reportes/application/rentabilidad";
import { generarCsvRentabilidad } from "@/modules/reportes/application/exportar-rentabilidad";
import { generarCsvReporte } from "@/modules/reportes/application/exportar";
import { normalizarFiltro } from "@/modules/reportes/domain/reporte-filtro";
import { NOTA_LIMITACION_RENTABILIDAD } from "@/modules/reportes/domain/margen";
import { REPORTE_NO_AUTORIZADO } from "@/modules/reportes/domain/errors";
import { REPORTE_ID } from "@/modules/reportes/domain/catalogo";
import {
  getHarnessDb,
  seedTenantFixture,
  type TenantFixture,
} from "./setup/fixtures";

let fixture: TenantFixture | null = null;

/** A fixed instant inside the SD window used by every fixture (15 Apr, 10:00 SD). */
const AHORA = new Date("2026-04-15T14:00:00.000Z");
/** A date strictly OUTSIDE the April window (March) — for the window-filter assertions. */
const FUERA = new Date("2026-03-10T14:00:00.000Z");

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
    rol = await db.rol.create({ data: { nombre, descripcion: `${nombre} (reportes D)` } });
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
      nombreUsuario: `repD-${rolNombre.toLowerCase()}-${empresaId}-${sucursalId}-${Date.now()}-${seq()}`,
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

async function categoriaDe(empresaId: number): Promise<number> {
  const db = getHarnessDb();
  const cat = await db.categoria.findFirst({ where: { empresaId }, select: { id: true } });
  if (cat === null) throw new Error("fixture categoria missing");
  return cat.id;
}

/** Create a product with an explicit CURRENT `costoPromedio` (the rentabilidad cost basis). */
async function crearProducto(
  empresaId: number,
  costoPromedio: string,
): Promise<{ id: number; nombre: string }> {
  const db = getHarnessDb();
  const categoriaId = await categoriaDe(empresaId);
  const codigo = `PD-${empresaId}-${seq()}`;
  const p = await db.producto.create({
    data: {
      empresaId,
      categoriaId,
      nombre: codigo,
      codigo,
      codigoBarras: `BC-${codigo}`,
      unidadMedida: "u",
      unidadEmpaque: "c",
      stockMinimo: 0,
      precioCompra: new Prisma.Decimal(0),
      precioVenta: new Prisma.Decimal(0),
      costoPromedio: new Prisma.Decimal(costoPromedio),
      tasaItbis: new Prisma.Decimal(18),
      itbisVigenteDesde: new Date("2000-01-01T00:00:00.000Z"),
    },
    select: { id: true, nombre: true },
  });
  return { id: p.id, nombre: p.nombre };
}

/** Set a product's CURRENT stock in a branch (the Capital basis — `Inventario.cantidad`). */
async function fijarStock(sucursalId: number, productoId: number, cantidad: string): Promise<void> {
  const db = getHarnessDb();
  await db.inventario.upsert({
    where: { sucursalId_productoId: { sucursalId, productoId } },
    create: { sucursalId, productoId, cantidad: new Prisma.Decimal(cantidad) },
    update: { cantidad: new Prisma.Decimal(cantidad) },
  });
}

interface LineaVenta {
  readonly productoId: number;
  readonly cantidad: string;
  readonly precioUnitario: string;
}

/** Create a `Venta` (default CONFIRMADA) whose detail lines carry an explicit unit price. */
async function crearVenta(
  f: TenantFixture,
  opts: {
    empresaId: number;
    sucursalId: number;
    clienteId: number;
    fecha: Date;
    estado?: "CONFIRMADA" | "CANCELADA" | "BORRADOR";
    lineas: readonly LineaVenta[];
  },
): Promise<number> {
  const db = getHarnessDb();
  const total = opts.lineas.reduce(
    (acc, l) => acc.plus(new Decimal(l.cantidad).times(new Decimal(l.precioUnitario))),
    new Decimal(0),
  );
  const v = await db.venta.create({
    data: {
      empresaId: opts.empresaId,
      sucursalId: opts.sucursalId,
      usuarioId: f.usuarios.adminA.id,
      clienteId: opts.clienteId,
      fecha: opts.fecha,
      estado: opts.estado ?? "CONFIRMADA",
      subtotal: new Prisma.Decimal(total.toFixed(2)),
      descuento: new Prisma.Decimal(0),
      descuentoTipo: "PORCENTAJE",
      itbis: new Prisma.Decimal(0),
      total: new Prisma.Decimal(total.toFixed(2)),
      detalles: {
        create: opts.lineas.map((l) => {
          const sub = new Decimal(l.cantidad).times(new Decimal(l.precioUnitario));
          return {
            productoId: l.productoId,
            cantidad: new Prisma.Decimal(l.cantidad),
            precioUnitario: new Prisma.Decimal(l.precioUnitario),
            descuentoLinea: new Prisma.Decimal(0),
            descuentoTipo: "PORCENTAJE",
            tasaItbis: new Prisma.Decimal(0),
            itbisLinea: new Prisma.Decimal(0),
            subtotalLinea: new Prisma.Decimal(sub.toFixed(2)),
          };
        }),
      },
    },
    select: { id: true },
  });
  return v.id;
}

interface LineaCompra {
  readonly productoId: number;
  readonly cantidad: string;
  readonly costoUnitario: string;
}

/** Create a `Compra` (given estado) with per-line `costoUnitario` (the Inversión basis). */
async function crearCompra(
  f: TenantFixture,
  opts: {
    empresaId: number;
    sucursalId: number;
    proveedorId: number;
    estado: "PENDIENTE" | "RECIBIDA" | "PAGADA";
    fecha?: Date;
    lineas: readonly LineaCompra[];
  },
): Promise<number> {
  const db = getHarnessDb();
  const total = opts.lineas.reduce(
    (acc, l) => acc.plus(new Decimal(l.cantidad).times(new Decimal(l.costoUnitario))),
    new Decimal(0),
  );
  const c = await db.compra.create({
    data: {
      empresaId: opts.empresaId,
      sucursalId: opts.sucursalId,
      proveedorId: opts.proveedorId,
      usuarioId: f.usuarios.adminA.id,
      tipoCompra: "MERCANCIA",
      estado: opts.estado,
      subtotal: new Prisma.Decimal(total.toFixed(2)),
      subtotalGravado: new Prisma.Decimal(total.toFixed(2)),
      itbis: new Prisma.Decimal(0),
      subtotalExento: new Prisma.Decimal(0),
      retencionIsr: new Prisma.Decimal(0),
      retencionItbis: new Prisma.Decimal(0),
      total: new Prisma.Decimal(total.toFixed(2)),
      correlativoInterno: `CMPD-${seq()}`,
      fecha: opts.fecha ?? AHORA,
      detalles: {
        create: opts.lineas.map((l) => {
          const sub = new Decimal(l.cantidad).times(new Decimal(l.costoUnitario));
          return {
            productoId: l.productoId,
            cantidad: new Prisma.Decimal(l.cantidad),
            costoUnitario: new Prisma.Decimal(l.costoUnitario),
            tasaItbis: new Prisma.Decimal(0),
            itbisLinea: new Prisma.Decimal(0),
            subtotalLinea: new Prisma.Decimal(sub.toFixed(2)),
          };
        }),
      },
    },
    select: { id: true },
  });
  return c.id;
}

const ENERO = { desde: "2026-04-01", hasta: "2026-04-30" };

describe("reportes slice D — rentabilidad por producto (real DB, RLS on)", () => {
  beforeEach(async () => {
    fixture = await seedTenantFixture();
  });

  // --- REN-1: five metrics + weighted output price, current-cost basis -------------------------

  it("REN-1: computes the five pinned metrics + weighted salida price over CONFIRMADA sales / received compras", async () => {
    const f = fixture!;
    const cliente = await crearCliente(f, f.empresaA.id);
    const P = await crearProducto(f.empresaA.id, "60.00"); // current costoPromedio = 60
    await fijarStock(f.sucursalA1.id, P.id, "5.000"); // Capital = 5 × 60 = 300

    // Sales (in window, CONFIRMADA): 10u @ 100 + 40u @ 90 → Salida 50, Ventas 4600, precio 92.
    await crearVenta(f, {
      empresaId: f.empresaA.id,
      sucursalId: f.sucursalA1.id,
      clienteId: cliente,
      fecha: AHORA,
      lineas: [{ productoId: P.id, cantidad: "10.000", precioUnitario: "100.00" }],
    });
    await crearVenta(f, {
      empresaId: f.empresaA.id,
      sucursalId: f.sucursalA1.id,
      clienteId: cliente,
      fecha: AHORA,
      lineas: [{ productoId: P.id, cantidad: "40.000", precioUnitario: "90.00" }],
    });
    // A CANCELADA sale of the same product must NOT count.
    await crearVenta(f, {
      empresaId: f.empresaA.id,
      sucursalId: f.sucursalA1.id,
      clienteId: cliente,
      fecha: AHORA,
      estado: "CANCELADA",
      lineas: [{ productoId: P.id, cantidad: "99.000", precioUnitario: "1000.00" }],
    });

    // Purchases in window: RECIBIDA 20u@55 (1100) + PAGADA 30u@50 (1500) → Entrada 50, Inversión 2600.
    await crearCompra(f, {
      empresaId: f.empresaA.id,
      sucursalId: f.sucursalA1.id,
      proveedorId: f.proveedores.formalJuridica.id,
      estado: "RECIBIDA",
      lineas: [{ productoId: P.id, cantidad: "20.000", costoUnitario: "55.00" }],
    });
    await crearCompra(f, {
      empresaId: f.empresaA.id,
      sucursalId: f.sucursalA1.id,
      proveedorId: f.proveedores.formalJuridica.id,
      estado: "PAGADA",
      lineas: [{ productoId: P.id, cantidad: "30.000", costoUnitario: "50.00" }],
    });
    // A PENDIENTE (received-not) compra must NOT contribute to Entrada/Inversión.
    await crearCompra(f, {
      empresaId: f.empresaA.id,
      sucursalId: f.sucursalA1.id,
      proveedorId: f.proveedores.formalJuridica.id,
      estado: "PENDIENTE",
      lineas: [{ productoId: P.id, cantidad: "100.000", costoUnitario: "1.00" }],
    });

    const ctx = adminCtx(f, f.sucursalA1.id);
    const r = await withTenantTransaction(ctx, (tx) =>
      consultarRentabilidad(tx, ctx, normalizarFiltro(ENERO)),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const fila = r.data.filas.find((x) => x.productoId === P.id);
    expect(fila).toBeDefined();
    expect(fila?.precioCosto).toBe("60.00");
    expect(fila?.precioSalida).toBe("92.00"); // (1000 + 3600) / 50
    expect(fila?.unidadesVendidas).toBe("50.000"); // Salida
    expect(fila?.unidadesCompradas).toBe("50.000"); // Entrada
    expect(fila?.ventas).toBe("4600.00");
    expect(fila?.inversion).toBe("2600.00"); // 1100 + 1500
    expect(fila?.capital).toBe("300.00"); // 5 × 60
    expect(fila?.margen).toBe("1600.00"); // 4600 − 50×60
    expect(fila?.margenPorciento).toBe("34.78"); // 1600 / 4600 × 100

    // Only one product row (the purchase-only / cross-tenant products are handled elsewhere).
    expect(r.data.total).toBe(1);
  });

  it("REN-1: a purchase-only product surfaces with Salida 0 (no ÷0 on the weighted price)", async () => {
    const f = fixture!;
    const P = await crearProducto(f.empresaA.id, "40.00");
    await fijarStock(f.sucursalA1.id, P.id, "25.000"); // Capital = 25 × 40 = 1000
    // A RECIBIDA purchase with no sale: 12u @ 35 → Entrada 12, Inversión 420.
    await crearCompra(f, {
      empresaId: f.empresaA.id,
      sucursalId: f.sucursalA1.id,
      proveedorId: f.proveedores.formalJuridica.id,
      estado: "RECIBIDA",
      lineas: [{ productoId: P.id, cantidad: "12.000", costoUnitario: "35.00" }],
    });

    const ctx = adminCtx(f, f.sucursalA1.id);
    const r = await withTenantTransaction(ctx, (tx) =>
      consultarRentabilidad(tx, ctx, normalizarFiltro(ENERO)),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const fila = r.data.filas.find((x) => x.productoId === P.id);
    expect(fila?.unidadesVendidas).toBe("0.000");
    expect(fila?.precioSalida).toBe("0.00");
    expect(fila?.ventas).toBe("0.00");
    expect(fila?.margen).toBe("0.00");
    expect(fila?.margenPorciento).toBe("0.00"); // zero sales → no division by zero
    expect(fila?.unidadesCompradas).toBe("12.000");
    expect(fila?.inversion).toBe("420.00");
    expect(fila?.capital).toBe("1000.00");
  });

  it("REN-1/REN-2: a purchase/sale OUTSIDE the SD window does not contribute", async () => {
    const f = fixture!;
    const cliente = await crearCliente(f, f.empresaA.id);
    const P = await crearProducto(f.empresaA.id, "10.00");
    await crearVenta(f, {
      empresaId: f.empresaA.id,
      sucursalId: f.sucursalA1.id,
      clienteId: cliente,
      fecha: FUERA, // March — outside the April window
      lineas: [{ productoId: P.id, cantidad: "100.000", precioUnitario: "100.00" }],
    });
    await crearCompra(f, {
      empresaId: f.empresaA.id,
      sucursalId: f.sucursalA1.id,
      proveedorId: f.proveedores.formalJuridica.id,
      estado: "RECIBIDA",
      fecha: FUERA,
      lineas: [{ productoId: P.id, cantidad: "100.000", costoUnitario: "5.00" }],
    });

    const ctx = adminCtx(f, f.sucursalA1.id);
    const r = await withTenantTransaction(ctx, (tx) =>
      consultarRentabilidad(tx, ctx, normalizarFiltro(ENERO)),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // With no in-window activity the product is not a rentabilidad row at all.
    expect(r.data.filas.find((x) => x.productoId === P.id)).toBeUndefined();
    expect(r.data.total).toBe(0);
  });

  // --- REN-2: period + branch filtering ANDed; company-wide widen sums branches ----------------

  it("REN-2: a branch filter scopes sales/purchases/stock to that branch; company-wide sums every branch", async () => {
    const f = fixture!;
    const cliente = await crearCliente(f, f.empresaA.id);
    const P = await crearProducto(f.empresaA.id, "50.00"); // costo 50

    // Sales: 10u @ 100 in A1, 10u @ 100 in A2.
    await crearVenta(f, {
      empresaId: f.empresaA.id, sucursalId: f.sucursalA1.id, clienteId: cliente, fecha: AHORA,
      lineas: [{ productoId: P.id, cantidad: "10.000", precioUnitario: "100.00" }],
    });
    await crearVenta(f, {
      empresaId: f.empresaA.id, sucursalId: f.sucursalA2.id, clienteId: cliente, fecha: AHORA,
      lineas: [{ productoId: P.id, cantidad: "10.000", precioUnitario: "100.00" }],
    });
    // Purchases: 10u @ 40 in A1, 10u @ 40 in A2.
    await crearCompra(f, {
      empresaId: f.empresaA.id, sucursalId: f.sucursalA1.id, proveedorId: f.proveedores.formalJuridica.id,
      estado: "RECIBIDA", lineas: [{ productoId: P.id, cantidad: "10.000", costoUnitario: "40.00" }],
    });
    await crearCompra(f, {
      empresaId: f.empresaA.id, sucursalId: f.sucursalA2.id, proveedorId: f.proveedores.formalJuridica.id,
      estado: "RECIBIDA", lineas: [{ productoId: P.id, cantidad: "10.000", costoUnitario: "40.00" }],
    });
    // Stock: A1 = 3, A2 = 7.
    await fijarStock(f.sucursalA1.id, P.id, "3.000");
    await fijarStock(f.sucursalA2.id, P.id, "7.000");

    const ctx = adminCtx(f, f.sucursalA1.id);

    // Branch-filtered to A1: only A1's activity contributes.
    const a1 = await withTenantTransaction(ctx, (tx) =>
      consultarRentabilidad(tx, ctx, normalizarFiltro({ ...ENERO, sucursalId: f.sucursalA1.id })),
    );
    expect(a1.ok).toBe(true);
    if (!a1.ok) return;
    const filaA1 = a1.data.filas.find((x) => x.productoId === P.id);
    expect(filaA1?.unidadesVendidas).toBe("10.000"); // A1 only
    expect(filaA1?.unidadesCompradas).toBe("10.000");
    expect(filaA1?.ventas).toBe("1000.00");
    expect(filaA1?.inversion).toBe("400.00");
    expect(filaA1?.capital).toBe("150.00"); // A1 stock 3 × 50
    expect(filaA1?.margen).toBe("500.00"); // 1000 − 10×50

    // Company-wide (no branch filter → Admin widen): every branch sums.
    const amplio = await withTenantTransaction(ctx, (tx) =>
      consultarRentabilidad(tx, ctx, normalizarFiltro(ENERO)),
    );
    expect(amplio.ok).toBe(true);
    if (!amplio.ok) return;
    const filaAmp = amplio.data.filas.find((x) => x.productoId === P.id);
    expect(filaAmp?.unidadesVendidas).toBe("20.000");
    expect(filaAmp?.unidadesCompradas).toBe("20.000");
    expect(filaAmp?.inversion).toBe("800.00");
    expect(filaAmp?.capital).toBe("500.00"); // (3 + 7) × 50
    expect(filaAmp?.margen).toBe("1000.00"); // 2000 − 20×50
    expect(filaAmp?.precioSalida).toBe("100.00"); // still the weighted (equal) price
  });

  // --- Tenant isolation ------------------------------------------------------------------------

  it("REN-2/DB-3: another tenant's product activity is NEVER visible to empresa A's report", async () => {
    const f = fixture!;
    const d = getHarnessDb();
    const clienteA = await crearCliente(f, f.empresaA.id);
    const pa = await crearProducto(f.empresaA.id, "10.00");
    await crearVenta(f, {
      empresaId: f.empresaA.id, sucursalId: f.sucursalA1.id, clienteId: clienteA, fecha: AHORA,
      lineas: [{ productoId: pa.id, cantidad: "5.000", precioUnitario: "30.00" }],
    });
    // A empresa-B product + sale — must never leak into A's report (RLS + empresaId pin).
    const clienteB = await d.cliente.create({
      data: {
        empresaId: f.empresaB.id, nombre: `CliB-${seq()}`, telefono: "0", direccion: "x",
        tipoCliente: "MINORISTA", esConsumidorFinal: true, limiteCredito: new Prisma.Decimal(0), plazoCreditoDias: 0,
      },
      select: { id: true },
    });
    const pb = await crearProducto(f.empresaB.id, "99.00");
    await d.venta.create({
      data: {
        empresaId: f.empresaB.id, sucursalId: f.sucursalB1.id, usuarioId: f.usuarios.adminB.id,
        clienteId: clienteB.id, fecha: AHORA, estado: "CONFIRMADA",
        subtotal: new Prisma.Decimal("9999.00"), descuento: new Prisma.Decimal(0), descuentoTipo: "PORCENTAJE",
        itbis: new Prisma.Decimal(0), total: new Prisma.Decimal("9999.00"),
        detalles: {
          create: [{
            productoId: pb.id, cantidad: new Prisma.Decimal("111.000"), precioUnitario: new Prisma.Decimal("90.00"),
            descuentoLinea: new Prisma.Decimal(0), descuentoTipo: "PORCENTAJE", tasaItbis: new Prisma.Decimal(0),
            itbisLinea: new Prisma.Decimal(0), subtotalLinea: new Prisma.Decimal("9999.00"),
          }],
        },
      },
      select: { id: true },
    });

    const ctx = adminCtx(f, f.sucursalA1.id);
    const r = await withTenantTransaction(ctx, (tx) =>
      consultarRentabilidad(tx, ctx, normalizarFiltro(ENERO)),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const ids = r.data.filas.map((x) => x.productoId);
    expect(ids).toContain(pa.id);
    expect(ids).not.toContain(pb.id);
    // B's huge figure never appears in A's summary either.
    expect(r.data.resumen.ventas).toBe("150.00"); // 5 × 30 (A only)
  });

  // --- REN-3 + EXP-2: the disclaimer + page-independent totals in the CSV ----------------------

  it("REN-3/EXP-2: the CSV carries the limitation note verbatim, the full dataset, and totals matching the screen", async () => {
    const f = fixture!;
    const cliente = await crearCliente(f, f.empresaA.id);
    const pa = await crearProducto(f.empresaA.id, "60.00");
    await fijarStock(f.sucursalA1.id, pa.id, "5.000");
    // Two products with activity so the screen can page while the summary/CSV stay whole.
    await crearVenta(f, {
      empresaId: f.empresaA.id, sucursalId: f.sucursalA1.id, clienteId: cliente, fecha: AHORA,
      lineas: [{ productoId: pa.id, cantidad: "50.000", precioUnitario: "92.00" }],
    });
    await crearCompra(f, {
      empresaId: f.empresaA.id, sucursalId: f.sucursalA1.id, proveedorId: f.proveedores.formalJuridica.id,
      estado: "RECIBIDA", lineas: [{ productoId: pa.id, cantidad: "50.000", costoUnitario: "52.00" }],
    });
    const pb = await crearProducto(f.empresaA.id, "10.00");
    await crearVenta(f, {
      empresaId: f.empresaA.id, sucursalId: f.sucursalA1.id, clienteId: cliente, fecha: AHORA,
      lineas: [{ productoId: pb.id, cantidad: "10.000", precioUnitario: "30.00" }],
    });

    const ctx = adminCtx(f, f.sucursalA1.id);
    const filtroPagina = normalizarFiltro({ ...ENERO, pageSize: 1 });

    // Screen shows ONE row but the summary covers BOTH products (page-independent).
    const pantalla = await withTenantTransaction(ctx, (tx) =>
      consultarRentabilidad(tx, ctx, filtroPagina),
    );
    expect(pantalla.ok).toBe(true);
    if (!pantalla.ok) return;
    expect(pantalla.data.filas).toHaveLength(1);
    expect(pantalla.data.resumen.productos).toBe("2");
    // ΣVentas = 50×92 (4600) + 10×30 (300) = 4900.00.
    expect(pantalla.data.resumen.ventas).toBe("4900.00");

    const csv = await withTenantTransaction(ctx, (tx) =>
      generarCsvReporte(tx, ctx, REPORTE_ID.RENTABILIDAD, filtroPagina),
    );
    expect(csv.ok).toBe(true);
    if (!csv.ok) return;
    // EXP-1: UTF-8 no BOM + CRLF.
    expect(csv.data.csv.charCodeAt(0)).not.toBe(0xfeff);
    expect(csv.data.csv.includes("\r\n")).toBe(true);
    // REN-3: the limitation note travels with the file (the SAME frozen string).
    expect(csv.data.csv).toContain(NOTA_LIMITACION_RENTABILIDAD);
    // EXP-2: full filtered dataset (2 detail rows), independent of the 1-row screen page.
    const detalle = csv.data.csv
      .split("\r\n")
      .filter((l) => /^[^,]+,60\.00|^[^,]+,10\.00/.test(l));
    expect(detalle.length).toBeGreaterThanOrEqual(2);
    // The TOTAL footer row equals the screen summary (ΣVentas 4900.00).
    expect(csv.data.csv).toContain("4900.00");
    expect(csv.data.csv).toContain("TOTAL");
  });

  // --- EXP-4 / DB-2: a Cobrador is denied the read AND its export; no audit writes -------------

  it("EXP-4/DB-2: a Cobrador is denied the rentabilidad read AND its CSV export; no audit rows", async () => {
    const f = fixture!;
    const cliente = await crearCliente(f, f.empresaA.id);
    const P = await crearProducto(f.empresaA.id, "10.00");
    await crearVenta(f, {
      empresaId: f.empresaA.id, sucursalId: f.sucursalA1.id, clienteId: cliente, fecha: AHORA,
      lineas: [{ productoId: P.id, cantidad: "5.000", precioUnitario: "30.00" }],
    });
    const cobradorId = await crearUsuarioConRol(f, "Cobrador", f.sucursalA1.id, f.empresaA.id);
    const ctx: TenantCtx = {
      empresaId: f.empresaA.id,
      sucursalId: f.sucursalA1.id,
      usuarioId: cobradorId,
      esAdmin: false,
    };
    const db = getHarnessDb();
    const antes = await db.movimientoAuditoria.count();
    const filtro = normalizarFiltro(ENERO);

    const leido = await withTenantTransaction(ctx, (tx) =>
      consultarRentabilidad(tx, ctx, filtro),
    );
    expect(leido.ok).toBe(false);
    if (leido.ok) return;
    expect(leido.code).toBe(REPORTE_NO_AUTORIZADO);

    // Direct exporter AND the shared dispatcher both refuse a Cobrador (no query runs).
    const directo = await withTenantTransaction(ctx, (tx) =>
      generarCsvRentabilidad(tx, ctx, REPORTE_ID.RENTABILIDAD, filtro),
    );
    expect(!directo.ok && directo.code).toBe(REPORTE_NO_AUTORIZADO);

    const despachado = await withTenantTransaction(ctx, (tx) =>
      generarCsvReporte(tx, ctx, REPORTE_ID.RENTABILIDAD, filtro),
    );
    expect(!despachado.ok && despachado.code).toBe(REPORTE_NO_AUTORIZADO);

    // Even the internal reader is denied — no aggregate executed for a Cobrador.
    const reader = await withTenantTransaction(ctx, (tx) => leerRentabilidadCompleta(tx, ctx, filtro));
    expect(reader.ok).toBe(false);

    const despues = await db.movimientoAuditoria.count();
    expect(despues).toBe(antes);
  });
});
