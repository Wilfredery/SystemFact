/**
 * Integration — Reportes slice C: CxC aging, CxP, comparativa (real Postgres 16, RLS on,
 * `systemfact_app` role; FIN-1..FIN-5, EXP-2/EXP-4).
 *
 * Seeding runs on the trusted superuser harness client (bypasses RLS), exactly like the slice-A/B
 * suites; the code under test (the three `consultar*` use cases + the CSV exporters) runs through
 * the app role inside `withTenantTransaction`, so the RLS GUCs are in force as in production.
 *
 * Proves the spec scenarios slice C owns:
 *   - FIN-1  the CxC aging REUSES `consultarSaldoCxcEnTx` (per-invoice balance byte-equal to the
 *            canonical query) and a branch filter PINs the branch GUC (a plain predicate) instead
 *            of emptying it; no filter → company-wide widen.
 *   - FIN-2  aging buckets with the client credit term, and the DB `PLAZO_CREDITO` fallback when a
 *            client has no term (never hardcoded).
 *   - FIN-3  a Cobrador is pinned to CxC + own branch and DENIED every other family (CxP,
 *            comparativa) BEFORE any read; no client-supplied branch override is honoured.
 *   - FIN-4  CxP derives `Compra.total − ΣPagoProveedor(APLICADO)` over PENDIENTE/RECIBIDA; a
 *            fully-settled or PAGADA purchase nets 0; never materialized (no stored column).
 *   - FIN-5  comparativa contrasts the current window vs the immediately-preceding equal-length SD
 *            month, Decimal variation, zero baseline → 0%, Total row current-only, and a missing
 *            window → REPORTE_VALIDACION before any query.
 *   - EXP-2  a CxC/CxP CSV carries the full filtered dataset and its Σ equals the screen summary.
 *   - EXP-4  Cobrador CxC export is pinned to own branch; a Cobrador CxP export is denied; the
 *            whole reportes surface writes NO audit row.
 */

import { Prisma } from "@/generated/prisma/client";
import { Decimal } from "decimal.js";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import {
  withTenantTransaction,
  type PrismaTx,
} from "@/modules/tenant/infrastructure/withTenantTransaction";
import { consultarSaldoCxcEnTx } from "@/modules/cobros/infrastructure/saldo-cxc.repository";
import {
  consultarCxcAging,
  leerCxcAgingCompleto,
} from "@/modules/reportes/application/cxc-aging";
import {
  consultarComparativa,
  consultarCxP,
} from "@/modules/reportes/application/financiero";
import { generarCsvFinanciero } from "@/modules/reportes/application/exportar-financieros";
import { generarCsvReporte } from "@/modules/reportes/application/exportar";
import {
  conSucursalAmpliadaEnTx,
  conSucursalFijadaEnTx,
} from "@/modules/reportes/infrastructure/widen-sucursal-guc";
import { normalizarFiltro } from "@/modules/reportes/domain/reporte-filtro";
import { BUCKET_AGING } from "@/modules/reportes/domain/aging";
import { REPORTE_NO_AUTORIZADO, REPORTE_VALIDACION } from "@/modules/reportes/domain/errors";
import { REPORTE_ID } from "@/modules/reportes/domain/catalogo";
import {
  getHarnessDb,
  seedTenantFixture,
  type TenantFixture,
} from "./setup/fixtures";

let fixture: TenantFixture | null = null;

/** A fixed midday-UTC instant → unambiguously inside its own SD calendar day (15 Apr, 10:00 SD). */
const AHORA = new Date("2026-04-15T14:00:00.000Z");
/** `n` whole days before `AHORA` (the invoice emission instants for the aging fixtures). */
const diasAntes = (n: number): Date =>
  new Date(AHORA.getTime() - n * 86_400_000);

/** Monotonic counter so NCF / correlativo UNIQUE constraints never collide. */
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
    rol = await db.rol.create({ data: { nombre, descripcion: `${nombre} (reportes C)` } });
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
      nombreUsuario: `repC-${rolNombre.toLowerCase()}-${empresaId}-${sucursalId}-${Date.now()}-${seq()}`,
      passwordHash: "test-hash",
      roles: { create: { rolId: rid } },
    },
    select: { id: true },
  });
  return u.id;
}

/** Create a client with an explicit `plazoCreditoDias` (0 = "no term", the DB-parameter case). */
async function crearCliente(
  f: TenantFixture,
  empresaId: number,
  plazoCreditoDias: number,
): Promise<number> {
  const db = getHarnessDb();
  const c = await db.cliente.create({
    data: {
      empresaId,
      nombre: `Cliente-${empresaId}-${seq()}`,
      telefono: "0",
      direccion: "x",
      tipoCliente: "CREDITO",
      esConsumidorFinal: false,
      identificacionFiscal: null,
      creditoHabilitado: true,
      limiteCredito: new Prisma.Decimal(100000),
      plazoCreditoDias,
    },
    select: { id: true },
  });
  return c.id;
}

/** The empresa's active `PLAZO_CREDITO` config row (wide validity), for the FIN-2 fallback. */
async function sembrarPlazoCredito(empresaId: number, dias: string): Promise<void> {
  const db = getHarnessDb();
  await db.configuracionEmpresa.create({
    data: {
      empresaId,
      clave: "PLAZO_CREDITO",
      valor: dias,
      vigenciaInicio: new Date("2000-01-01T00:00:00.000Z"),
      vigenciaFin: new Date("2099-12-31T23:59:59.000Z"),
      activa: true,
    },
  });
}

/** Create a VIGENTE invoice with a fixed `fechaEmision` and gross total (no payments). */
async function crearFactura(
  f: TenantFixture,
  opts: {
    empresaId: number;
    sucursalId: number;
    clienteId: number;
    total: string;
    fechaEmision: Date;
    estado?: "VIGENTE" | "CANCELADA";
  },
): Promise<number> {
  const db = getHarnessDb();
  const total = new Prisma.Decimal(opts.total);
  const ncf = `B01${String(seq()).padStart(9, "0")}`;
  const fac = await db.factura.create({
    data: {
      empresaId: opts.empresaId,
      sucursalId: opts.sucursalId,
      usuarioId: f.usuarios.adminA.id,
      clienteId: opts.clienteId,
      tipoNcf: "B01",
      ncf,
      correlativoInterno: ncf,
      estado: opts.estado ?? "VIGENTE",
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

/** Apply a COBRO/APLICADO payment to an invoice (drives the canonical derived balance). */
async function crearCobro(
  f: TenantFixture,
  opts: { empresaId: number; sucursalId: number; facturaId: number; monto: string },
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

/** A VIGENTE nota de crédito against an invoice (reduces the canonical balance — FIN-1 fixture). */
async function crearNotaCredito(
  f: TenantFixture,
  opts: { empresaId: number; sucursalId: number; clienteId: number; facturaId: number; monto: string },
): Promise<void> {
  const db = getHarnessDb();
  const monto = new Prisma.Decimal(opts.monto);
  const ncf = `B04${String(seq()).padStart(9, "0")}`;
  await db.notaCredito.create({
    data: {
      empresaId: opts.empresaId,
      sucursalId: opts.sucursalId,
      clienteId: opts.clienteId,
      usuarioId: f.usuarios.adminA.id,
      facturaOriginalId: opts.facturaId,
      ncf,
      estado: "VIGENTE",
      motivo: "Devolución parcial",
      monto,
      itbis: new Prisma.Decimal(0),
      fechaEmision: AHORA,
    },
  });
}

/** Create a purchase in a given estado with a gross total (FIN-4 fixture). */
async function crearCompra(
  f: TenantFixture,
  opts: {
    empresaId: number;
    sucursalId: number;
    proveedorId: number;
    total: string;
    estado: "PENDIENTE" | "RECIBIDA" | "PAGADA";
    fecha?: Date;
  },
): Promise<number> {
  const db = getHarnessDb();
  const total = new Prisma.Decimal(opts.total);
  const correlativo = `CMP-${seq()}`;
  const c = await db.compra.create({
    data: {
      empresaId: opts.empresaId,
      sucursalId: opts.sucursalId,
      proveedorId: opts.proveedorId,
      usuarioId: f.usuarios.adminA.id,
      tipoCompra: "MERCANCIA",
      estado: opts.estado,
      subtotal: total,
      subtotalGravado: total,
      itbis: new Prisma.Decimal(0),
      subtotalExento: new Prisma.Decimal(0),
      retencionIsr: new Prisma.Decimal(0),
      retencionItbis: new Prisma.Decimal(0),
      total,
      correlativoInterno: correlativo,
      fecha: opts.fecha ?? AHORA,
    },
    select: { id: true },
  });
  return c.id;
}

/** Apply a supplier payment (APLICADO) against a purchase (FIN-4 fixture). */
async function crearPagoProveedor(
  f: TenantFixture,
  opts: { empresaId: number; sucursalId: number; compraId: number; monto: string },
): Promise<void> {
  const db = getHarnessDb();
  await db.pagoProveedor.create({
    data: {
      empresaId: opts.empresaId,
      sucursalId: opts.sucursalId,
      usuarioId: f.usuarios.adminA.id,
      compraId: opts.compraId,
      metodoPago: "EFECTIVO",
      monto: new Prisma.Decimal(opts.monto),
      estado: "APLICADO",
      fecha: AHORA,
    },
  });
}

/** One CONFIRMADA single-line sale of `monto` at `fecha` (comparativa window fixtures). */
async function crearVentaMonto(
  f: TenantFixture,
  opts: { empresaId: number; sucursalId: number; clienteId: number; fecha: Date; monto: string },
): Promise<void> {
  const db = getHarnessDb();
  const total = new Prisma.Decimal(opts.monto);
  const v = await db.venta.create({
    data: {
      empresaId: opts.empresaId,
      sucursalId: opts.sucursalId,
      usuarioId: f.usuarios.adminA.id,
      clienteId: opts.clienteId,
      fecha: opts.fecha,
      estado: "CONFIRMADA",
      subtotal: total,
      descuento: new Prisma.Decimal(0),
      descuentoTipo: "PORCENTAJE",
      itbis: new Prisma.Decimal(0),
      total,
      detalles: {
        create: [
          {
            productoId: f.productos.prodA1.id,
            cantidad: new Prisma.Decimal("1.000"),
            precioUnitario: total,
            descuentoLinea: new Prisma.Decimal(0),
            descuentoTipo: "PORCENTAJE",
            tasaItbis: new Prisma.Decimal(0),
            itbisLinea: new Prisma.Decimal(0),
            subtotalLinea: total,
          },
        ],
      },
    },
    select: { id: true },
  });
  void v;
}

describe("reportes slice C — CxC aging / CxP / comparativa (real DB, RLS on)", () => {
  beforeEach(async () => {
    fixture = await seedTenantFixture();
  });

  // --- FIN-1: canonical reuse + branch narrowing without widen -------------------------------

  it("FIN-1: every aged CxC balance equals the canonical `consultarSaldoCxcEnTx` row byte-for-byte", async () => {
    const f = fixture!;
    const cliente = await crearCliente(f, f.empresaA.id, 30);
    // One unpaid, one partly-collected, one with a credit note, one fully settled, one cancelled.
    const open1 = await crearFactura(f, { empresaId: f.empresaA.id, sucursalId: f.sucursalA1.id, clienteId: cliente, total: "1000.00", fechaEmision: diasAntes(10) });
    const open2 = await crearFactura(f, { empresaId: f.empresaA.id, sucursalId: f.sucursalA1.id, clienteId: cliente, total: "500.00", fechaEmision: diasAntes(40) });
    await crearCobro(f, { empresaId: f.empresaA.id, sucursalId: f.sucursalA1.id, facturaId: open2, monto: "200.00" });
    const open3 = await crearFactura(f, { empresaId: f.empresaA.id, sucursalId: f.sucursalA1.id, clienteId: cliente, total: "800.00", fechaEmision: diasAntes(5) });
    await crearNotaCredito(f, { empresaId: f.empresaA.id, sucursalId: f.sucursalA1.id, clienteId: cliente, facturaId: open3, monto: "300.00" });
    const settled = await crearFactura(f, { empresaId: f.empresaA.id, sucursalId: f.sucursalA1.id, clienteId: cliente, total: "150.00", fechaEmision: diasAntes(3) });
    await crearCobro(f, { empresaId: f.empresaA.id, sucursalId: f.sucursalA1.id, facturaId: settled, monto: "150.00" });
    await crearFactura(f, { empresaId: f.empresaA.id, sucursalId: f.sucursalA1.id, clienteId: cliente, total: "999.00", fechaEmision: diasAntes(2), estado: "CANCELADA" });

    const ctx = adminCtx(f, f.sucursalA1.id);
    const filtro = normalizarFiltro({});
    const aging = await withTenantTransaction(ctx, (tx) =>
      leerCxcAgingCompleto(tx, ctx, filtro, { now: AHORA }),
    );
    expect(aging.ok).toBe(true);
    if (!aging.ok) return;

    // Independent canonical run (un-widened = the A1 branch, where every fixture lives).
    const canonicas = await withTenantTransaction(ctx, (tx) => consultarSaldoCxcEnTx(tx, ctx));
    const esperado = new Map(canonicas.map((c) => [c.facturaId, c.saldoPendiente]));

    // open1 → 1000.00, open2 → 500 − 200 = 300.00, open3 → 800 − 300 = 500.00 (all VIGENTE).
    expect(esperado.get(open1)).toBe("1000.00");
    expect(esperado.get(open2)).toBe("300.00");
    expect(esperado.get(open3)).toBe("500.00");
    // The report's per-invoice saldo is BYTE-equal to the canonical derivation (FIN-1 guard).
    for (const fila of aging.data.filas) {
      expect(fila.saldoPendiente).toBe(esperado.get(fila.facturaId));
    }
    // Only open invoices age; the fully-settled one is excluded, and the CANCELADA never appears.
    const ids = aging.data.filas.map((x) => x.facturaId).sort((a, b) => a - b);
    expect(ids).toEqual([open1, open2, open3].sort((a, b) => a - b));
    expect(aging.data.resumen.saldoTotal).toBe("1800.00"); // 1000 + 300 + 500
  });

  it("FIN-1: an admin branch filter PINs the branch GUC (never emptied); no filter → company-wide widen", async () => {
    const f = fixture!;
    const cliente = await crearCliente(f, f.empresaA.id, 30);
    const inA1 = await crearFactura(f, { empresaId: f.empresaA.id, sucursalId: f.sucursalA1.id, clienteId: cliente, total: "400.00", fechaEmision: diasAntes(5) });
    const inA2 = await crearFactura(f, { empresaId: f.empresaA.id, sucursalId: f.sucursalA2.id, clienteId: cliente, total: "700.00", fechaEmision: diasAntes(5) });

    const ctx = adminCtx(f, f.sucursalA1.id);

    // Company-wide (no filter → widen): BOTH branches appear.
    const amplio = await withTenantTransaction(ctx, (tx) =>
      consultarCxcAging(tx, ctx, normalizarFiltro({}), { now: AHORA }),
    );
    expect(amplio.ok).toBe(true);
    if (!amplio.ok) return;
    const idsAmplio = amplio.data.filas.map((x) => x.facturaId).sort((a, b) => a - b);
    expect(idsAmplio).toEqual([inA1, inA2].sort((a, b) => a - b));

    // Branch filter → A2 only (the widen is NOT used, else A1 would leak; the ctx is NOT used,
    // else only A1 would show — A2-only proves the GUC was PINNED to A2).
    const filtrado = await withTenantTransaction(ctx, (tx) =>
      consultarCxcAging(tx, ctx, normalizarFiltro({ sucursalId: f.sucursalA2.id }), { now: AHORA }),
    );
    expect(filtrado.ok).toBe(true);
    if (!filtrado.ok) return;
    expect(filtrado.data.filas.map((x) => x.facturaId)).toEqual([inA2]);

    // Direct proof: `conSucursalFijadaEnTx` sets a NON-empty branch GUC for the read (never "").
    const valorGuc = await withTenantTransaction(ctx, (tx) =>
      conSucursalFijadaEnTx(tx, ctx, f.sucursalA2.id, async (tx2) => {
        const rows = await tx2.$queryRaw<{ v: string | null }[]>`
          SELECT current_setting('app.current_sucursal_id', true) AS "v"`;
        return rows[0]?.v ?? null;
      }),
    );
    expect(valorGuc).toBe(String(f.sucursalA2.id)); // pinned, not widened to ""
    // After the pin, the caller's branch is restored (the empresa anchor was never touched).
    const restaurado = await withTenantTransaction(ctx, (tx) =>
      tx.$queryRaw<{ v: string | null }[]>`SELECT current_setting('app.current_sucursal_id', true) AS "v"`,
    );
    expect(restaurado[0]?.v).toBe(String(f.sucursalA1.id));
  });

  // --- FIN-2: buckets with the client term + the DB PLAZO_CREDITO fallback ---------------------

  it("FIN-2: a client with no term ages by the DB PLAZO_CREDITO; a client term takes precedence", async () => {
    const f = fixture!;
    await sembrarPlazoCredito(f.empresaA.id, "30");
    const sinTermino = await crearCliente(f, f.empresaA.id, 0); // plazo 0 → DB param (30)
    const conTermino = await crearCliente(f, f.empresaA.id, 60); // plazo 60 → wins over param

    // Both invoices emitted 45 days before AHORA.
    const invSin = await crearFactura(f, { empresaId: f.empresaA.id, sucursalId: f.sucursalA1.id, clienteId: sinTermino, total: "500.00", fechaEmision: diasAntes(45) });
    const invCon = await crearFactura(f, { empresaId: f.empresaA.id, sucursalId: f.sucursalA1.id, clienteId: conTermino, total: "500.00", fechaEmision: diasAntes(45) });

    const ctx = adminCtx(f, f.sucursalA1.id);
    const r = await withTenantTransaction(ctx, (tx) =>
      consultarCxcAging(tx, ctx, normalizarFiltro({}), { now: AHORA }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const porId = new Map(r.data.filas.map((x) => [x.facturaId, x]));

    // No-term client: due = emission + 30 (DB param) = 15 days past → Vencido 1-30 (NOT 31-60 as
    // a hardcoded 0-term would give — that is the point of the guard).
    expect(porId.get(invSin)?.diasVencido).toBe(15);
    expect(porId.get(invSin)?.bucket).toBe(BUCKET_AGING.VENCIDO_1_30);
    // Client-term precedence: due = emission + 60 = 15 days FUTURE → not yet due → Al día.
    expect(porId.get(invCon)?.diasVencido).toBe(0);
    expect(porId.get(invCon)?.bucket).toBe(BUCKET_AGING.AL_DIA);
  });

  // --- FIN-3: Cobrador restricted to CxC + own branch, denied all other families ---------------

  it("FIN-3: a Cobrador is denied CxP and comparativa (zero read) and is pinned to CxC own branch", async () => {
    const f = fixture!;
    const cliente = await crearCliente(f, f.empresaA.id, 30);
    await crearFactura(f, { empresaId: f.empresaA.id, sucursalId: f.sucursalA1.id, clienteId: cliente, total: "300.00", fechaEmision: diasAntes(5) });
    await crearFactura(f, { empresaId: f.empresaA.id, sucursalId: f.sucursalA2.id, clienteId: cliente, total: "900.00", fechaEmision: diasAntes(5) });
    await crearCompra(f, { empresaId: f.empresaA.id, sucursalId: f.sucursalA1.id, proveedorId: f.proveedores.formalJuridica.id, total: "1000.00", estado: "RECIBIDA" });

    const cobradorId = await crearUsuarioConRol(f, "Cobrador", f.sucursalA1.id, f.empresaA.id);
    const ctx: TenantCtx = {
      empresaId: f.empresaA.id,
      sucursalId: f.sucursalA1.id,
      usuarioId: cobradorId,
      esAdmin: false,
    };
    const filtro = normalizarFiltro({});

    // CxP + comparativa → REPORTE_NO_AUTORIZADO (denied before any aggregate).
    const cxp = await withTenantTransaction(ctx, (tx) => consultarCxP(tx, ctx, filtro));
    expect(cxp.ok).toBe(false);
    if (cxp.ok) return;
    expect(cxp.code).toBe(REPORTE_NO_AUTORIZADO);

    const comp = await withTenantTransaction(ctx, (tx) =>
      consultarComparativa(tx, ctx, normalizarFiltro({ desde: "2026-04-01", hasta: "2026-04-15" })),
    );
    expect(comp.ok).toBe(false);
    if (comp.ok) return;
    expect(comp.code).toBe(REPORTE_NO_AUTORIZADO);

    // CxC → allowed, PINNED to their own branch (A1 only); a client-supplied branch cannot override.
    const cxc = await withTenantTransaction(ctx, (tx) =>
      consultarCxcAging(tx, ctx, normalizarFiltro({ sucursalId: f.sucursalA2.id }), { now: AHORA }),
    );
    expect(cxc.ok).toBe(true);
    if (!cxc.ok) return;
    // The A2 override is ignored: only the Cobrador's own A1 invoice (300.00) appears.
    expect(cxc.data.resumen.saldoTotal).toBe("300.00");
    expect(cxc.data.filas.every((x) => x.saldoPendiente === "300.00")).toBe(true);
  });

  // --- FIN-4: CxP derived outstanding balance, never materialized ------------------------------

  it("FIN-4: CxP derives total − Σpagos; a settled/PAGADA purchase nets out; totals match", async () => {
    const f = fixture!;
    const prov = f.proveedores.formalJuridica.id;
    // RECIBIDA 1000 with 400 paid → 600 outstanding.
    const c1 = await crearCompra(f, { empresaId: f.empresaA.id, sucursalId: f.sucursalA1.id, proveedorId: prov, total: "1000.00", estado: "RECIBIDA" });
    await crearPagoProveedor(f, { empresaId: f.empresaA.id, sucursalId: f.sucursalA1.id, compraId: c1, monto: "400.00" });
    // RECIBIDA fully settled (1000 paid) → nets 0 → excluded.
    const c2 = await crearCompra(f, { empresaId: f.empresaA.id, sucursalId: f.sucursalA1.id, proveedorId: prov, total: "1000.00", estado: "RECIBIDA" });
    await crearPagoProveedor(f, { empresaId: f.empresaA.id, sucursalId: f.sucursalA1.id, compraId: c2, monto: "1000.00" });
    // PENDIENTE, nothing paid → full 250 outstanding.
    const c3 = await crearCompra(f, { empresaId: f.empresaA.id, sucursalId: f.sucursalA1.id, proveedorId: prov, total: "250.00", estado: "PENDIENTE" });
    // PAGADA → excluded by estado (never an open payable).
    await crearCompra(f, { empresaId: f.empresaA.id, sucursalId: f.sucursalA1.id, proveedorId: prov, total: "5000.00", estado: "PAGADA" });
    // Cross-tenant purchase (empresa B) → never visible to A.
    await crearCompra(f, { empresaId: f.empresaB.id, sucursalId: f.sucursalB1.id, proveedorId: f.proveedores.proveedorB.id, total: "99999.00", estado: "RECIBIDA" });

    const ctx = adminCtx(f, f.sucursalA1.id);
    const r = await withTenantTransaction(ctx, (tx) => consultarCxP(tx, ctx, normalizarFiltro({}), ));
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const porId = new Map(r.data.filas.map((x) => [x.compraId, x]));
    expect(porId.get(c1)?.saldoPendiente).toBe("600.00");
    expect(porId.get(c1)?.pagado).toBe("400.00");
    expect(porId.get(c3)?.saldoPendiente).toBe("250.00");
    // c2 (settled) and the PAGADA contribute nothing; only two rows, totals = 600 + 250 = 850.
    expect(porId.has(c2)).toBe(false);
    expect(r.data.filas).toHaveLength(2);
    expect(r.data.resumen.saldoTotal).toBe("850.00");
    expect(r.data.resumen.comprasAbiertas).toBe("2");

    // "never materialized": COMPRA stores no payable/balance column.
    const columnas = await getHarnessDb().$queryRaw<{ nombre: string }[]>`
      SELECT "column_name" AS nombre FROM information_schema.columns WHERE "table_name" = 'COMPRA'`;
    expect(columnas.filter((c) => /saldo|pagado|pendiente|abono|pago/i.test(c.nombre))).toEqual([]);
  });

  // --- FIN-5: comparativa current vs preceding equal-length window -----------------------------

  it("FIN-5: comparativa reports current, preceding, and the exact Decimal variation", async () => {
    const f = fixture!;
    const cliente = await crearCliente(f, f.empresaA.id, 30);
    // Current (March 2026): 100 on 03-10, 50 on 03-20 → 150. Preceding (Feb 2026): 60 on 02-10 → 60.
    await crearVentaMonto(f, { empresaId: f.empresaA.id, sucursalId: f.sucursalA1.id, clienteId: cliente, fecha: new Date("2026-03-10T14:00:00.000Z"), monto: "100.00" });
    await crearVentaMonto(f, { empresaId: f.empresaA.id, sucursalId: f.sucursalA1.id, clienteId: cliente, fecha: new Date("2026-03-20T14:00:00.000Z"), monto: "50.00" });
    await crearVentaMonto(f, { empresaId: f.empresaA.id, sucursalId: f.sucursalA1.id, clienteId: cliente, fecha: new Date("2026-02-10T14:00:00.000Z"), monto: "60.00" });

    const ctx = adminCtx(f, f.sucursalA1.id);
    const r = await withTenantTransaction(ctx, (tx) =>
      consultarComparativa(tx, ctx, normalizarFiltro({ desde: "2026-03-01", hasta: "2026-03-31" })),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.resumen.montoActual).toBe("150.00");
    expect(r.data.resumen.montoAnterior).toBe("60.00");
    expect(r.data.resumen.variacionMonto).toBe("90.00");
    expect(r.data.resumen.variacionPorciento).toBe("150.00"); // 90 / 60 × 100
    // Total row is CURRENT only: the day rows sum to the current-window total.
    const suma = r.data.filas.reduce((acc, x) => acc.plus(new Decimal(x.monto)), new Decimal(0));
    expect(suma.toFixed(2)).toBe("150.00");
  });

  it("FIN-5: a zero preceding baseline yields 0% variation; a missing window is refused before any query", async () => {
    const f = fixture!;
    const cliente = await crearCliente(f, f.empresaA.id, 30);
    // Only March sales; nothing in the preceding February window.
    await crearVentaMonto(f, { empresaId: f.empresaA.id, sucursalId: f.sucursalA1.id, clienteId: cliente, fecha: new Date("2026-03-15T14:00:00.000Z"), monto: "250.00" });

    const ctx = adminCtx(f, f.sucursalA1.id);
    const r = await withTenantTransaction(ctx, (tx) =>
      consultarComparativa(tx, ctx, normalizarFiltro({ desde: "2026-03-01", hasta: "2026-03-31" })),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.resumen.montoAnterior).toBe("0.00");
    expect(r.data.resumen.variacionPorciento).toBe("0.00"); // zero baseline → no division by zero
    expect(r.data.resumen.variacionMonto).toBe("250.00");
    // Total row = current only.
    expect(r.data.resumen.montoActual).toBe("250.00");

    // A missing (open-ended) window is refused with REPORTE_VALIDACION, without a comparison query.
    const invalido = await withTenantTransaction(ctx, (tx) =>
      consultarComparativa(tx, ctx, normalizarFiltro({})),
    );
    expect(invalido.ok).toBe(false);
    if (invalido.ok) return;
    expect(invalido.code).toBe(REPORTE_VALIDACION);
  });

  // --- EXP-2 / EXP-4: export parity + role gates -----------------------------------------------

  it("EXP-2: the CxC CSV carries the full filtered dataset and its Σ equals the screen summary", async () => {
    const f = fixture!;
    const cliente = await crearCliente(f, f.empresaA.id, 30);
    await crearFactura(f, { empresaId: f.empresaA.id, sucursalId: f.sucursalA1.id, clienteId: cliente, total: "300.00", fechaEmision: diasAntes(10) });
    await crearFactura(f, { empresaId: f.empresaA.id, sucursalId: f.sucursalA1.id, clienteId: cliente, total: "400.00", fechaEmision: diasAntes(40) });
    await crearFactura(f, { empresaId: f.empresaA.id, sucursalId: f.sucursalA1.id, clienteId: cliente, total: "500.00", fechaEmision: diasAntes(70) });

    const ctx = adminCtx(f, f.sucursalA1.id);
    const filtroPagina = normalizarFiltro({ pageSize: 1 });

    const pantalla = await withTenantTransaction(ctx, (tx) =>
      consultarCxcAging(tx, ctx, filtroPagina, { now: AHORA }),
    );
    expect(pantalla.ok).toBe(true);
    if (!pantalla.ok) return;
    expect(pantalla.data.filas).toHaveLength(1); // one page
    expect(pantalla.data.resumen.saldoTotal).toBe("1200.00"); // whole-window summary

    const csv = await withTenantTransaction(ctx, (tx) =>
      generarCsvReporte(tx, ctx, REPORTE_ID.CXC, filtroPagina),
    );
    expect(csv.ok).toBe(true);
    if (!csv.ok) return;
    const lineas = csv.data.csv.split("\r\n").filter((l) => l.length > 0);
    // EXP-1: UTF-8 no BOM + CRLF; EXP-2: full dataset (3 detail rows), page-independent.
    expect(csv.data.csv.charCodeAt(0)).not.toBe(0xfeff);
    const detalle = lineas.slice(1).filter((l) => /^\d+,\d+,/.test(l));
    expect(detalle).toHaveLength(3);
    const suma = detalle.reduce((acc, d) => acc.plus(new Decimal(d.split(",")[5] ?? "0")), new Decimal(0));
    expect(suma.toFixed(2)).toBe(pantalla.data.resumen.saldoTotal);
  });

  it("EXP-4: a Cobrador CxC export is pinned to own branch; a Cobrador CxP export is denied; no audit writes", async () => {
    const f = fixture!;
    const cliente = await crearCliente(f, f.empresaA.id, 30);
    await crearFactura(f, { empresaId: f.empresaA.id, sucursalId: f.sucursalA1.id, clienteId: cliente, total: "300.00", fechaEmision: diasAntes(5) });
    await crearFactura(f, { empresaId: f.empresaA.id, sucursalId: f.sucursalA2.id, clienteId: cliente, total: "700.00", fechaEmision: diasAntes(5) });

    const cobradorId = await crearUsuarioConRol(f, "Cobrador", f.sucursalA1.id, f.empresaA.id);
    const ctx: TenantCtx = {
      empresaId: f.empresaA.id,
      sucursalId: f.sucursalA1.id,
      usuarioId: cobradorId,
      esAdmin: false,
    };
    const db = getHarnessDb();
    const antes = await db.movimientoAuditoria.count();
    const filtro = normalizarFiltro({});

    // CxC export: only the Cobrador's own A1 invoice (300.00) — pinned, not company-wide.
    const cxc = await withTenantTransaction(ctx, (tx) =>
      generarCsvFinanciero(tx, ctx, REPORTE_ID.CXC, filtro, { now: AHORA }),
    );
    expect(cxc.ok).toBe(true);
    if (!cxc.ok) return;
    expect(cxc.data.csv).toContain("300.00");
    expect(cxc.data.csv).not.toContain("700.00");
    // The footer TOTAL CxC reflects the own-branch figure only.
    expect(cxc.data.csv).toContain("TOTAL CxC");
    expect(cxc.data.csv).toContain("300.00");

    // CxP export: denied for the Cobrador (the dispatcher routes it to the financial exporter).
    const cxp = await withTenantTransaction(ctx, (tx) =>
      generarCsvReporte(tx, ctx, REPORTE_ID.CXP, filtro),
    );
    expect(cxp.ok).toBe(false);
    if (cxp.ok) return;
    expect(cxp.code).toBe(REPORTE_NO_AUTORIZADO);

    const despues = await db.movimientoAuditoria.count();
    expect(despues).toBe(antes);
  });
});

/**
 * Guards the widen path used by the admin company-wide reads is the ratified helper (DB-4): a
 * direct sanity that `conSucursalAmpliadaEnTx` empties the branch GUC for the read then restores.
 */
describe("reportes slice C — widen vs pin are distinct (DB-4 / FIN-1)", () => {
  beforeEach(async () => {
    fixture = await seedTenantFixture();
  });

  it("conSucursalAmpliadaEnTx empties the branch GUC for the read; the pin does not", async () => {
    const f = fixture!;
    const ctx = adminCtx(f, f.sucursalA1.id);
    const leido = async (tx: PrismaTx): Promise<string | null> => {
      const rows = await tx.$queryRaw<{ v: string | null }[]>`
        SELECT current_setting('app.current_sucursal_id', true) AS "v"`;
      return rows[0]?.v ?? null;
    };
    const ampliada = await withTenantTransaction(ctx, (tx) => conSucursalAmpliadaEnTx(tx, ctx, (t) => leido(t)));
    expect(ampliada).toBe(""); // widened (emptied) for the read
    const fijada = await withTenantTransaction(ctx, (tx) => conSucursalFijadaEnTx(tx, ctx, f.sucursalA2.id, (t) => leido(t)));
    expect(fijada).toBe(String(f.sucursalA2.id)); // pinned, never emptied
  });
});
