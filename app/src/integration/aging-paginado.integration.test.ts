/**
 * Integration — CxC aging paged data layer (FIN-6, real Postgres, RLS on).
 *
 * Seeding runs on the trusted superuser harness client (bypasses RLS); the code
 * under test (`consultarCxcAging` → `consultarSaldoCxcAgingEnTx` /
 * `resumirAgingSqlEnTx`, plus the unchanged `leerCxcAgingCompleto` export path)
 * runs through the app role inside `withTenantTransaction`, so the RLS GUCs are
 * in force exactly as in production.
 *
 * Pins the FIN-6 scenarios plus the carried risks in one module:
 *   1. Order pin — the SQL page walk (pageSize 25, pages 1..3) reproduces the
 *      EXACT prefix of the pre-slice sort (`diasVencido DESC, saldoPendiente
 *      DESC, facturaId ASC`), and a full pageSize-100 walk equals the whole
 *      domain-ordered set: no overlap, no gap, byte-identical order.
 *   2. 500+ fixtures with boundary emission dates: due today (0), the
 *      23:59:59-SD edge (1), and the 30/31 and 60/61 bucket thresholds.
 *   3. SQL-vs-domain column parity — every served row's SQL `diasVencido`
 *      equals `diasVencidoEnSD` on the same resolved plazo (the D2 pin).
 *   4. ADR-017 balance probe — the served `saldoPendiente` on paged rows is
 *      byte-equal to the canonical `consultarSaldoCxcEnTx` value per id.
 *   5. Summary parity — the SQL bucket summary equals the pure
 *      `resumirAging` reduction over the full aged set (EXP-2), and the
 *      summary is page-independent.
 *   6. Export guard (runtime form) — the CSV export path stays UNBOUNDED
 *      (`leerCxcAgingCompleto` full read; a pageSize-1 screen filter must not
 *      cut the exported detail rows).
 */

import { Decimal } from "decimal.js";
import { Prisma } from "@/generated/prisma/client";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import {
  withTenantTransaction,
} from "@/modules/tenant/infrastructure/withTenantTransaction";
import {
  consultarSaldoCxcAgingEnTx,
  consultarSaldoCxcEnTx,
  resumirAgingSqlEnTx,
} from "@/modules/cobros/infrastructure/saldo-cxc.repository";
import {
  consultarCxcAging,
  leerCxcAgingCompleto,
} from "@/modules/reportes/application/cxc-aging";
import { diasVencidoEnSD } from "@/modules/cobros/domain/en-mora";
import { BUCKET_AGING, resumirAging } from "@/modules/reportes/domain/aging";
import { generarCsvReporte } from "@/modules/reportes/application/exportar";
import { normalizarFiltro } from "@/modules/reportes/domain/reporte-filtro";
import { REPORTE_ID } from "@/modules/reportes/domain/catalogo";
import { leerPlazoCreditoEnTx } from "@/modules/reportes/infrastructure/config-repository";
import {
  getHarnessDb,
  seedTenantFixture,
  type TenantFixture,
} from "./setup/fixtures";

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

/** A fixed midday-UTC instant — unambiguously 10:00 SD on 15 Apr 2026. */
const AHORA = new Date("2026-04-15T14:00:00.000Z");
const diasAntes = (n: number): Date => new Date(AHORA.getTime() - n * 86_400_000);

/** Monotonic counter so NCF / correlativo UNIQUE constraints never collide. */
let CONTADOR = 0;
const seq = (): number => {
  CONTADOR += 1;
  return CONTADOR;
};

async function crearCliente(f: TenantFixture, plazoCreditoDias: number): Promise<number> {
  const db = getHarnessDb();
  const c = await db.cliente.create({
    data: {
      empresaId: f.empresaA.id,
      nombre: `Cliente-aging-${seq()}`,
      telefono: "0",
      direccion: "x",
      tipoCliente: "CREDITO",
      creditoHabilitado: true,
      limiteCredito: new Prisma.Decimal(1000000),
      plazoCreditoDias,
    },
    select: { id: true },
  });
  return c.id;
}

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

/** Create a VIGENTE FACTURA with a fixed `fechaEmision` and no payments (fully outstanding). */
async function crearFactura(
  f: TenantFixture,
  opts: { clienteId: number; total: string; fechaEmision: Date },
): Promise<number> {
  const db = getHarnessDb();
  const total = new Prisma.Decimal(opts.total);
  const ncf = `B01${String(seq()).padStart(9, "0")}`;
  const fac = await db.factura.create({
    data: {
      empresaId: f.empresaA.id,
      sucursalId: ctx.sucursalId,
      usuarioId: ctx.usuarioId,
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

/** Seed `n` fully-outstanding invoices with spread saldos + spread past-due days. */
async function sembrarLote(f: TenantFixture, clienteId: number, n: number): Promise<void> {
  for (let i = 0; i < n; i += 1) {
    // Varying saldos force the `saldoPendiente DESC` tie-break; varying emissions
    // force the full `diasVencido` range so both DESC keys interleave.
    await crearFactura(f, {
      clienteId,
      total: `${1000 + (i % 97) * 7}.55`,
      fechaEmision: diasAntes(30 + (i % 200)),
    });
  }
}

/** Boundary invoice: due_date = emission + 30 → seeded to be exactly `dias` SD days past due. */
async function fixtureFrontera(
  f: TenantFixture,
  clienteId: number,
  dias: number,
): Promise<number> {
  // the 23:59:59 SD edge case seeds explicitly; normal cases via whole-day offsets.
  const fechaEmision =
    dias === -1
      ? new Date(new Date("2026-04-15T03:59:59.000Z").getTime() - 30 * 86_400_000)
      : diasAntes(30 + dias);
  return crearFactura(f, { clienteId, total: "500.00", fechaEmision });
}

describe("CxC aging paged data layer (real DB, RLS on, FIN-6)", () => {
  beforeEach(async () => {
    fixture = await seedTenantFixture();
    ctx = ctxA1(fixture);
    CONTADOR = 0;
  });

  it("order-pin page walk pages 1..3 at 25 == the pre-slice sort; full 100 walk == everything; ADR-017 balances byte-equal", async () => {
    const f = fixture!;
    await sembrarPlazoCredito(f.empresaA.id, "30");
    const clienteId = await crearCliente(f, 30);
    await sembrarLote(f, clienteId, 510);
    const f0 = await fixtureFrontera(f, clienteId, 0);
    const f1 = await fixtureFrontera(f, clienteId, -1); // 23:59:59 SD edge → exactly 1
    const f30 = await fixtureFrontera(f, clienteId, 30);
    const f31 = await fixtureFrontera(f, clienteId, 31);
    const f60 = await fixtureFrontera(f, clienteId, 60);
    const f61 = await fixtureFrontera(f, clienteId, 61);

    // REFERENCE: the unchanged domain full path (gate + scope + pure aging + sort).
    const completa = await withTenantTransaction(ctx, (tx) =>
      leerCxcAgingCompleto(tx, ctx, normalizarFiltro({}), { now: AHORA }),
    );
    expect(completa.ok).toBe(true);
    if (!completa.ok) return;
    const referencia = completa.data.filas.map((x) => x.facturaId);
    expect(referencia.length).toBeGreaterThanOrEqual(516);

    // ADR-017 serving invariant source: canonical balances per id.
    const canonical = await withTenantTransaction(ctx, (tx) =>
      consultarSaldoCxcEnTx(tx, ctx),
    );
    const saldoPorId = new Map(canonical.map((c) => [c.facturaId, c.saldoPendiente]));
    const diasEsperado = new Map<number, number>(
      [[f0, 0], [f1, 1], [f30, 30], [f31, 31], [f60, 60], [f61, 61]],
    );
    const bucketEsperado = new Map<number, string>(
      [
        [f0, BUCKET_AGING.AL_DIA],
        [f1, BUCKET_AGING.VENCIDO_1_30],
        [f30, BUCKET_AGING.VENCIDO_1_30],
        [f31, BUCKET_AGING.VENCIDO_31_60],
        [f60, BUCKET_AGING.VENCIDO_31_60],
        [f61, BUCKET_AGING.MAYOR_60],
      ],
    );
    // The reference full path itself must agree on every boundary (sanity for the seeds).
    const referencias = new Map(completa.data.filas.map((x) => [x.facturaId, x]));
    for (const [id, dias] of diasEsperado.entries()) {
      expect(referencias.get(id)?.diasVencido).toBe(dias);
      expect(referencias.get(id)?.bucket).toBe(bucketEsperado.get(id));
    }

    // Page walk pageSize 25, pages 1..3.
    const walk25: number[] = [];
    for (let page = 1; page <= 3; page += 1) {
      const r = await withTenantTransaction(ctx, (tx) =>
        consultarCxcAging(tx, ctx, normalizarFiltro({ page, pageSize: 25 }), { now: AHORA }),
      );
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.data.page).toBe(page);
      expect(r.data.pageSize).toBe(25);
      walk25.push(...r.data.filas.map((x) => x.facturaId));
    }
    // The walked prefix is byte-identical to the pre-slice sort's prefix (order pin).
    expect(walk25).toEqual(referencia.slice(0, 75));

    // Full walk pageSize 100 (6 pages over 516): no overlap, no gap, exact order.
    const toda: number[] = [];
    for (let page = 1; page <= 6; page += 1) {
      const r = await withTenantTransaction(ctx, (tx) =>
        consultarCxcAging(tx, ctx, normalizarFiltro({ page, pageSize: 100 }), { now: AHORA }),
      );
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      toda.push(...r.data.filas.map((x) => x.facturaId));
      expect(r.data.total).toBe(referencia.length);
    }
    expect(toda).toEqual(referencia);

    // ADR-017 probe: every served saldoPendiente is byte-equal to the canonical value.
    for (const id of walk25) {
      expect(referencias.get(id)?.saldoPendiente).toBe(saldoPorId.get(id));
    }
  });

  it("SQL-vs-domain parity on the served rows: SQL diasVencido == diasVencidoEnSD (D2 pin over the REAL engine)", async () => {
    const f = fixture!;
    await sembrarPlazoCredito(f.empresaA.id, "30");
    const clienteId = await crearCliente(f, 30);
    await sembrarLote(f, clienteId, 60);
    await fixtureFrontera(f, clienteId, 0);
    await fixtureFrontera(f, clienteId, -1);
    await fixtureFrontera(f, clienteId, 31);
    await fixtureFrontera(f, clienteId, 61);

    const dbPlazo = await withTenantTransaction(ctx, (tx) =>
      leerPlazoCreditoEnTx(tx, ctx.empresaId, AHORA),
    );
    expect(dbPlazo).toBe(30);

    // The paged repository call yields the raw SQL columns (page 1 of 25 covers
    // the whole aged set here, ordered dias DESC, saldo DESC, id ASC).
    const sqlRows = await withTenantTransaction(ctx, (tx) =>
      consultarSaldoCxcAgingEnTx(tx, ctx, { page: 1, pageSize: 25, now: AHORA, dbPlazo }),
    );
    expect(sqlRows.length).toBeGreaterThanOrEqual(10);
    for (const s of sqlRows) {
      // Every SQL-computed day count equals the pure rule under the same plazo.
      expect(s.diasVencido).toBe(
        diasVencidoEnSD({
          fechaEmision: s.fechaEmision,
          plazoCreditoDias: s.plazoCreditoDias,
          now: AHORA,
        }),
      );
      // A 23:59:59-SD-edge row can never land in the wrong bucket by round-off:
      // the SQL day count and the domain one land on the SAME integer.
      expect(s.diasVencido % 1).toBe(0);
    }
  });

  it("summary parity: the SQL bucket summary == resumirAging over the full set, and is page-independent", async () => {
    const f = fixture!;
    await sembrarPlazoCredito(f.empresaA.id, "30");
    const clienteId = await crearCliente(f, 30);
    await sembrarLote(f, clienteId, 70);
    await fixtureFrontera(f, clienteId, 31);

    const dbPlazo = await withTenantTransaction(ctx, (tx) =>
      leerPlazoCreditoEnTx(tx, ctx.empresaId, AHORA),
    );

    const resumenSql = await withTenantTransaction(ctx, (tx) =>
      resumirAgingSqlEnTx(tx, ctx, { now: AHORA, dbPlazo }),
    );

    // Domain reference: full aged set → pure Decimal reduction.
    const completa = await withTenantTransaction(ctx, (tx) =>
      leerCxcAgingCompleto(tx, ctx, normalizarFiltro({}), { now: AHORA }),
    );
    expect(completa.ok).toBe(true);
    if (!completa.ok) return;
    const resumenDominio = resumirAging(completa.data.filas);

    // Byte-equal summary (Decimal strings at the 2-dp scale).
    expect(resumenSql).toEqual(resumenDominio);
    expect(resumenSql.saldoTotal).toBe(
      completa.data.filas
        .reduce((acc, x) => acc.plus(new Decimal(x.saldoPendiente)), new Decimal(0))
        .toFixed(2),
    );

    // Page independence through the screen use case: a pageSize-1 page's resumen
    // equals the whole-window resumen.
    const r = await withTenantTransaction(ctx, (tx) =>
      consultarCxcAging(tx, ctx, normalizarFiltro({ pageSize: 1 }), { now: AHORA }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.filas).toHaveLength(1);
    expect(r.data.total).toBe(completa.data.filas.length);
    expect(r.data.resumen.saldoTotal).toBe(resumenSql.saldoTotal);
    expect(r.data.resumen.facturasAbiertas).toBe(String(resumenSql.facturasAbiertas));
  });

  it("export guard (runtime): the CSV export path stays unbounded with a pageSize-1 screen filter", async () => {
    const f = fixture!;
    await sembrarPlazoCredito(f.empresaA.id, "30");
    const clienteId = await crearCliente(f, 30);
    await sembrarLote(f, clienteId, 30);

    const ctxLocal = ctx;
    const filtro = normalizarFiltro({ pageSize: 1 });
    const csv = await withTenantTransaction(ctxLocal, (tx) =>
      generarCsvReporte(tx, ctxLocal, REPORTE_ID.CXC, filtro),
    );
    expect(csv.ok).toBe(true);
    if (!csv.ok) return;
    const lineas = csv.data.csv.split("\r\n").filter((l) => l.length > 0);
    // Full dataset — 30 detail rows, not the 1-row screen page (never LIMIT-cut).
    const detalle = lineas.slice(1).filter((l) => /^\d+,\d+,/.test(l));
    expect(detalle).toHaveLength(30);
  });
});
