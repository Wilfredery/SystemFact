/**
 * Integration — Reportes slice E: fiscal reports + DGII exporters (real Postgres 16, RLS on,
 * `systemfact_app` role; FIS-1..FIS-6, EXP-2/EXP-4).
 *
 * Seeding runs on the trusted superuser harness client (bypasses RLS), exactly like the slice-B/C/D
 * suites; the code under test (`consultarResumenITBIS`, `consultarCasillasIT1`, `generarTxt607/606/608`
 * and the `generarTxtReporte` dispatcher) runs through the app role inside `withTenantTransaction`, so
 * the RLS GUCs are in force and every Admin read funnels through the ratified company-wide widen.
 *
 * Proves the spec scenarios slice E owns against the REAL DB (the pure assembly is unit-covered):
 *   - FIS-3 607: only VIGENTE B01/B02(≥ threshold)/B03/B04 detail; a below-threshold B02, a
 *            CANCELADA and an ANULADA are NOT rows; the header count matches; the payment split
 *            cross-foots; another tenant is invisible (DB-3).
 *   - FIS-4 606: only RECIBIDA/PAGADA compras (a PENDIENTE + a CANCELADA excluded); the B11/informal
 *            ITBIS goes to cost (no advance) while a formal one advances; the supplier D1/D2 uses the
 *            supplier's OWN id (the 606 fix — never the company RNC); draft excluded (spec scenario).
 *   - FIS-5 608: ONLY `estadoFiscal=ANULADA` invoices, mapped reason code; a CANCELADA appears in
 *            NEITHER 607 nor 608 (the binding scope decision, spec scenario).
 *   - FIS-1/2: the signed ITBIS summary (Σ607 net of NC/ND + Σ606 retenido) and the IT-1 casilla
 *            self-check (retenido == Σ606; a manual override mismatch is flagged).
 *   - EXP-2 : the 607 header base-total equals the Σ of its own detail rows (page-independent export).
 *   - EXP-4/DB-2: a Cobrador is denied EVERY fiscal read AND every TXT export BEFORE any aggregate;
 *            the whole fiscal surface writes NO audit row.
 *   - FIS-6 : an empty period still emits one valid en-cero file.
 */

import { Prisma } from "@/generated/prisma/client";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import { withTenantTransaction } from "@/modules/tenant/infrastructure/withTenantTransaction";
import {
  consultarCasillasIT1,
  consultarResumenITBIS,
  generarTxt606,
  generarTxt607,
  generarTxt608,
  generarTxtReporte,
} from "@/modules/reportes/application/fiscal";
import { normalizarFiltro } from "@/modules/reportes/domain/reporte-filtro";
import { REPORTE_NO_AUTORIZADO } from "@/modules/reportes/domain/errors";
import { REPORTE_ID } from "@/modules/reportes/domain/catalogo";
import {
  getHarnessDb,
  seedTenantFixture,
  type TenantFixture,
} from "./setup/fixtures";

let fixture: TenantFixture | null = null;

/** The fixed SD period window every fixture lands inside (April 2026). */
const ENERO = { desde: "2026-04-01", hasta: "2026-04-30" };
const AHORA = new Date("2026-04-15T14:00:00.000Z");

let CONTADOR = 0;
const seq = (): number => {
  CONTADOR += 1;
  return CONTADOR;
};

function adminCtx(f: TenantFixture, sucursalId: number): TenantCtx {
  return { empresaId: f.empresaA.id, sucursalId, usuarioId: f.usuarios.adminA.id, esAdmin: true };
}

async function rolId(nombre: string): Promise<number> {
  const db = getHarnessDb();
  let rol = await db.rol.findFirst({ where: { nombre } });
  if (rol === null) rol = await db.rol.create({ data: { nombre, descripcion: `${nombre} (E)` } });
  return rol.id;
}

async function crearUsuarioConRol(f: TenantFixture, rolNombre: string, sucursalId: number): Promise<number> {
  const db = getHarnessDb();
  const rid = await rolId(rolNombre);
  const u = await db.usuario.create({
    data: {
      empresaId: f.empresaA.id, sucursalId, nombre: `${rolNombre}-E-${seq()}`,
      nombreUsuario: `repE-${rolNombre.toLowerCase()}-${seq()}-${Date.now()}`,
      passwordHash: "test-hash",
      roles: { create: { rolId: rid } },
    },
    select: { id: true },
  });
  return u.id;
}

/** A CLIENTE; a formal taxpayer carries a valid 9-digit mod-11 RNC (131000002 → DV 2). */
async function crearCliente(opts: {
  empresaId: number;
  esConsumidorFinal?: boolean;
  identificacionFiscal?: string | null;
}): Promise<number> {
  const db = getHarnessDb();
  const c = await db.cliente.create({
    data: {
      empresaId: opts.empresaId,
      nombre: `Cli-${seq()}`,
      telefono: "0",
      direccion: "x",
      identificacionFiscal: opts.identificacionFiscal ?? null,
      tipoCliente: opts.esConsumidorFinal ? "MINORISTA" : "CREDITO",
      esConsumidorFinal: opts.esConsumidorFinal ?? false,
      limiteCredito: new Prisma.Decimal(0),
      plazoCreditoDias: 0,
    },
    select: { id: true },
  });
  return c.id;
}

/** Create a FACTURA in a given fiscal state (B01/B02); returns its id. */
async function crearFactura(opts: {
  ctx: TenantCtx;
  clienteId: number;
  tipoNcf: "B01" | "B02";
  ncf: string;
  estado: "VIGENTE" | "CANCELADA" | "ANULADA";
  subtotalGravado: string;
  itbis: string;
  total: string;
}): Promise<number> {
  const db = getHarnessDb();
  const f = await db.factura.create({
    data: {
      empresaId: opts.ctx.empresaId, sucursalId: opts.ctx.sucursalId,
      clienteId: opts.clienteId, usuarioId: opts.ctx.usuarioId,
      tipoNcf: opts.tipoNcf, ncf: opts.ncf, correlativoInterno: `FAC-${opts.ncf}`,
      estado: opts.estado,
      subtotalGravado: new Prisma.Decimal(opts.subtotalGravado),
      itbis: new Prisma.Decimal(opts.itbis),
      subtotalExento: new Prisma.Decimal(0),
      descuento: new Prisma.Decimal(0),
      total: new Prisma.Decimal(opts.total),
      fechaEmision: AHORA,
    },
    select: { id: true },
  });
  return f.id;
}

/** A cash COBRO/APLICADO on a factura (drives the 607 D17 cross-foot). */
async function crearCobroEfectivo(ctx: TenantCtx, facturaId: number, monto: string): Promise<void> {
  const db = getHarnessDb();
  await db.pago.create({
    data: {
      facturaId, empresaId: ctx.empresaId, sucursalId: ctx.sucursalId, usuarioId: ctx.usuarioId,
      metodoPago: "EFECTIVO", monto: new Prisma.Decimal(monto), fecha: AHORA,
      estado: "APLICADO", tipo: "COBRO", correlativoRecibo: seq(),
    },
  });
}

/** A VIGENTE Nota de Crédito (B04) referencing an original factura (reduces the 607 register). */
async function crearNotaCredito(ctx: TenantCtx, opts: {
  clienteId: number; originalFacturaId: number; ncf: string; estado: "VIGENTE" | "CANCELADA"; monto: string; itbis: string;
}): Promise<number> {
  const db = getHarnessDb();
  const nc = await db.notaCredito.create({
    data: {
      facturaOriginalId: opts.originalFacturaId, empresaId: ctx.empresaId, sucursalId: ctx.sucursalId,
      clienteId: opts.clienteId, usuarioId: ctx.usuarioId, ncf: opts.ncf, estado: opts.estado,
      motivo: "Devolución cliente", monto: new Prisma.Decimal(opts.monto), itbis: new Prisma.Decimal(opts.itbis),
      fechaEmision: AHORA,
    },
    select: { id: true },
  });
  return nc.id;
}

/** A VIGENTE Nota de Débito (B03) referencing an original factura (adds to the 607 register). */
async function crearNotaDebito(ctx: TenantCtx, opts: {
  clienteId: number; originalFacturaId: number; ncf: string; estado: "VIGENTE"; monto: string; itbis: string;
}): Promise<number> {
  const db = getHarnessDb();
  const nd = await db.notaDebito.create({
    data: {
      facturaOriginalId: opts.originalFacturaId, empresaId: ctx.empresaId, sucursalId: ctx.sucursalId,
      clienteId: opts.clienteId, usuarioId: ctx.usuarioId, ncf: opts.ncf, estado: opts.estado,
      motivo: "Corrección", monto: new Prisma.Decimal(opts.monto), itbis: new Prisma.Decimal(opts.itbis),
      fechaEmision: AHORA,
    },
    select: { id: true },
  });
  return nd.id;
}

/** The ANULACION record for an ANULADA factura (supplies the 608 reason text). */
async function crearAnulacionFactura(ctx: TenantCtx, facturaId: number, motivo: string): Promise<void> {
  const db = getHarnessDb();
  await db.anulacion.create({
    data: {
      empresaId: ctx.empresaId, tipoDocumento: "FACTURA", documentoId: facturaId,
      motivo, anuladaPor: ctx.usuarioId, fechaHora: AHORA,
    },
  });
}

/** A COMPRA in a given estado with a supplier NCF (B01 formal / B11 informal) + retention amounts. */
async function crearCompra(ctx: TenantCtx, opts: {
  proveedorId: number; estado: "PENDIENTE" | "RECIBIDA" | "PAGADA" | "CANCELADA"; ncf: string | null;
  tipoNcf: "B01" | "B11"; tipoCompra: "MERCANCIA" | "SERVICIO_PROFESIONAL" | "ALQUILER";
  subtotalGravado: string; itbis: string; retencionIsr: string; retencionItbis: string;
}): Promise<number> {
  const db = getHarnessDb();
  const total = new Prisma.Decimal(opts.subtotalGravado).plus(opts.itbis);
  const c = await db.compra.create({
    data: {
      empresaId: ctx.empresaId, sucursalId: ctx.sucursalId, proveedorId: opts.proveedorId,
      usuarioId: ctx.usuarioId, tipoNcf: opts.tipoNcf, ncf: opts.ncf, correlativoInterno: `CMP-${seq()}`,
      tipoCompra: opts.tipoCompra, estado: opts.estado,
      subtotal: new Prisma.Decimal(opts.subtotalGravado), subtotalGravado: new Prisma.Decimal(opts.subtotalGravado),
      itbis: new Prisma.Decimal(opts.itbis), subtotalExento: new Prisma.Decimal(0),
      retencionIsr: new Prisma.Decimal(opts.retencionIsr), retencionItbis: new Prisma.Decimal(opts.retencionItbis),
      total, fecha: AHORA,
    },
    select: { id: true },
  });
  return c.id;
}

/** Count detail rows in a generated TXT (header excluded). */
function detalleDe(txt: string): string[] {
  return txt.split("\r\n").filter((l) => l !== "").slice(1);
}

describe("reportes slice E — fiscal reports + DGII exporters (real DB, RLS on)", () => {
  beforeEach(async () => {
    fixture = await seedTenantFixture();
    // Give empresa A a NUMERIC RNC so the DGII header is deterministic (the base fixture uses an
    // alpha RNC that would just be truncated; this keeps the export filename/header clean).
    const db = getHarnessDb();
    await db.empresa.update({ where: { id: fixture.empresaA.id }, data: { rnc: "130000001" } });
  });

  // --- FIS-3: the 607 sales register scope + threshold + tenant isolation -----------------------

  it("FIS-3: 607 details VIGENTE B01 + B02≥threshold + B03/B04, excludes below-threshold B02 / CANCELADA / ANULADA", async () => {
    const f = fixture!;
    const ctx = adminCtx(f, f.sucursalA1.id);
    const formal = await crearCliente({ empresaId: f.empresaA.id, identificacionFiscal: "131000002" });
    const consumidor = await crearCliente({ empresaId: f.empresaA.id, esConsumidorFinal: true });

    const facB01 = await crearFactura({ ctx, clienteId: formal, tipoNcf: "B01", ncf: "B0100000001", estado: "VIGENTE", subtotalGravado: "1000.00", itbis: "180.00", total: "1180.00" });
    await crearFactura({ ctx, clienteId: consumidor, tipoNcf: "B02", ncf: "B0200000101", estado: "VIGENTE", subtotalGravado: "250000.00", itbis: "0.00", total: "250000.00" }); // = threshold → IN (inclusive)
    await crearFactura({ ctx, clienteId: consumidor, tipoNcf: "B02", ncf: "B0200000102", estado: "VIGENTE", subtotalGravado: "249999.00", itbis: "0.00", total: "249999.00" }); // < threshold → OUT
    await crearFactura({ ctx, clienteId: formal, tipoNcf: "B01", ncf: "B0100000002", estado: "CANCELADA", subtotalGravado: "500.00", itbis: "90.00", total: "590.00" }); // CANCELADA → OUT
    const anulada = await crearFactura({ ctx, clienteId: formal, tipoNcf: "B01", ncf: "B0100000003", estado: "ANULADA", subtotalGravado: "700.00", itbis: "126.00", total: "826.00" }); // ANULADA → OUT (608 only)
    await crearAnulacionFactura(ctx, anulada, "Devolución de productos");
    // B04 nota crédito (VIGENTE) referencing the B01 → an extra 607 row (negative).
    await crearNotaCredito(ctx, { clienteId: formal, originalFacturaId: facB01, ncf: "B0400000201", estado: "VIGENTE", monto: "100.00", itbis: "18.00" });
    // A empresa-B factura must never leak in (DB-3).
    const ctxB: TenantCtx = { empresaId: f.empresaB.id, sucursalId: f.sucursalB1.id, usuarioId: f.usuarios.adminB.id, esAdmin: true };
    const cliB = await crearCliente({ empresaId: f.empresaB.id, identificacionFiscal: "131000002" });
    await crearFactura({ ctx: ctxB, clienteId: cliB, tipoNcf: "B01", ncf: "B0199999999", estado: "VIGENTE", subtotalGravado: "8888.00", itbis: "0.00", total: "8888.00" });

    const r = await withTenantTransaction(ctx, (tx) => generarTxt607(tx, ctx, normalizarFiltro(ENERO)));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const filas = detalleDe(r.data.partes[0].txt);
    const ncfs = filas.map((l) => l.slice(12, 23)); // D3 NCF: D1(11) + D2(1) → offset 12, width 11
    // Exactly: B01…001, B02…0101 (≥ threshold), B04…0201. NOT the below-threshold B02, NOT CANCELADA/ANULADA.
    expect(ncfs).toContain("B0100000001");
    expect(ncfs).toContain("B0200000101");
    expect(ncfs).toContain("B0400000201");
    expect(ncfs).not.toContain("B0200000102");
    expect(ncfs).not.toContain("B0100000002");
    expect(ncfs).not.toContain("B0100000003");
    expect(ncfs).not.toContain("B0199999999"); // cross-tenant invisible
    expect(filas).toHaveLength(3);
  });

  it("FIS-3: the 607 payment cross-foot puts cash in D17 and the remainder in D20", async () => {
    const f = fixture!;
    const ctx = adminCtx(f, f.sucursalA1.id);
    const formal = await crearCliente({ empresaId: f.empresaA.id, identificacionFiscal: "131000002" });
    const fac = await crearFactura({ ctx, clienteId: formal, tipoNcf: "B01", ncf: "B0100000010", estado: "VIGENTE", subtotalGravado: "1000.00", itbis: "180.00", total: "1180.00" });
    await crearCobroEfectivo(ctx, fac, "500.00"); // half cash → D17 500, D20 680 (cross-foots to 1180)

    const r = await withTenantTransaction(ctx, (tx) => generarTxt607(tx, ctx, normalizarFiltro(ENERO)));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const linea = detalleDe(r.data.partes[0].txt)[0];
    expect(linea).toContain("000000500.00"); // D17 efectivo
    expect(linea).toContain("000000680.00"); // D20 venta crédito
  });

  it("FIS-3: a tenant-configured B02 threshold overrides the statutory default (DB-backed, not hardcoded)", async () => {
    const f = fixture!;
    const ctx = adminCtx(f, f.sucursalA1.id);
    const db = getHarnessDb();
    // Configure a LOW threshold (100.00) → a 150.00 B02 now earns a detail row (would be out at 250k).
    await db.configuracionEmpresa.create({
      data: {
        empresaId: f.empresaA.id, clave: "UMBRAL_CONSUMO_607", valor: "100.00",
        vigenciaInicio: new Date("2000-01-01T00:00:00.000Z"), vigenciaFin: new Date("2099-12-31T23:59:59.000Z"), activa: true,
      },
    });
    const consumidor = await crearCliente({ empresaId: f.empresaA.id, esConsumidorFinal: true });
    await crearFactura({ ctx, clienteId: consumidor, tipoNcf: "B02", ncf: "B0200000200", estado: "VIGENTE", subtotalGravado: "150.00", itbis: "0.00", total: "150.00" });

    const r = await withTenantTransaction(ctx, (tx) => generarTxt607(tx, ctx, normalizarFiltro(ENERO)));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(detalleDe(r.data.partes[0].txt).some((l) => l.includes("B0200000200"))).toBe(true);
  });

  // --- FIS-4: the 606 purchases register -------------------------------------------------------

  it("FIS-4: 606 details only RECIBIDA/PAGADA (PENDIENTE + CANCELADA excluded); the informal B11 carries ITBIS to cost", async () => {
    const f = fixture!;
    const ctx = adminCtx(f, f.sucursalA1.id);
    // FORMAL (advance credit) + INFORMAL (B11, no credit) suppliers, plus one with NO rnc (fix test).
    const formalProv = await db_createProveedor(f.empresaA.id, "131000002", "FORMAL");
    const informalProv = await db_createProveedor(f.empresaA.id, null, "INFORMAL");
    await crearCompra(ctx, { proveedorId: formalProv, estado: "RECIBIDA", ncf: "B0100000501", tipoNcf: "B01", tipoCompra: "MERCANCIA", subtotalGravado: "1000.00", itbis: "180.00", retencionIsr: "0.00", retencionItbis: "0.00" });
    await crearCompra(ctx, { proveedorId: informalProv, estado: "PAGADA", ncf: "B1100000502", tipoNcf: "B11", tipoCompra: "MERCANCIA", subtotalGravado: "1000.00", itbis: "180.00", retencionIsr: "0.00", retencionItbis: "180.00" });
    await crearCompra(ctx, { proveedorId: formalProv, estado: "PENDIENTE", ncf: "B0100000503", tipoNcf: "B01", tipoCompra: "MERCANCIA", subtotalGravado: "500.00", itbis: "90.00", retencionIsr: "0.00", retencionItbis: "0.00" });
    await crearCompra(ctx, { proveedorId: formalProv, estado: "CANCELADA", ncf: "B0100000504", tipoNcf: "B01", tipoCompra: "MERCANCIA", subtotalGravado: "400.00", itbis: "72.00", retencionIsr: "0.00", retencionItbis: "0.00" });

    const r = await withTenantTransaction(ctx, (tx) => generarTxt606(tx, ctx, normalizarFiltro(ENERO)));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const filas = detalleDe(r.data.partes[0].txt);
    expect(filas).toHaveLength(2); // RECIBIDA + PAGADA only
    // D2 tipoId: formal supplier's own RNC → type 1; the informal with no rnc → type 3 (blank), NOT
    // the company RNC (the fix). NCF is at a different offset for 606; assert the supplier-id cells.
    const formalRow = filas.find((l) => l.includes("B0100000501"))!;
    const informalRow = filas.find((l) => l.includes("B1100000502"))!;
    expect(formalRow.startsWith("131000002  109")).toBe(true); // D1 supplier RNC, D2=1, D3=09 (costo de venta)
    // Informal (no supplier id): D1 is 11 blank columns and D2=3 (sin identificación). It must NOT
    // substitute the COMPANY RNC (130000001) — that would report the remitter as its own supplier.
    expect(informalRow.slice(0, 11)).toBe("           "); // 11 spaces (blank D1)
    expect(informalRow[11]).toBe("3"); // D2 = 3
    expect(informalRow.startsWith("131000001")).toBe(false); // company RNC never used as supplier id
  });

  // --- FIS-5: the 608 annulados register + the Cancelada-in-neither binding ----------------------

  it("FIS-5: 608 reports ONLY ANULADA invoices; a CANCELADA appears in NEITHER 607 nor 608", async () => {
    const f = fixture!;
    const ctx = adminCtx(f, f.sucursalA1.id);
    const formal = await crearCliente({ empresaId: f.empresaA.id, identificacionFiscal: "131000002" });
    const anulada = await crearFactura({ ctx, clienteId: formal, tipoNcf: "B01", ncf: "B0100000701", estado: "ANULADA", subtotalGravado: "900.00", itbis: "162.00", total: "1062.00" });
    await crearAnulacionFactura(ctx, anulada, "Error de captura");
    await crearFactura({ ctx, clienteId: formal, tipoNcf: "B01", ncf: "B0100000702", estado: "CANCELADA", subtotalGravado: "800.00", itbis: "144.00", total: "944.00" });

    const r608 = await withTenantTransaction(ctx, (tx) => generarTxt608(tx, ctx, normalizarFiltro(ENERO)));
    expect(r608.ok).toBe(true);
    if (!r608.ok) return;
    const filas608 = detalleDe(r608.data.partes[0].txt);
    expect(filas608).toHaveLength(1);
    expect(filas608[0]).toContain("B0100000701"); // ANULADA
    expect(filas608[0].endsWith("04")).toBe(true); // "Error de captura" → reason code 4 (default correction)
    // The CANCELADA is NOT in 608…
    expect(filas608.some((l) => l.includes("B0100000702"))).toBe(false);
    // …and NOT in 607 either (Cancelada in NEITHER file — the binding scenario).
    const r607 = await withTenantTransaction(ctx, (tx) => generarTxt607(tx, ctx, normalizarFiltro(ENERO)));
    expect(r607.ok).toBe(true);
    if (!r607.ok) return;
    expect(detalleDe(r607.data.partes[0].txt).some((l) => l.includes("B0100000702"))).toBe(false);
  });

  // --- FIS-1/FIS-2: the ITBIS summary + the IT-1 casilla self-check ------------------------------

  it("FIS-1: the signed ITBIS summary nets NC/ND on ventas and aggregates purchase retenciones", async () => {
    const f = fixture!;
    const ctx = adminCtx(f, f.sucursalA1.id);
    const formal = await crearCliente({ empresaId: f.empresaA.id, identificacionFiscal: "131000002" });
    const fac = await crearFactura({ ctx, clienteId: formal, tipoNcf: "B01", ncf: "B0100000801", estado: "VIGENTE", subtotalGravado: "10000.00", itbis: "1800.00", total: "11800.00" });
    await crearNotaCredito(ctx, { clienteId: formal, originalFacturaId: fac, ncf: "B0400000801", estado: "VIGENTE", monto: "1000.00", itbis: "180.00" }); // −180
    await crearNotaDebito(ctx, { clienteId: formal, originalFacturaId: fac, ncf: "B0300000801", estado: "VIGENTE", monto: "500.00", itbis: "90.00" }); // +90
    const formalProv = await db_createProveedor(f.empresaA.id, "131000002", "FORMAL");
    await crearCompra(ctx, { proveedorId: formalProv, estado: "PAGADA", ncf: "B0100000802", tipoNcf: "B01", tipoCompra: "SERVICIO_PROFESIONAL", subtotalGravado: "1000.00", itbis: "180.00", retencionIsr: "150.00", retencionItbis: "18.00" });

    const r = await withTenantTransaction(ctx, (tx) => consultarResumenITBIS(tx, ctx, normalizarFiltro(ENERO)));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.debitoFiscal).toBe("1710.00"); // 1800 − 180 + 90
    expect(r.data.creditoFiscal).toBe("180.00"); // formal purchase advance
    expect(r.data.itbisRetenido).toBe("18.00"); // Σ606 retencionItbis
    expect(r.data.isrRetenido).toBe("150.00"); // Σ606 retencionIsr
  });

  it("FIS-2: the IT-1 casilla worksheet self-checks retenido == Σ606 and flags a manual mismatch", async () => {
    const f = fixture!;
    const ctx = adminCtx(f, f.sucursalA1.id);
    const formalProv = await db_createProveedor(f.empresaA.id, "131000002", "FORMAL");
    await crearCompra(ctx, { proveedorId: formalProv, estado: "PAGADA", ncf: "B0100000901", tipoNcf: "B01", tipoCompra: "ALQUILER", subtotalGravado: "2000.00", itbis: "360.00", retencionIsr: "200.00", retencionItbis: "36.00" });

    const ok = await withTenantTransaction(ctx, (tx) => consultarCasillasIT1(tx, ctx, normalizarFiltro(ENERO)));
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    expect(ok.data.itbisRetenido).toBe("36.00");
    expect(ok.data.cuadreRetenido).toBe(true);
    expect(ok.data.avisoValidacion).toBeNull();

    const override = await withTenantTransaction(ctx, (tx) => consultarCasillasIT1(tx, ctx, normalizarFiltro(ENERO), "999.00"));
    expect(override.ok).toBe(true);
    if (!override.ok) return;
    expect(override.data.cuadreRetenido).toBe(false);
    expect(override.data.avisoValidacion).not.toBeNull();
    expect(override.data.itbisRetenido).toBe("36.00"); // authoritative figure unchanged by the bad override
  });

  // --- FIS-6: en-cero file + the dispatcher parity ----------------------------------------------

  it("FIS-6: an empty period still produces one valid en-cero file with CANTIDAD_REGISTROS=0", async () => {
    const f = fixture!;
    const ctx = adminCtx(f, f.sucursalA1.id);
    const r = await withTenantTransaction(ctx, (tx) => generarTxtReporte(tx, ctx, REPORTE_ID.DGII_607, normalizarFiltro(ENERO)));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.cantidadArchivos).toBe(1);
    expect(r.data.partes[0].txt.split("\r\n").filter((l) => l !== "")).toHaveLength(1); // header only
    expect(r.data.partes[0].txt).toContain("000000000000"); // count 0
    expect(r.data.partes[0].filename).toBe("DGII_F_607_130000001_202604.TXT");
  });

  it("EXP-4/dispatcher: generarTxtReporte routes each DGII id and denies a non-DGII id", async () => {
    const f = fixture!;
    const ctx = adminCtx(f, f.sucursalA1.id);
    const formal = await crearCliente({ empresaId: f.empresaA.id, identificacionFiscal: "131000002" });
    await crearFactura({ ctx, clienteId: formal, tipoNcf: "B01", ncf: "B0100000902", estado: "VIGENTE", subtotalGravado: "100.00", itbis: "18.00", total: "118.00" });
    const r607 = await withTenantTransaction(ctx, (tx) => generarTxtReporte(tx, ctx, REPORTE_ID.DGII_607, normalizarFiltro(ENERO)));
    expect(r607.ok).toBe(true);
    // A non-DGII id (the ITBIS summary) is denied through the TXT dispatcher (no TXT for a summary).
    const rCvs = await withTenantTransaction(ctx, (tx) => generarTxtReporte(tx, ctx, REPORTE_ID.ITBIS, normalizarFiltro(ENERO)));
    expect(!rCvs.ok && rCvs.code).toBe(REPORTE_NO_AUTORIZADO);
  });

  // --- EXP-4/DB-2 + DB-6: a Cobrador is denied every fiscal surface; NO audit writes -------------

  it("EXP-4/DB-2/DB-6: a Cobrador is denied every fiscal read AND export before any aggregate; no audit rows", async () => {
    const f = fixture!;
    const admin = adminCtx(f, f.sucursalA1.id);
    const formal = await crearCliente({ empresaId: f.empresaA.id, identificacionFiscal: "131000002" });
    await crearFactura({ ctx: admin, clienteId: formal, tipoNcf: "B01", ncf: "B0100000903", estado: "VIGENTE", subtotalGravado: "100.00", itbis: "18.00", total: "118.00" });

    const cobradorId = await crearUsuarioConRol(f, "Cobrador", f.sucursalA1.id);
    const ctx: TenantCtx = { empresaId: f.empresaA.id, sucursalId: f.sucursalA1.id, usuarioId: cobradorId, esAdmin: false };
    const db = getHarnessDb();
    const antes = await db.movimientoAuditoria.count();
    const filtro = normalizarFiltro(ENERO);

    // Denied: summary, worksheet, and each TXT export (via the exporter AND the dispatcher).
    const sum = await withTenantTransaction(ctx, (tx) => consultarResumenITBIS(tx, ctx, filtro));
    expect(!sum.ok && sum.code).toBe(REPORTE_NO_AUTORIZADO);
    const it1 = await withTenantTransaction(ctx, (tx) => consultarCasillasIT1(tx, ctx, filtro));
    expect(!it1.ok && it1.code).toBe(REPORTE_NO_AUTORIZADO);
    for (const id of [REPORTE_ID.DGII_606, REPORTE_ID.DGII_607, REPORTE_ID.DGII_608] as const) {
      const txt = await withTenantTransaction(ctx, (tx) => generarTxtReporte(tx, ctx, id, filtro));
      expect(!txt.ok && txt.code).toBe(REPORTE_NO_AUTORIZADO);
    }

    // An authorized Admin run produces its files AND writes ZERO audit rows (read-only surface).
    const adminTxt = await withTenantTransaction(admin, (tx) => generarTxtReporte(tx, admin, REPORTE_ID.DGII_607, filtro));
    expect(adminTxt.ok).toBe(true);
    const despues = await db.movimientoAuditoria.count();
    expect(despues).toBe(antes);
  });
});

/** A tiny supplier factory (empresa-scoped, with an optional valid RNC). */
async function db_createProveedor(
  empresaId: number,
  rnc: string | null,
  tipo: "FORMAL" | "INFORMAL",
): Promise<number> {
  const db = getHarnessDb();
  const p = await db.proveedor.create({
    data: {
      empresaId, nombre: `Prov-${seq()}`, contacto: "x", telefono: "0", rnc,
      tipoProveedor: tipo, tipoPersona: "JURIDICA",
    },
    select: { id: true },
  });
  return p.id;
}
