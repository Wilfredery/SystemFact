/**
 * Integration — CxC board SERVER-side pagination (R-C9, real Postgres, RLS on).
 *
 * Seeding runs on the trusted superuser harness client (bypasses RLS); the code
 * under test (`consultarSaldoCxcPaginado` → `consultarSaldoCxcTableroEnTx`
 * + `contarSaldoCxcEnTx`) runs through the app role inside
 * `withTenantTransaction`, so the RLS GUCs are in force exactly as in production.
 *
 * Pins the five R-C9 scenarios in one module:
 *   1. Default page — 70 VIGENTE outstanding invoices → 25 rows + filtered
 *      total 70 + typed metadata (page/pageSize/totalPages).
 *   2. Page-size clamp — 250 clamps to 100 rows at the DB (110-fixture set),
 *      and 0 normalizes to the default 25.
 *   3. Newest-emission-first ordering preserved — the page walk (pageSize 25,
 *      pages 1..N) concatenates to the EXACT sequence the canonical full
 *      aggregate produceza; identical at pageSize 100; no pages overlap or gap.
 *   4. PAGADA-boundary parity (risk #4) — the SQL outstanding predicate
 *      `cobrosAplicados < total` re-encodes ONLY the `clasificarEstadoPago`
 *      PAGADA threshold: applied = total =) excluded, applied = total − 0.01 =
 *      included, applied = 0 = included, applied > total = excluded, and a
 *      debit-note re-inflation (applied = total, saldo > 0 via a VIGENTE B03
 *      nota) stays EXCLUDED — the wrapper filters on the classifier threshold,
 *      never on `saldoPendiente`.
 *   5. ADR-017 serving invariant — the canonical full read
 *      (`consultarSaldoCxcEnTx`) is queried verbatim in test 3 as the
 *      order/serves-set reference; its byte-identity is guarded by the grep-diff
 *      check (task 2.7), not by a fixture here.
 */

import { Decimal } from "decimal.js";
import { Prisma } from "@/generated/prisma/client";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import { withTenantTransaction } from "@/modules/tenant/infrastructure/withTenantTransaction";
import {
  consultarSaldoCxcEnTx,
} from "@/modules/cobros/infrastructure/saldo-cxc.repository";
import {
  consultarSaldoCxcPaginado,
} from "@/modules/cobros/application/consultar-saldo-cxc";
import { ESTADO_PAGO_DERIVADO } from "@/modules/cobros/domain/pago";
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

let reciboSeq = 0;
let ncfSeq = 0;

const BASE_FECHA = new Date("2026-09-01T00:00:00.000Z");

/** Create a CLIENTE (CREDITO) for the tenant; returns its id. */
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

/** Create a VIGENTE FACTURA with a unique minute-staggered emission instant. */
async function crearFactura(
  clienteId: number,
  total: string,
  minutos: number,
): Promise<number> {
  const db = getHarnessDb();
  ncfSeq += 1;
  const f = await db.factura.create({
    data: {
      empresaId: ctx.empresaId,
      sucursalId: ctx.sucursalId,
      clienteId,
      usuarioId: ctx.usuarioId,
      tipoNcf: "B01",
      ncf: `B01${String(ncfSeq).padStart(10, "0")}`,
      correlativoInterno: `FAC-${ncfSeq}`,
      estado: "VIGENTE",
      subtotalGravado: new Prisma.Decimal(total),
      itbis: new Prisma.Decimal("0.00"),
      subtotalExento: new Prisma.Decimal("0.00"),
      descuento: new Prisma.Decimal("0.00"),
      total: new Prisma.Decimal(total),
      // Distinct instants make `fechaEmision DESC` a TOTAL order: higher id =
      // newer emission, so id DESC and fechaEmision DESC agree row-for-row.
      fechaEmision: new Date(BASE_FECHA.getTime() + minutos * 60_000),
    },
    select: { id: true },
  });
  return f.id;
}

/** Seed `n` VIGENTE invoices with zero applied cobros (all outstanding). */
async function crearOutstanding(clienteId: number, n: number): Promise<void> {
  for (let i = 0; i < n; i += 1) {
    await crearFactura(clienteId, "5000.00", i);
  }
}

/** Create a Pago (COBRO/APLICADO) for the given monto (single unique receipt). */
async function crearCobro(facturaId: number, monto: string): Promise<void> {
  const db = getHarnessDb();
  reciboSeq += 1;
  await db.pago.create({
    data: {
      facturaId,
      empresaId: ctx.empresaId,
      sucursalId: ctx.sucursalId,
      usuarioId: ctx.usuarioId,
      metodoPago: "EFECTIVO",
      monto: new Prisma.Decimal(monto),
      fecha: new Date("2026-09-05T12:00:00.000Z"),
      estado: "APLICADO",
      tipo: "COBRO",
      correlativoRecibo: reciboSeq,
    },
  });
}

/** Create a VIGENTE nota-de-débito (B03) against the given invoice. */
async function crearNotaDebito(
  clienteId: number,
  facturaId: number,
  monto: string,
): Promise<void> {
  const db = getHarnessDb();
  ncfSeq += 1;
  await db.notaDebito.create({
    data: {
      facturaOriginalId: facturaId,
      empresaId: ctx.empresaId,
      sucursalId: ctx.sucursalId,
      clienteId,
      usuarioId: ctx.usuarioId,
      ncf: `B03${String(ncfSeq).padStart(10, "0")}`,
      estado: "VIGENTE",
      motivo: "ajuste",
      monto: new Prisma.Decimal(monto),
      itbis: new Prisma.Decimal("0.00"),
      fechaEmision: new Date("2026-09-06T12:00:00.000Z"),
    },
  });
}

/** Read the PAGED board through the application use case. */
async function leerPagina(input: {
  page?: number;
  pageSize?: number;
}): Promise<{
  readonly filas: ReadonlyArray<{ facturaId: number; estadoPago: string }>;
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
  readonly totalPages: number;
}> {
  return withTenantTransaction(ctx, async (tx) => {
    const result = await consultarSaldoCxcPaginado(tx, ctx, input);
    if (!result.ok) throw new Error(result.message);
    return result.data;
  });
}

describe("CxC board server-side pagination (real DB, RLS on, R-C9)", () => {
  beforeEach(async () => {
    fixture = await seedTenantFixture();
    ctx = ctxA1(fixture);
    reciboSeq = 0;
    ncfSeq = 0;
  });

  it("default page: 70 VIGENTE outstanding → 25 rows + filtered total 70 + typed metadata", async () => {
    const clienteId = await crearCliente("Tablero Masivo");
    await crearOutstanding(clienteId, 70);

    const data = await leerPagina({ page: 1 });

    // Typed metadata (page boundaries computed server-side).
    expect(data.page).toBe(1);
    expect(data.pageSize).toBe(25);
    expect(data.total).toBe(70);
    expect(data.totalPages).toBe(3);
    // Exactly one page of invoice data returned.
    expect(data.filas).toHaveLength(25);
    // Newest emission first: the minute-staggered seeds make ids 70..46 the top.
    expect(data.filas[0]!.facturaId).toBe(70);
    expect(data.filas[24]!.facturaId).toBe(46);
  });

  it("page-size clamp: 250 → 100 rows from the DB and 0 → default 25", async () => {
    const clienteId = await crearCliente("Tablero Clamps");
    // 110 rows so the 100-cap actually caps the RESULT, not only the metadata.
    await crearOutstanding(clienteId, 110);

    const alta = await leerPagina({ page: 1, pageSize: 250 });
    expect(alta.pageSize).toBe(100);
    expect(alta.filas).toHaveLength(100);
    expect(alta.total).toBe(110);
    expect(alta.totalPages).toBe(2);

    const cero = await leerPagina({ page: 1, pageSize: 0 });
    expect(cero.pageSize).toBe(25);
    expect(cero.filas).toHaveLength(25);
  });

  it("order-pin page walk: pages 1..N at pageSize 25 reproduce the canonical order, identical at pageSize 100, no overlap/gap", async () => {
    const clienteId = await crearCliente("Tablero Orden");
    await crearOutstanding(clienteId, 70);

    const walk25: number[] = [];
    for (let page = 1; page <= 3; page += 1) {
      const data = await leerPagina({ page, pageSize: 25 });
      walk25.push(...data.filas.map((f) => f.facturaId));
    }
    // Sequences identical — unique ids, newest first, no overlap and no gap.
    expect(walk25).toHaveLength(70);
    expect(new Set(walk25).size).toBe(70);
    expect([...walk25].sort((a, b) => b - a)).toEqual(walk25);

    // The whole set in one pageSize-100 read: the SAME sequence.
    const toda = await leerPagina({ page: 1, pageSize: 100 });
    expect([...toda.filas.map((f) => f.facturaId)]).toEqual(walk25);
    expect(toda.totalPages).toBe(1);

    // Order/serving-set parity with the CANONICAL full aggregate (ADR-017
    // serving invariant: the page cut never changed the canonical query).
    const canonico = await withTenantTransaction(ctx, (tx) =>
      consultarSaldoCxcEnTx(tx, ctx),
    );
    const canonicoOutstanding = canonico
      .filter(
        (f) => new Decimal(f.cobrosAplicados).lt(new Decimal(f.total)),
      )
      .map((f) => f.facturaId);
    expect(canonicoOutstanding).toEqual(walk25);
  });

  it("PAGADA-boundary parity: the SQL predicate re-encodes ONLY the classifier's applied<total threshold", async () => {
    const clienteId = await crearCliente("Tablero Frontera");
    // Two plainly-outstanding invoices anchor the served set.
    const base1 = await crearFactura(clienteId, "10000.00", 10);
    const base2 = await crearFactura(clienteId, "10000.00", 11);

    // applied = total → PAGADA → excluded.
    const pagada = await crearFactura(clienteId, "10000.00", 20);
    await crearCobro(pagada, "10000.00");

    // applied = total − 0.01 → PARCIAL → included.
    const casi = await crearFactura(clienteId, "10000.00", 21);
    await crearCobro(casi, "9999.99");

    // applied = 0 → PENDIENTE → included.
    const pendiente = base2;

    // applied > total (cobros > total, direct-seed fixture) → classifier
    // PAGADA (`applied ≥ total`) → excluded.
    const exceso = await crearFactura(clienteId, "10000.00", 30);
    await crearCobro(exceso, "12000.00");

    // Debit-note re-inflation: applied = total but a VIGENTE B03 nota leaves
    // saldoPendiente > 0 — the wrapper is applied-vs-total, NOT saldo-based.
    const rei = await crearFactura(clienteId, "10000.00", 31);
    await crearCobro(rei, "10000.00");
    await crearNotaDebito(clienteId, rei, "5000.00");

    const data = await leerPagina({ page: 1 });

    const ids = data.filas.map((f) => f.facturaId);
    // Included: applied < total (0 and total − 0.01).
    expect(ids).toContain(base1);
    expect(ids).toContain(pendiente);
    expect(ids).toContain(casi);
    // Excluded: the classifier's PAGADA threshold — applied ≥ total, in
    // either flavor (over-collection raw or debit-note re-inflation).
    expect(ids).not.toContain(pagada);
    expect(ids).not.toContain(exceso);
    expect(ids).not.toContain(rei);

    // Metadata counts ONLY the outstanding filtered set.
    expect(data.total).toBe(3);
    expect(data.totalPages).toBe(1);

    // Parity invariant: no served row classifies as PAGADA — the SQL threshold
    // and the pure classifier can never disagree within a page.
    expect(
      data.filas.every((f) => f.estadoPago !== ESTADO_PAGO_DERIVADO.PAGADA),
    ).toBe(true);
  });
});
