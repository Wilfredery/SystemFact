/**
 * Integration — Reportes slice A: shared contracts, the dashboard reads, the admin widen
 * and the role gate (real Postgres 16, RLS on, `systemfact_app` role; DB-2..DB-6).
 *
 * Seeding runs on the trusted superuser harness client (bypasses RLS), exactly like
 * `auditoria-consulta.integration.test.ts`. The code under test
 * (`consultarDashboard` → the aggregates + `conSucursalAmpliadaEnTx` + the reused
 * `consultarSaldoCxcEnTx`) runs through the app role inside `withTenantTransaction`, so the
 * RLS GUCs are in force as in production.
 *
 * Proves the spec scenarios slice A owns:
 *   - DB-3 cross-tenant isolation: an A-admin dashboard aggregates ONLY A's confirmed sales.
 *   - DB-1 SD calendar boundaries: a CONFIRMADA sale at 21:00 UTC and one at 03:00 UTC next
 *     day fall into their correct SD calendar day, never the raw UTC date.
 *   - DB-1 CxC via the canonical derived query (reuse — no second balance query).
 *   - DB-4 admin company-wide widen: an admin pinned to A1 sees BOTH A1 and A2 sales, and
 *     the branch GUC is RESTORED (and the empresa GUC never cleared) after the read.
 *   - DB-2 role gate: a Cobrador (branch-pinned, no widen) gets ONLY the CxC tile; a
 *     Despachador is refused with REPORTE_NO_AUTORIZADO before any aggregate.
 *   - DB-5 clamp: pageSize 500 clamps to 100 (shared normalizarFiltro contract).
 *   - DB-6 consultation writes NO audit rows (row count unchanged).
 */

import { Prisma } from "@/generated/prisma/client";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import { withTenantTransaction } from "@/modules/tenant/infrastructure/withTenantTransaction";
import { consultarDashboard } from "@/modules/reportes/application/consultar-dashboard";
import { normalizarFiltro } from "@/modules/reportes/domain/reporte-filtro";
import { ventanaDiaSD } from "@/modules/reportes/domain/periodo";
import { REPORTE_NO_AUTORIZADO } from "@/modules/reportes/domain/errors";
import type { DashboardVista } from "@/modules/reportes/domain/dashboard";
import { getHarnessDb, seedTenantFixture, type TenantFixture } from "./setup/fixtures";

let fixture: TenantFixture | null = null;

/** A fixed midday-UTC instant → unambiguously inside its own SD calendar day (10:00 SD). */
const AHORA = new Date("2026-04-15T14:00:00.000Z");

function adminCtx(f: TenantFixture, sucursalId: number): TenantCtx {
  return {
    empresaId: f.empresaA.id,
    sucursalId,
    usuarioId: f.usuarios.adminA.id,
    esAdmin: true,
  };
}

/** Ensure a ROL row exists (nombre is not unique in the schema) and return its id. */
async function rolId(nombre: string): Promise<number> {
  const db = getHarnessDb();
  let rol = await db.rol.findFirst({ where: { nombre } });
  if (rol === null) {
    rol = await db.rol.create({
      data: { nombre, descripcion: `${nombre} (reportes harness)` },
    });
  }
  return rol.id;
}

/** Create a USUARIO holding exactly `rolNombre` in the given empresa/sucursal. */
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
      nombre: `${rolNombre} ${sucursalId}-${empresaId}`,
      nombreUsuario: `rep-${rolNombre.toLowerCase()}-${empresaId}-${sucursalId}-${Date.now()}`,
      passwordHash: "test-hash",
      roles: { create: { rolId: rid } },
    },
    select: { id: true },
  });
  return u.id;
}

/** Seed one CONFIRMADA sale (with a line for the fixture product) at `fecha`. */
async function crearVentaConfirmada(
  f: TenantFixture,
  opts: {
    empresaId: number;
    sucursalId: number;
    usuarioId: number;
    clienteId: number;
    productoId: number;
    fecha: Date;
    total: string;
  },
): Promise<number> {
  const db = getHarnessDb();
  const total = new Prisma.Decimal(opts.total);
  const creada = await db.venta.create({
    data: {
      empresaId: opts.empresaId,
      sucursalId: opts.sucursalId,
      usuarioId: opts.usuarioId,
      clienteId: opts.clienteId,
      fecha: opts.fecha,
      estado: "CONFIRMADA",
      subtotal: total,
      descuento: new Prisma.Decimal(0),
      descuentoTipo: "PORCENTAJE",
      itbis: new Prisma.Decimal(0),
      total,
      detalles: {
        create: {
          productoId: opts.productoId,
          cantidad: new Prisma.Decimal("1.000"),
          precioUnitario: total,
          descuentoLinea: new Prisma.Decimal(0),
          descuentoTipo: "PORCENTAJE",
          tasaItbis: new Prisma.Decimal(0),
          itbisLinea: new Prisma.Decimal(0),
          subtotalLinea: total,
        },
      },
    },
    select: { id: true },
  });
  return creada.id;
}

/** Seed one VIGENTE invoice (pending receivable) for the canonical CxC query. */
async function crearFacturaVigente(
  f: TenantFixture,
  opts: {
    empresaId: number;
    sucursalId: number;
    usuarioId: number;
    clienteId: number;
    total: string;
    ncf: string;
  },
): Promise<void> {
  const db = getHarnessDb();
  const total = new Prisma.Decimal(opts.total);
  await db.factura.create({
    data: {
      empresaId: opts.empresaId,
      sucursalId: opts.sucursalId,
      usuarioId: opts.usuarioId,
      clienteId: opts.clienteId,
      tipoNcf: "B01",
      ncf: opts.ncf,
      correlativoInterno: opts.ncf,
      estado: "VIGENTE",
      subtotalGravado: total,
      itbis: new Prisma.Decimal(0),
      subtotalExento: new Prisma.Decimal(0),
      descuento: new Prisma.Decimal(0),
      total,
      fechaEmision: AHORA,
    },
  });
}

/** A CLIENTE owned by the empresa for the sale/invoice FKs. */
async function crearCliente(f: TenantFixture, empresaId: number): Promise<number> {
  const db = getHarnessDb();
  const c = await db.cliente.create({
    data: {
      empresaId,
      nombre: `Cliente-${empresaId}-${Date.now()}`,
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

function leerDashboard(
  ctx: TenantCtx,
): Promise<
  | { ok: true; data: DashboardVista }
  | { ok: false; code: string; message: string }
> {
  return withTenantTransaction(ctx, (tx) =>
    consultarDashboard(tx, ctx, { now: AHORA }),
  );
}

describe("reportes slice A — dashboard, widen, role gate (real DB, RLS on)", () => {
  beforeEach(async () => {
    fixture = await seedTenantFixture();
  });

  it("DB-3: an A-admin dashboard aggregates ONLY A's confirmed sales (empresaId pin + RLS)", async () => {
    const f = fixture!;
    const clienteA = await crearCliente(f, f.empresaA.id);
    const clienteB = await crearCliente(f, f.empresaB.id);
    // A: two confirmed sales inside AHORA's SD day.
    await crearVentaConfirmada(f, {
      empresaId: f.empresaA.id,
      sucursalId: f.sucursalA1.id,
      usuarioId: f.usuarios.adminA.id,
      clienteId: clienteA,
      productoId: f.productos.prodA1.id,
      fecha: AHORA,
      total: "120.00",
    });
    await crearVentaConfirmada(f, {
      empresaId: f.empresaA.id,
      sucursalId: f.sucursalA1.id,
      usuarioId: f.usuarios.adminA.id,
      clienteId: clienteA,
      productoId: f.productos.prodA1.id,
      fecha: AHORA,
      total: "80.00",
    });
    // B: a sale at the same instant → invisible to A.
    await crearVentaConfirmada(f, {
      empresaId: f.empresaB.id,
      sucursalId: f.sucursalB1.id,
      usuarioId: f.usuarios.adminB.id,
      clienteId: clienteB,
      productoId: f.productos.prodB1.id,
      fecha: AHORA,
      total: "9999.00",
    });

    const r = await leerDashboard(adminCtx(f, f.sucursalA1.id));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // 120 + 80 = 200.00, two operations; B's 9999 never counted.
    expect(r.data.ventasDia?.neto).toBe("200.00");
    expect(r.data.ventasDia?.operaciones).toBe(2);
  });

  it("DB-1: sales bucket by SD calendar day, never the raw UTC date", async () => {
    const f = fixture!;
    const clienteA = await crearCliente(f, f.empresaA.id);
    // 21:00 UTC on 15 → 17:00 SD 15 (same SD day as AHORA which is 10:00 SD 15).
    const enDiaSD = new Date("2026-04-15T21:00:00.000Z");
    // 03:00 UTC on 16 → 23:00 SD 15 (STILL SD day 15).
    const diaSiguienteUTC = new Date("2026-04-16T03:00:00.000Z");
    await crearVentaConfirmada(f, {
      empresaId: f.empresaA.id,
      sucursalId: f.sucursalA1.id,
      usuarioId: f.usuarios.adminA.id,
      clienteId: clienteA,
      productoId: f.productos.prodA1.id,
      fecha: enDiaSD,
      total: "10.00",
    });
    await crearVentaConfirmada(f, {
      empresaId: f.empresaA.id,
      sucursalId: f.sucursalA1.id,
      usuarioId: f.usuarios.adminA.id,
      clienteId: clienteA,
      productoId: f.productos.prodA1.id,
      fecha: diaSiguienteUTC,
      total: "20.00",
    });
    // One clearly OUTSIDE the SD day: 16 Apr 05:00 UTC = 01:00 SD 16 (next SD day).
    await crearVentaConfirmada(f, {
      empresaId: f.empresaA.id,
      sucursalId: f.sucursalA1.id,
      usuarioId: f.usuarios.adminA.id,
      clienteId: clienteA,
      productoId: f.productos.prodA1.id,
      fecha: new Date("2026-04-16T05:00:00.000Z"),
      total: "500.00",
    });

    // AHORA's SD day window is the reference (both 10.00 and 20.00 fall inside it).
    const w = ventanaDiaSD(AHORA);
    expect(enDiaSD >= w.desde && enDiaSD <= w.hasta).toBe(true);
    expect(diaSiguienteUTC >= w.desde && diaSiguienteUTC <= w.hasta).toBe(true);

    const r = await leerDashboard(adminCtx(f, f.sucursalA1.id));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Only the two SD-day-15 sales count: 10 + 20 = 30.00 (the SD-day-16 500 excluded).
    expect(r.data.ventasDia?.neto).toBe("30.00");
    expect(r.data.ventasDia?.operaciones).toBe(2);
  });

  it("DB-1/ADR-017: the CxC tile sums the canonical derived balances (pending + total)", async () => {
    const f = fixture!;
    const clienteA = await crearCliente(f, f.empresaA.id);
    await crearFacturaVigente(f, {
      empresaId: f.empresaA.id,
      sucursalId: f.sucursalA1.id,
      usuarioId: f.usuarios.adminA.id,
      clienteId: clienteA,
      total: "150.00",
      ncf: "B0100000001",
    });
    await crearFacturaVigente(f, {
      empresaId: f.empresaA.id,
      sucursalId: f.sucursalA2.id,
      usuarioId: f.usuarios.adminA.id,
      clienteId: clienteA,
      total: "250.00",
      ncf: "B0100000002",
    });

    const r = await leerDashboard(adminCtx(f, f.sucursalA1.id));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.cxC?.facturasPendientes).toBe(2);
    expect(r.data.cxC?.saldoTotal).toBe("400.00");
  });

  it("DB-4: admin company-wide widen reads BOTH branches AND restores the branch GUC", async () => {
    const f = fixture!;
    const clienteA = await crearCliente(f, f.empresaA.id);
    await crearVentaConfirmada(f, {
      empresaId: f.empresaA.id,
      sucursalId: f.sucursalA1.id,
      usuarioId: f.usuarios.adminA.id,
      clienteId: clienteA,
      productoId: f.productos.prodA1.id,
      fecha: AHORA,
      total: "60.00",
    });
    await crearVentaConfirmada(f, {
      empresaId: f.empresaA.id,
      sucursalId: f.sucursalA2.id,
      usuarioId: f.usuarios.adminA.id,
      clienteId: clienteA,
      productoId: f.productos.prodA2Only.id,
      fecha: AHORA,
      total: "40.00",
    });

    // Run the read, then in the SAME transaction inspect the session GUCs post-read.
    const ctx = adminCtx(f, f.sucursalA1.id);
    const salida = await withTenantTransaction(ctx, async (tx) => {
      const res = await consultarDashboard(tx, ctx, { now: AHORA });
      const guc = await tx.$queryRaw<{ suc: string; emp: string }[]>`
        SELECT
          COALESCE(current_setting('app.current_sucursal_id', true), '__null__') AS suc,
          COALESCE(current_setting('app.current_empresa_id', true), '__null__')  AS emp`;
      return { res, guc: guc[0] };
    });

    // Company-wide: A1 + A2 both counted (60 + 40), only possible with the widen.
    expect(salida.res.ok).toBe(true);
    if (!salida.res.ok) return;
    expect(salida.res.data.ventasDia?.neto).toBe("100.00");
    expect(salida.res.data.ventasDia?.operaciones).toBe(2);

    // After the read the branch GUC is BACK to the caller's branch and empresa NEVER cleared.
    expect(salida.guc?.suc).toBe(String(f.sucursalA1.id));
    expect(salida.guc?.emp).toBe(String(f.empresaA.id));
  });

  it("DB-2: a Cobrador (branch-pinned, no widen) sees ONLY the CxC family", async () => {
    const f = fixture!;
    const clienteA = await crearCliente(f, f.empresaA.id);
    const cobradorId = await crearUsuarioConRol(f, "Cobrador", f.sucursalA1.id, f.empresaA.id);
    await crearVentaConfirmada(f, {
      empresaId: f.empresaA.id,
      sucursalId: f.sucursalA1.id,
      usuarioId: f.usuarios.adminA.id,
      clienteId: clienteA,
      productoId: f.productos.prodA1.id,
      fecha: AHORA,
      total: "10.00",
    });
    await crearFacturaVigente(f, {
      empresaId: f.empresaA.id,
      sucursalId: f.sucursalA1.id,
      usuarioId: f.usuarios.adminA.id,
      clienteId: clienteA,
      total: "55.00",
      ncf: "B0100000077",
    });

    const ctx: TenantCtx = {
      empresaId: f.empresaA.id,
      sucursalId: f.sucursalA1.id,
      usuarioId: cobradorId,
      esAdmin: false,
    };
    const r = await leerDashboard(ctx);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Sales/top/inventory structurally absent; CxC family present.
    expect(r.data.alcance).toBe("COBRADOR");
    expect(r.data.ventasDia).toBeNull();
    expect(r.data.ventasMes).toBeNull();
    expect(r.data.topVendedores).toBeNull();
    expect(r.data.inventario).toBeNull();
    expect(r.data.cxC).not.toBeNull();
    expect(r.data.cxC?.facturasPendientes).toBe(1);
    expect(r.data.cxC?.saldoTotal).toBe("55.00");
  });

  it("DB-2: a Despachador is refused with REPORTE_NO_AUTORIZADO before any aggregate", async () => {
    const f = fixture!;
    const clienteA = await crearCliente(f, f.empresaA.id);
    const despachadorId = await crearUsuarioConRol(
      f,
      "Despachador",
      f.sucursalA1.id,
      f.empresaA.id,
    );
    await crearVentaConfirmada(f, {
      empresaId: f.empresaA.id,
      sucursalId: f.sucursalA1.id,
      usuarioId: f.usuarios.adminA.id,
      clienteId: clienteA,
      productoId: f.productos.prodA1.id,
      fecha: AHORA,
      total: "10.00",
    });

    const ctx: TenantCtx = {
      empresaId: f.empresaA.id,
      sucursalId: f.sucursalA1.id,
      usuarioId: despachadorId,
      esAdmin: false,
    };
    const r = await leerDashboard(ctx);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe(REPORTE_NO_AUTORIZADO);
  });

  it("DB-5: the shared filter contract clamps an oversized pageSize to 100", () => {
    // The clamp is the same DB-ready contract every reportes list inherits (slice B+).
    const f = normalizarFiltro({ pageSize: 500, sucursalId: 7, desde: "2026-04-01" });
    expect(f.pageSize).toBe(100);
    expect(f.sucursalId).toBe(7);
    expect(f.desde?.toISOString()).toBe("2026-04-01T04:00:00.000Z");
  });

  it("DB-6: a dashboard consultation writes NO audit rows", async () => {
    const f = fixture!;
    const clienteA = await crearCliente(f, f.empresaA.id);
    await crearVentaConfirmada(f, {
      empresaId: f.empresaA.id,
      sucursalId: f.sucursalA1.id,
      usuarioId: f.usuarios.adminA.id,
      clienteId: clienteA,
      productoId: f.productos.prodA1.id,
      fecha: AHORA,
      total: "10.00",
    });

    const db = getHarnessDb();
    const antes = await db.movimientoAuditoria.count();
    await leerDashboard(adminCtx(f, f.sucursalA1.id));
    await leerDashboard(adminCtx(f, f.sucursalA2.id));
    const despues = await db.movimientoAuditoria.count();
    expect(despues).toBe(antes);
  });
});
