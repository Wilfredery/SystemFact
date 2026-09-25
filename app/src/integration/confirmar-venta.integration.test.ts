/**
 * Integration — `confirmarVenta` → FACTURA emission against the REAL test DB
 * (RLS on, app role via `withTenantTransaction`), Phase 2 / pr5c2.
 *
 * Covers the R-V15 confirm boundary and R-F1..R-F4 emission: the emission gate
 * firing before any NCF burn (2.4), the HARD pre-consume stock block and the
 * foreign-branch not-found (2.5), the stable NCF codes surfaced through venta's
 * catalog with the sale left untouched (2.6), confirm idempotency on a retried
 * and a racing CONFIRMADA (2.7), the mixed-rate recomputed breakdown + atomic
 * FAC correlativo under parallel confirms on the SAME empresa (2.8, 2.9), and the
 * VIGENTE / 1:1 / branch-scoped / no-stored-balance invariants (2.10).
 *
 * LOCATION: real-DB suites live under `src/integration/` (the only harness with a
 * DB), matching Phase 1's `ncf-consume.integration.test.ts`; the unit config would
 * not reach the database.
 */

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { withTenantTransaction } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import { actualizarVenta, crearVenta } from "@/modules/venta/application/venta-service";
import { confirmarVenta } from "@/modules/venta/application/confirmar-venta";
import { consultarSaldoCxC } from "@/modules/cobros/application/consultar-saldo-cxc";
import { getHarnessDb, seedTenantFixture, type TenantFixture } from "./setup/fixtures";
import { crearProductoVenta, fijarStock } from "./setup/venta-helpers";

const CERO = { descuentoTipo: "PORCENTAJE", descuentoValor: "0.00" } as const;
const VIG_FIN = new Date("2099-12-31T23:59:59.000Z");

let fixture: TenantFixture | null = null;

function ctxA1(f: TenantFixture): TenantCtx {
  return { empresaId: f.empresaA.id, sucursalId: f.sucursalA1.id, usuarioId: f.usuarios.adminA.id, esAdmin: true };
}
/** Same company + user, but the session is bound to branch A2 (for the guard test). */
function ctxA2(f: TenantFixture): TenantCtx {
  return { empresaId: f.empresaA.id, sucursalId: f.sucursalA2.id, usuarioId: f.usuarios.adminA.id, esAdmin: true };
}

async function marcarFacturaAutomatica(empresaId: number, valor: boolean): Promise<void> {
  await getHarnessDb().empresa.update({ where: { id: empresaId }, data: { facturaAutomatica: valor } });
}

async function sembrarRango(
  empresaId: number,
  tipo: "B01" | "B02",
  s: { rangoInicio: number; rangoFin: number; secuenciaActual: number },
): Promise<void> {
  await getHarnessDb().ncfSecuencia.create({
    data: {
      empresaId,
      tipoNcf: tipo,
      rangoInicio: s.rangoInicio,
      rangoFin: s.rangoFin,
      secuenciaActual: s.secuenciaActual,
      vigenciaInicio: new Date("2000-01-01T00:00:00.000Z"),
      vigenciaFin: VIG_FIN,
      activa: true,
    },
  });
}

async function leerSecuenciaActual(empresaId: number, tipo: "B01" | "B02"): Promise<number> {
  const row = await getHarnessDb().ncfSecuencia.findUnique({ where: { empresaId_tipoNcf: { empresaId, tipoNcf: tipo } } });
  return row?.secuenciaActual ?? -1;
}

async function crearBorrador(
  ctx: TenantCtx,
  productoId: number,
  opts: { cantidad?: string; descuentoCabecera?: typeof CERO | { descuentoTipo: "PORCENTAJE"; descuentoValor: string } } = {},
): Promise<number> {
  return withTenantTransaction(ctx, async (tx) => {
    const r = await crearVenta(tx, ctx, {
      clienteId: null, // contado → Consumidor Final → B02
      fecha: new Date("2026-01-10T00:00:00.000Z"),
      lineas: [{ productoId, cantidad: opts.cantidad ?? "1", precioUnitario: "100.00", descuento: CERO }],
      descuentoCabecera: opts.descuentoCabecera,
    });
    if (!r.ok) throw new Error(`crearVenta falló: ${r.code}`);
    return r.data.id;
  });
}

/** Seed an active DESC_MAX window so a header-discount draft can be created. */
async function sembrarDescMax(empresaId: number, valor: string): Promise<void> {
  await getHarnessDb().configuracionEmpresa.create({
    data: { empresaId, clave: "DESC_MAX", valor, vigenciaInicio: new Date("2000-01-01T00:00:00.000Z"), vigenciaFin: VIG_FIN, activa: true },
  });
}

/**
 * A `CREDITO` client (non–Consumidor Final) with the given limit; `habilitado`
 * defaults true. Only the fiscal classification gates the sale (R-K1: the port,
 * not venta, decides credit-vs-contado from the client row).
 */
async function crearClienteCredito(
  ctx: TenantCtx,
  nombre: string,
  opts: { limite: string; habilitado?: boolean },
): Promise<number> {
  const db = getHarnessDb();
  const c = await db.cliente.create({
    data: {
      empresaId: ctx.empresaId,
      nombre,
      telefono: "0",
      direccion: "x",
      tipoCliente: "CREDITO",
      creditoHabilitado: opts.habilitado ?? true,
      limiteCredito: opts.limite,
      plazoCreditoDias: 0,
    },
    select: { id: true },
  });
  return c.id;
}

/** A draft (`BORRADOR`) for an EXPLICIT client, one in-stock line, no discount. */
async function crearBorradorCliente(ctx: TenantCtx, clienteId: number, productoId: number): Promise<number> {
  return withTenantTransaction(ctx, async (tx) => {
    const r = await crearVenta(tx, ctx, {
      clienteId,
      fecha: new Date("2026-01-10T00:00:00.000Z"),
      lineas: [{ productoId, cantidad: "1", precioUnitario: "100.00", descuento: CERO }],
    });
    if (!r.ok) throw new Error(`crearVenta falló: ${r.code}`);
    return r.data.id;
  });
}

/** A VIGENTE receivable (no sale) for a client, total as given — seeds existing pending. */
async function sembrarFacturaVigente(ctx: TenantCtx, clienteId: number, ncf: string, total: string): Promise<number> {
  const db = getHarnessDb();
  const f = await db.factura.create({
    data: {
      empresaId: ctx.empresaId,
      sucursalId: ctx.sucursalId,
      clienteId,
      usuarioId: ctx.usuarioId,
      tipoNcf: "B01",
      ncf,
      correlativoInterno: `FAC-${ncf}`,
      estado: "VIGENTE",
      subtotalGravado: total,
      itbis: "0.00",
      subtotalExento: "0.00",
      descuento: "0.00",
      total,
      // Fresh (today) so the over-limit reason is the LIMIT, never a 31-day mora.
      fechaEmision: new Date(),
    },
    select: { id: true },
  });
  return f.id;
}

/** Dedicated single-connection blocker client (the devolucion pattern). */
function crearClienteBloqueador(): PrismaClient {
  const directUrl = process.env.DIRECT_URL;
  if (directUrl === undefined || directUrl === "") {
    throw new Error("DIRECT_URL is not set; the blocker needs a superuser connection.");
  }
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: directUrl, max: 1 }) });
}

interface WaitingPid {
  readonly pid: number;
}

/**
 * Poll until at least one transaction is parked on a lock (v2r-10 protocol).
 * Fails loudly on timeout instead of proceeding non-deterministically.
 */
async function esperarUnEsperando(db: PrismaClient, contexto: string): Promise<void> {
  const inicio = Date.now();
  for (;;) {
    const esperando = await db.$queryRaw<WaitingPid[]>`
      SELECT a.pid
      FROM pg_stat_activity a
      WHERE a.wait_event_type = 'Lock'
        AND a.wait_event IS NOT NULL
        AND a.datname = current_database()
        AND a.pid <> pg_backend_pid()`;
    if (esperando.length >= 1) return;
    if (Date.now() - inicio > 15_000) {
      throw new Error(
        `Race parking failed (${contexto}): no transaction waiting after 15s`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
}

describe("confirmarVenta (real DB, RLS on)", () => {
  let catA: number;
  let ctx: TenantCtx;

  beforeEach(async () => {
    fixture = await seedTenantFixture();
    const db = getHarnessDb();
    catA = (await db.categoria.findFirst({ where: { empresaId: fixture.empresaA.id } }))!.id;
    ctx = ctxA1(fixture);
  });

  /** A priced product with branch-A1 stock; returns its id. */
  async function productoConStock(codigo: string, stock: string, tasa = 18): Promise<number> {
    const prod = await crearProductoVenta({ empresaId: fixture!.empresaA.id, categoriaId: catA, codigo, precioVenta: "100.00", tasa });
    await fijarStock(ctx.sucursalId, prod.id, stock);
    return prod.id;
  }

  it("emission gate: facturaAutomatica=false → FACTURA_AUTOMATICA_FALTA before any NCF burn (R-F1, 2.4)", async () => {
    const prod = await productoConStock("gate", "50.000");
    await sembrarRango(ctx.empresaId, "B02", { rangoInicio: 500, rangoFin: 1000, secuenciaActual: 521 });
    await marcarFacturaAutomatica(ctx.empresaId, false); // default false, explicit for intent
    const id = await crearBorrador(ctx, prod);

    const r = await withTenantTransaction(ctx, (tx) => confirmarVenta(tx, ctx, { id }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("FACTURA_AUTOMATICA_FALTA");

    // Sale untouched, no invoice, and the seeded sequence was NOT advanced.
    expect((await getHarnessDb().venta.findUnique({ where: { id } }))?.estado).toBe("BORRADOR");
    expect(await getHarnessDb().factura.count({ where: { ventaId: id } })).toBe(0);
    expect(await leerSecuenciaActual(ctx.empresaId, "B02")).toBe(521);
  });

  it("HARD stock preview rejects BEFORE burning (R-V15, 2.5) and a foreign-branch sale is not confirmable", async () => {
    const prod = await productoConStock("short", "2.000");
    await marcarFacturaAutomatica(ctx.empresaId, true);
    await sembrarRango(ctx.empresaId, "B02", { rangoInicio: 500, rangoFin: 1000, secuenciaActual: 521 });
    const id = await crearBorrador(ctx, prod, { cantidad: "5" }); // 5 > 2 available

    const r = await withTenantTransaction(ctx, (tx) => confirmarVenta(tx, ctx, { id }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("STOCK_INSUFICIENTE_BLOQUEO");
    expect(await getHarnessDb().factura.count({ where: { ventaId: id } })).toBe(0);
    expect(await leerSecuenciaActual(ctx.empresaId, "B02")).toBe(521); // no burn

    // Foreign branch: same tenant, but the session is bound to A2 while the sale is A1's.
    const ctx2 = ctxA2(fixture!);
    const r2 = await withTenantTransaction(ctx2, (tx) => confirmarVenta(tx, ctx2, { id }));
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.code).toBe("VENTA_NO_ENCONTRADO"); // behaves as not-found, zero disclosure
    expect((await getHarnessDb().venta.findUnique({ where: { id } }))?.estado).toBe("BORRADOR");
  });

  it("absent range → NCF_SEC_INEXISTENTE; exhausted → NCF_AGOTADA, typed via venta (R-V13, 2.6)", async () => {
    const prod = await productoConStock("ncf", "50.000");
    await marcarFacturaAutomatica(ctx.empresaId, true);

    // No B02 row at all.
    const id1 = await crearBorrador(ctx, prod);
    const r1 = await withTenantTransaction(ctx, (tx) => confirmarVenta(tx, ctx, { id: id1 }));
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.code).toBe("NCF_SEC_INEXISTENTE");

    // Exhausted range (secuenciaActual === rangoFin).
    await sembrarRango(ctx.empresaId, "B02", { rangoInicio: 500, rangoFin: 600, secuenciaActual: 600 });
    const id2 = await crearBorrador(ctx, prod);
    const r2 = await withTenantTransaction(ctx, (tx) => confirmarVenta(tx, ctx, { id: id2 }));
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.code).toBe("NCF_AGOTADA");
    expect(await leerSecuenciaActual(ctx.empresaId, "B02")).toBe(600); // unchanged
    expect((await getHarnessDb().venta.findUnique({ where: { id: id2 } }))?.estado).toBe("BORRADOR");
  });

  it("guarded flip: retried CONFIRMADA → VENTA_INMUTABLE with no second NCF/invoice (R-V15, 2.7)", async () => {
    const prod = await productoConStock("idem", "50.000");
    await marcarFacturaAutomatica(ctx.empresaId, true);
    await sembrarRango(ctx.empresaId, "B02", { rangoInicio: 500, rangoFin: 1000, secuenciaActual: 521 });
    const id = await crearBorrador(ctx, prod);

    const primero = await withTenantTransaction(ctx, (tx) => confirmarVenta(tx, ctx, { id }));
    expect(primero.ok).toBe(true);
    expect(await leerSecuenciaActual(ctx.empresaId, "B02")).toBe(522);

    const segundo = await withTenantTransaction(ctx, (tx) => confirmarVenta(tx, ctx, { id }));
    expect(segundo.ok).toBe(false);
    if (!segundo.ok) expect(segundo.code).toBe("VENTA_INMUTABLE");
    // No second burn, exactly one invoice still.
    expect(await leerSecuenciaActual(ctx.empresaId, "B02")).toBe(522);
    expect(await getHarnessDb().factura.count({ where: { ventaId: id } })).toBe(1);
  });

  it("double-click (parallel confirm of one sale): single flip, one NCF, one invoice", async () => {
    const prod = await productoConStock("race", "50.000");
    await marcarFacturaAutomatica(ctx.empresaId, true);
    await sembrarRango(ctx.empresaId, "B02", { rangoInicio: 500, rangoFin: 1000, secuenciaActual: 521 });
    const id = await crearBorrador(ctx, prod);

    const [a, b] = await Promise.allSettled([
      withTenantTransaction(ctx, (tx) => confirmarVenta(tx, ctx, { id })),
      withTenantTransaction(ctx, (tx) => confirmarVenta(tx, ctx, { id })),
    ]);

    const exitos = [a, b].filter((x) => x.status === "fulfilled" && x.value.ok);
    expect(exitos).toHaveLength(1); // exactly one transaction commits the flip
    // The loser's post-consume race THREW (un-burning its sequence number on rollback),
    // so the net effect is a single advance and a single invoice.
    expect(await leerSecuenciaActual(ctx.empresaId, "B02")).toBe(522);
    expect(await getHarnessDb().factura.count({ where: { ventaId: id } })).toBe(1);
    expect((await getHarnessDb().venta.findUnique({ where: { id } }))?.estado).toBe("CONFIRMADA");
  });

  it("mixed 18/16/0% lines + header discount → recomputed breakdown, exact identity, FAC correlativo (R-F3, 2.8)", async () => {
    const p18 = await productoConStock("m18", "50.000", 18);
    const p16 = await productoConStock("m16", "50.000", 16);
    const p0 = await productoConStock("m0", "50.000", 0);
    await marcarFacturaAutomatica(ctx.empresaId, true);
    await sembrarRango(ctx.empresaId, "B02", { rangoInicio: 500, rangoFin: 1000, secuenciaActual: 521 });
    await sembrarDescMax(ctx.empresaId, "20");

    const id = await withTenantTransaction(ctx, async (tx) => {
      const r = await crearVenta(tx, ctx, {
        clienteId: null,
        fecha: new Date("2026-01-10T00:00:00.000Z"),
        lineas: [
          { productoId: p18, cantidad: "1", precioUnitario: "100.00", descuento: CERO },
          { productoId: p16, cantidad: "1", precioUnitario: "100.00", descuento: CERO },
          { productoId: p0, cantidad: "1", precioUnitario: "100.00", descuento: CERO },
        ],
        descuentoCabecera: { descuentoTipo: "PORCENTAJE", descuentoValor: "10" },
      });
      if (!r.ok) throw new Error(`crearVenta falló: ${r.code}`);
      return r.data.id;
    });

    const r = await withTenantTransaction(ctx, (tx) => confirmarVenta(tx, ctx, { id }));
    expect(r.ok).toBe(true);
    const db = getHarnessDb();
    const fac = (await db.factura.findFirst({ where: { ventaId: id } }))!;
    // gravado = 18% + 16% bases, exento = 0% base; total = subtotal − descuento + itbis, exactly.
    const subtotal = fac.subtotalGravado.plus(fac.subtotalExento).plus(fac.descuento);
    const identidad = fac.subtotalGravado.plus(fac.subtotalExento).plus(fac.itbis);
    expect(fac.total.toFixed(2)).toBe(identidad.toFixed(2)); // gravado+exento+itbis
    expect(fac.correlativoInterno).toMatch(/^FAC-\d{6}$/); // never from payload
    expect(subtotal.greaterThan(0)).toBe(true);
  });

  it("parallel confirms across two sales allocate distinct FAC correlativos, branch-scoped (R-F3, 2.9)", async () => {
    const prod = await productoConStock("fac", "50.000");
    await marcarFacturaAutomatica(ctx.empresaId, true);
    await sembrarRango(ctx.empresaId, "B02", { rangoInicio: 500, rangoFin: 1000, secuenciaActual: 521 });
    const idA = await crearBorrador(ctx, prod);
    const idB = await crearBorrador(ctx, prod);

    await Promise.all([
      withTenantTransaction(ctx, (tx) => confirmarVenta(tx, ctx, { id: idA })),
      withTenantTransaction(ctx, (tx) => confirmarVenta(tx, ctx, { id: idB })),
    ]);

    const db = getHarnessDb();
    const facs = await db.factura.findMany({ where: { empresaId: ctx.empresaId }, orderBy: { correlativoInterno: "asc" } });
    expect(facs).toHaveLength(2);
    expect(new Set(facs.map((f) => f.correlativoInterno)).size).toBe(2); // atomic, no dup
    // Sucursal GUC restored in the allocator's finally → both invoices land on A1.
    for (const f of facs) expect(f.sucursalId).toBe(ctx.sucursalId);
    expect(await leerSecuenciaActual(ctx.empresaId, "B02")).toBe(523); // two burns, serialized
  });

  it("emitted contado invoice is VIGENTE, 1:1 ventaId, closed as PAGADA, no stored balance (R-F1/R-F4/R-V15, 2.10)", async () => {
    const prod = await productoConStock("vig", "50.000");
    await marcarFacturaAutomatica(ctx.empresaId, true);
    await sembrarRango(ctx.empresaId, "B02", { rangoInicio: 500, rangoFin: 1000, secuenciaActual: 521 });
    const id = await crearBorrador(ctx, prod);

    const r = await withTenantTransaction(ctx, (tx) => confirmarVenta(tx, ctx, { id }));
    expect(r.ok).toBe(true);
    const db = getHarnessDb();
    const facs = await db.factura.findMany({ where: { ventaId: id } });
    expect(facs).toHaveLength(1); // 1:1 (DB @@unique([ventaId]))
    const fac = facs[0];
    expect(fac.estado).toBe("VIGENTE");
    expect(fac.sucursalId).toBe(ctx.sucursalId);
    expect(fac.ncf).toBe("B0200000522"); // 11-char composition via the consume port
    // R-V15: a CONTO sale is closed at confirm by exactly ONE full-total COBRO/APLICADO.
    const pagos = await db.pago.findMany({ where: { facturaId: fac.id } });
    expect(pagos).toHaveLength(1);
    expect(pagos[0].tipo).toBe("COBRO");
    expect(pagos[0].estado).toBe("APLICADO");
    expect(pagos[0].monto.toFixed(2)).toBe(fac.total.toFixed(2));
    // Derived state (never a stored column): the canonical read reports PAGADA, pending 0.
    const saldo = await withTenantTransaction(ctx, (tx) => consultarSaldoCxC(tx, ctx));
    const vista = saldo.ok && saldo.data.find((v) => v.facturaId === fac.id);
    expect(vista && "estadoPago" in vista ? vista.estadoPago : null).toBe("PAGADA");
    expect(vista && "saldoPendiente" in vista ? vista.saldoPendiente : null).toBe("0.00");
    // ADR-017: still no persisted paid/balance column on FACTURA.
    expect(Object.keys(fac)).not.toContain("saldo");
    expect(Object.keys(fac)).not.toContain("totalPagado");
  });

  it("credit-gate ordering (R-V15, critical): over-limit credit client rejected BEFORE the NCF lock; zero effects", async () => {
    const prod = await productoConStock("blocked", "50.000");
    await marcarFacturaAutomatica(ctx.empresaId, true);
    await sembrarRango(ctx.empresaId, "B02", { rangoInicio: 500, rangoFin: 1000, secuenciaActual: 521 });

    // A CREDITO client already at (over) its 20,000 limit; any new sale projects past it.
    const clienteId = await crearClienteCredito(ctx, "Sobre-límite", { limite: "20000.00" });
    await sembrarFacturaVigente(ctx, clienteId, "B01000000500", "20000.00"); // pending == limit
    const id = await crearBorradorCliente(ctx, clienteId, prod);

    const r = await withTenantTransaction(ctx, (tx) => confirmarVenta(tx, ctx, { id }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("LIMITE_CREDITO_EXCEDIDO");

    // The gate fired AFTER the stock preview but BEFORE the NCF lock → nothing burned:
    const db = getHarnessDb();
    expect((await db.venta.findUnique({ where: { id } }))?.estado).toBe("BORRADOR");
    expect(await leerSecuenciaActual(ctx.empresaId, "B02")).toBe(521); // no burn
    expect(await db.factura.count({ where: { ventaId: id } })).toBe(0); // no invoice
    expect(await db.movimientoInventario.count({ where: { ventaId: id } })).toBe(0); // no debit
    // No COBRO anywhere: the only receivable is the seeded 20,000 one, still unpaid.
    expect(await db.pago.count({ where: { empresaId: ctx.empresaId } })).toBe(0);
  });

  it("contado close-the-loop (R-V15): one full-total COBRO → PAGADA; an outer abort leaves no COBRO", async () => {
    const prod = await productoConStock("contado", "50.000");
    await marcarFacturaAutomatica(ctx.empresaId, true);
    await sembrarRango(ctx.empresaId, "B02", { rangoInicio: 500, rangoFin: 1000, secuenciaActual: 521 });
    const id = await crearBorrador(ctx, prod);

    // Successful confirm commits the sale + its single closing COBRO.
    const r = await withTenantTransaction(ctx, (tx) => confirmarVenta(tx, ctx, { id }));
    expect(r.ok).toBe(true);
    const db = getHarnessDb();
    const fac = (await db.factura.findFirst({ where: { ventaId: id } }))!;
    expect(await db.pago.count({ where: { facturaId: fac.id, tipo: "COBRO", estado: "APLICADO" } })).toBe(1);

    // A SEPARATE sale whose outer transaction aborts AFTER confirm: the COBRO must not persist.
    const id2 = await crearBorrador(ctx, prod);
    await expect(
      withTenantTransaction(ctx, async (tx) => {
        const rr = await confirmarVenta(tx, ctx, { id: id2 });
        if (!rr.ok) throw new Error(`confirm falló: ${rr.code}`);
        throw new Error("abort-after-confirm");
      }),
    ).rejects.toThrow("abort-after-confirm");
    // Everything (sale flip, NCF, invoice, debit, COBRO) rolled back together.
    expect((await db.venta.findUnique({ where: { id: id2 } }))?.estado).toBe("BORRADOR");
    expect(await leerSecuenciaActual(ctx.empresaId, "B02")).toBe(522); // only the first sale burned
    expect(await db.factura.count({ where: { ventaId: id2 } })).toBe(0);
    expect(await db.pago.count({ where: { empresaId: ctx.empresaId, factura: { ventaId: id2 } } })).toBe(0);
  });

  it("draft edited while confirm is parked at the NCF lock: flip misses → CONCURRENCIA_CONFLICTO, full rollback (v2r-10)", async () => {
    const prod = await productoConStock("toctou", "50.000");
    await marcarFacturaAutomatica(ctx.empresaId, true);
    await sembrarRango(ctx.empresaId, "B02", { rangoInicio: 500, rangoFin: 1000, secuenciaActual: 521 });
    const id = await crearBorrador(ctx, prod); // 1 × 100.00 @18 → total 118.00

    const db = getHarnessDb();
    const blockerDb = crearClienteBloqueador();
    let releaseBlocker!: () => void;
    const unlocked = new Promise<void>((resolve) => {
      releaseBlocker = resolve;
    });
    let signalLockHeld!: () => void;
    const lockHeld = new Promise<void>((resolve) => {
      signalLockHeld = resolve;
    });

    // The confirm's FIRST write lock is the NCF sequence row
    // (`bloquearSecuenciaActivaEnTx` inside the consume); everything before it
    // (read, gates, stock preview, credit gate) is a plain read — and crucially
    // the step-5 stock preview takes NO row locks, so a concurrent draft edit
    // commits freely while the confirm is parked at the NCF lock. Pre-fix the
    // flip predicate had no version token: it matched regardless of the edit
    // and CONFIRMED the stale read (v2r-10). Post-fix the flip's
    // `WHERE ... AND updatedAt=<read value>` misses the edited header, the use
    // case THROWS and the whole transaction (consume included) rolls back.
    const blockerPromise = blockerDb.$transaction(
      async (btx) => {
        await btx.$executeRaw`
          SELECT "id" FROM "NCF_SECUENCIA"
          WHERE "empresaId" = ${ctx.empresaId}::int
            AND "tipoNcf" = 'B02'::"TipoNcfSecuencia"
          FOR UPDATE`;
        signalLockHeld();
        await unlocked;
        throw new Error("blocker released (intentional rollback trigger)");
      },
      // Idle timeout must outlive the whole orchestration: the blocker sits idle
      // (awaiting release) from lock acquisition, and under full-suite load the
      // confirm can take many seconds to reach the NCF lock. 15s was comparable
      // to the parking poll and the blocker expired mid-race, freeing the lock.
      { timeout: 60_000 },
    );
    void blockerPromise.catch(() => undefined);

    let editResult: Awaited<ReturnType<typeof actualizarVenta>> | null = null;
    try {
      // The blocker must ALREADY hold the NCF lock before the confirm starts.
      // Launched in parallel, a warm app pool lets the confirm finish the whole
      // confirm (NCF consumed, venta confirmed, committed) before the blocker's
      // fresh client acquires its FOR UPDATE — then nothing ever parks at the
      // lock and the race poll times out (the intermittent v2r-10 flake).
      await lockHeld;
      const confirmPromise = withTenantTransaction(ctx, (tx) =>
        confirmarVenta(tx, ctx, { id }),
      );
      await esperarUnEsperando(db, "confirm parked at the NCF lock");
      // The draft edit commits while the confirm is parked: it replaces the
      // lines AND bumps `updatedAt` (Prisma @updatedAt) — the optimistic token
      // the flip must honor (v2r-10).
      editResult = await withTenantTransaction(ctx, (tx) =>
        actualizarVenta(tx, ctx, {
          id,
          fecha: new Date("2026-01-10T00:00:00.000Z"),
          lineas: [{ productoId: prod, cantidad: "2", precioUnitario: "100.00", descuento: CERO }],
        }),
      );
      releaseBlocker();
      // The stale confirm THROWS (never returns): its consume rolls back.
      await expect(confirmPromise).rejects.toMatchObject({
        code: "CONCURRENCIA_CONFLICTO",
      });
    } finally {
      releaseBlocker();
      await Promise.allSettled([blockerPromise]);
      await blockerDb.$disconnect();
    }
    expect(editResult?.ok).toBe(true);

    // The edit survives; the confirm's EVERY side effect rolled back together.
    const venta = await db.venta.findUnique({ where: { id }, include: { detalles: true } });
    expect(venta?.estado).toBe("BORRADOR");
    expect(venta?.detalles).toHaveLength(1);
    expect(venta?.detalles[0].cantidad.toFixed(3)).toBe("2.000");
    expect(await leerSecuenciaActual(ctx.empresaId, "B02")).toBe(521); // NCF un-burned
    expect(await db.factura.count({ where: { ventaId: id } })).toBe(0); // no invoice
    expect(await db.movimientoInventario.count({ where: { ventaId: id } })).toBe(0); // no debit
    expect(await db.pago.count({ where: { empresaId: ctx.empresaId } })).toBe(0); // no COBRO
    // Draft touched twice (CREAR + edit) — the rolled-back confirm wrote no audit.
    expect(
      await db.movimientoAuditoria.count({
        where: { entidad: "Venta", idEntidad: String(id) },
      }),
    ).toBe(2);
  });
});
