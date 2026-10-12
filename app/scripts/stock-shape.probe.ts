/**
 * Standalone OBSERVATION probe — audit run-3 "phantom credit" hypothesis.
 *
 * Question (observation only, NO remediation): after the chain
 *   crearVenta → confirmarVenta (authoritative SALIDA_VENTA −10) →
 *   crearDevolucion (B04 credit note) → cancelarVenta,
 * does the confirmed-cancellation reposition credit back the FULL sold
 * quantity (+10) while ignoring the 4 units already returned through the
 * credit note — leaving stock over-credited ("phantom" credit)?
 *
 * Scenario (two independent cycles, one dedicated product each):
 *   P (VENDIBLE): sale 10 → return 4 VENDIBLE → cancel.
 *   Q (DANADO):   sale 10 → return 4 DANADO (SALIDA_MERMA disposal) → cancel.
 *   Rationale for the second-product DANADO path: cleaner than splitting one
 *   product's return into VENDIBLE/DANADO lines inside one NC, which would
 *   mix the exact-triple idempotency gate (existeDevolucionIdenticaEnTx) into
 *   the observation. Hypothesis for Q: the merma'd units (goods destroyed)
 *   come back as sellable stock via the cancel's +10 reposition.
 *
 * Everything runs through the REAL production APIs (crearVenta, confirmarVenta,
 * crearDevolucion, cancelarVenta, withTenantTransaction). ONLY seeding and
 * cleanup are superuser-level, mirroring the Jest integration harness
 * (src/integration/setup/fixtures.ts). No src/ file is modified.
 *
 * Lives in app/scripts/ on purpose: Jest ignores the directory
 * (jest.config.js testPathIgnorePatterns) — not a unit test.
 * REQUIRES: local Postgres (sf-postgres) up; .env DATABASE_URL/DIRECT_URL.
 * RUN VIA: `pnpm --dir app exec tsx scripts/stock-shape.probe.ts`
 * (run directly; no package.json script was added for this throwaway probe).
 */

import "dotenv/config";
import assert from "node:assert";
import { randomUUID } from "node:crypto";
import { Decimal } from "decimal.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { withTenantTransaction } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import { crearVenta, cancelarVenta } from "@/modules/venta/application/venta-service";
import { confirmarVenta } from "@/modules/venta/application/confirmar-venta";
import { crearDevolucion } from "@/modules/devolucion/application/crear-devolucion";

/**
 * Superuser bypass-RLS client for seed/observe/cleanup ONLY — the flows under
 * test never touch it (same boundary as the integration harness fixtures).
 */
const sdb = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DIRECT_URL }) });

const VIG_INICIO = new Date("2000-01-01T00:00:00.000Z");
const VIG_FIN = new Date("2099-12-31T23:59:59.000Z");
/** Valid 9-digit RNC (mod-11; see fiscal-id.test.ts) → confirm emits B01. */
const RNC_VALIDO = "131045677";

const SEMILLA = "100.000";
const CANTIDAD_VENTA = "10";
const CANTIDAD_DEVUELTA = "4";
const MOTIVO_CANCEL = "Validación audit run-3";

interface Seeds {
  readonly empresaId: number;
  readonly sucursalId: number;
  readonly usuarioId: number;
  readonly productoPId: number;
  readonly productoQId: number;
  readonly inventarioPId: number;
  readonly inventarioQId: number;
  readonly clienteId: number;
}

interface Loop {
  readonly etiqueta: string;
  readonly productoId: number;
  readonly inventarioId: number;
  readonly tipoReposicion: "VENDIBLE" | "DANADO";
}

interface Observed {
  readonly ventaId: number;
  readonly facturaId: number;
  readonly ncIds: readonly number[];
  readonly stockPostConfirm: string;
  readonly stockPostDevolucion: string;
}

interface MovementRow {
  readonly tipoMovimiento: string;
  readonly cantidadMovida: string;
  readonly ventaId: number | null;
  readonly notaCreditoId: number | null;
}

// ---------------------------------------------------------------- seeding / cleanup

async function sembrar(): Promise<Seeds> {
  const suffix = randomUUID();
  const empresa = await sdb.empresa.create({
    data: {
      nombreComercial: `OBS-${suffix}`,
      rnc: `RNC-OBS-${suffix}`,
      razonSocial: `OBS-${suffix}`,
      direccionFiscal: "x",
      telefono: "0",
      correo: `obs-${suffix}@audit.test`,
      logo: "",
      regimenFiscal: "NORMAL",
      facturaAutomatica: true,
    },
  });
  const sucursal = await sdb.sucursal.create({
    data: { empresaId: empresa.id, nombre: "OBS-1", direccion: "x", telefono: "0" },
  });
  const usuario = await sdb.usuario.create({
    data: {
      empresaId: empresa.id,
      sucursalId: sucursal.id,
      nombre: "Obs Admin",
      nombreUsuario: `obs-admin-${suffix}`,
      passwordHash: "probe",
    },
  });
  const categoria = await sdb.categoria.create({
    data: { empresaId: empresa.id, nombre: `obs-cat-${suffix}` },
  });

  const productoData = (codigo: string) => ({
    empresaId: empresa.id,
    categoriaId: categoria.id,
    nombre: codigo,
    codigo,
    codigoBarras: `BC-${codigo}`,
    unidadMedida: "u",
    unidadEmpaque: "c",
    stockMinimo: 0,
    precioCompra: new Prisma.Decimal(0),
    precioVenta: new Prisma.Decimal("100.00"),
    costoPromedio: new Prisma.Decimal(0),
    tasaItbis: new Prisma.Decimal(18),
    itbisVigenteDesde: new Date("2000-01-01T00:00:00.000Z"),
  });
  const productoP = await sdb.producto.create({ data: productoData(`OBS-P-${suffix}`) });
  const productoQ = await sdb.producto.create({ data: productoData(`OBS-Q-${suffix}`) });
  const inventarioP = await sdb.inventario.create({
    data: { sucursalId: sucursal.id, productoId: productoP.id, cantidad: new Prisma.Decimal(SEMILLA) },
  });
  const inventarioQ = await sdb.inventario.create({
    data: { sucursalId: sucursal.id, productoId: productoQ.id, cantidad: new Prisma.Decimal(SEMILLA) },
  });

  // Taxpayer client (valid RNC, not CF) → B01 invoice; creditoHabilitado false → contado.
  const cliente = await sdb.cliente.create({
    data: {
      empresaId: empresa.id,
      nombre: "Obs Cliente",
      telefono: "0",
      direccion: "x",
      identificacionFiscal: RNC_VALIDO,
      tipoCliente: "MINORISTA",
      esConsumidorFinal: false,
    },
  });

  // NCF sequences: B01 for the invoice, B04 for the credit notes.
  await sdb.ncfSecuencia.create({
    data: {
      empresaId: empresa.id, tipoNcf: "B01",
      rangoInicio: BigInt(1001), rangoFin: BigInt(5000), secuenciaActual: BigInt(1000),
      vigenciaInicio: VIG_INICIO, vigenciaFin: VIG_FIN, activa: true,
    },
  });
  await sdb.ncfSecuencia.create({
    data: {
      empresaId: empresa.id, tipoNcf: "B04",
      rangoInicio: BigInt(201), rangoFin: BigInt(300), secuenciaActual: BigInt(200),
      vigenciaInicio: VIG_INICIO, vigenciaFin: VIG_FIN, activa: true,
    },
  });

  // Business config: return window + wide sale-date band (sale date is "today").
  const crearConfig = (clave: string, valor: string) =>
    sdb.configuracionEmpresa.create({
      data: {
        empresaId: empresa.id, clave, valor,
        vigenciaInicio: VIG_INICIO, vigenciaFin: VIG_FIN, activa: true,
      },
    });
  await crearConfig("PLAZO_DEVOLUCION", "15");
  await crearConfig("RETROACTIVO_FECHA_VENTA_DIAS", "999");

  return {
    empresaId: empresa.id,
    sucursalId: sucursal.id,
    usuarioId: usuario.id,
    productoPId: productoP.id,
    productoQId: productoQ.id,
    inventarioPId: inventarioP.id,
    inventarioQId: inventarioQ.id,
    clienteId: cliente.id,
  };
}

/**
 * Targeted deletes in FK order, scoped to the probe's own empresa — NEVER a
 * truncate (the local DB is shared). MOVIMIENTO_AUDITORIA is append-only at
 * the DATABASE level (trigger `movimientoauditoria_appendonly` raises
 * AUDITORIA_INMUTABLE on any UPDATE/DELETE; migration 20260918), so the audit
 * rows the flows appended can only be removed by a superuser temporarily
 * disabling that trigger for the duration of THIS probe's cleanup and
 * immediately re-enabling it — a tooling-only bypass, never product code.
 */
async function limpiar(s: Seeds): Promise<void> {
  await sdb.$executeRawUnsafe('ALTER TABLE "MOVIMIENTO_AUDITORIA" DISABLE TRIGGER movimientoauditoria_appendonly');
  try {
    await sdb.movimientoAuditoria.deleteMany({ where: { empresaId: s.empresaId } });
  } finally {
    await sdb.$executeRawUnsafe('ALTER TABLE "MOVIMIENTO_AUDITORIA" ENABLE TRIGGER movimientoauditoria_appendonly');
  }
  await sdb.anulacion.deleteMany({ where: { empresaId: s.empresaId } });
  await sdb.pago.deleteMany({ where: { empresaId: s.empresaId } });
  await sdb.detalleNotaCredito.deleteMany({ where: { productoId: { in: [s.productoPId, s.productoQId] } } });
  await sdb.movimientoInventario.deleteMany({ where: { inventarioId: { in: [s.inventarioPId, s.inventarioQId] } } });
  await sdb.notaCredito.deleteMany({ where: { empresaId: s.empresaId } });
  await sdb.notaDebito.deleteMany({ where: { empresaId: s.empresaId } });
  await sdb.factura.deleteMany({ where: { empresaId: s.empresaId } });
  await sdb.detalleVenta.deleteMany({ where: { productoId: { in: [s.productoPId, s.productoQId] } } });
  await sdb.venta.deleteMany({ where: { empresaId: s.empresaId } });
  await sdb.inventario.deleteMany({ where: { sucursalId: s.sucursalId } });
  await sdb.producto.deleteMany({ where: { empresaId: s.empresaId } });
  await sdb.cliente.deleteMany({ where: { empresaId: s.empresaId } });
  await sdb.categoria.deleteMany({ where: { empresaId: s.empresaId } });
  await sdb.ncfSecuencia.deleteMany({ where: { empresaId: s.empresaId } });
  await sdb.configuracionEmpresa.deleteMany({ where: { empresaId: s.empresaId } });
  await sdb.usuario.deleteMany({ where: { empresaId: s.empresaId } });
  await sdb.sucursal.deleteMany({ where: { empresaId: s.empresaId } });
  await sdb.empresa.deleteMany({ where: { id: s.empresaId } });
}

// ---------------------------------------------------------------- probe core

async function leerStock(inventarioId: number): Promise<string> {
  const inv = await sdb.inventario.findUnique({ where: { id: inventarioId }, select: { cantidad: true } });
  assert.ok(inv !== null, "INVENTARIO row desapareció");
  return inv.cantidad.toFixed(3);
}

async function leerMovimientos(inventarioId: number): Promise<MovementRow[]> {
  const rows = await sdb.movimientoInventario.findMany({
    where: { inventarioId },
    orderBy: { id: "asc" },
    select: { tipoMovimiento: true, cantidadMovida: true, ventaId: true, notaCreditoId: true },
  });
  return rows.map((r) => ({
    tipoMovimiento: r.tipoMovimiento,
    cantidadMovida: r.cantidadMovida.toFixed(3),
    ventaId: r.ventaId,
    notaCreditoId: r.notaCreditoId,
  }));
}

const ceroDescuento = { descuentoTipo: "PORCENTAJE" as const, descuentoValor: "0.00" };

/**
 * One full observation cycle against a dedicated product: crear + confirmar
 * through the real APIs (same tx), read the post-confirm stock and the
 * SALIDA_VENTA movement, then registrar the devolucion through the real API
 * and read the mid-state. Every step asserts.
 */
async function observarCiclo(
  seeds: Seeds,
  ctx: TenantCtx,
  loop: Loop,
): Promise<Observed> {
  // 1) crear + confirmar inside ONE tenant transaction (canonical sale path).
  const { ventaId, facturaId } = await withTenantTransaction(ctx, async (tx) => {
    const creada = await crearVenta(tx, ctx, {
      clienteId: seeds.clienteId,
      fecha: new Date(),
      lineas: [{ productoId: loop.productoId, cantidad: CANTIDAD_VENTA, precioUnitario: "100.00", descuento: ceroDescuento }],
    });
    if (!creada.ok) throw new Error(`crearVenta falló: ${creada.code}`);
    const confirmada = await confirmarVenta(tx, ctx, { id: creada.data.id });
    if (!confirmada.ok) throw new Error(`confirmarVenta falló: ${confirmada.code}`);
    return { ventaId: creada.data.id, facturaId: confirmada.data.facturaId };
  });

  const facturaPre = await sdb.factura.findUnique({ where: { id: facturaId } });
  assert.ok(facturaPre !== null, "FACTURA no existe tras confirmar");
  assert.strictEqual(facturaPre.estado, "VIGENTE", `${loop.etiqueta}: FACTURA debe ser VIGENTE tras confirmar`);
  assert.strictEqual(facturaPre.tipoNcf, "B01", `${loop.etiqueta}: factura B01 esperada (cliente contribuyente)`);
  console.log(
    `  ${loop.etiqueta}: venta #${ventaId} confirmada → FACTURA VIGENTE ${facturaPre.tipoNcf} ${facturaPre.ncf}`,
  );

  const stockPostConfirm = await leerStock(loop.inventarioId);
  console.log(`  ${loop.etiqueta}: INVENTARIO.cantidad tras confirmar = ${stockPostConfirm}`);

  // 2) devolucion through the real API (consumes B04, writes the NC VIGENTE).
  const dev = await withTenantTransaction(ctx, async (tx) =>
    crearDevolucion(tx, ctx, {
      ventaId,
      motivo: `Validación audit run-3 devolución ${loop.tipoReposicion}`,
      lineas: [{ productoId: loop.productoId, cantidad: CANTIDAD_DEVUELTA, tipoReposicion: loop.tipoReposicion }],
    }));
  if (!dev.ok) throw new Error(`crearDevolucion (${loop.tipoReposicion}) falló: ${dev.code}`);
  const ncs = await sdb.notaCredito.findMany({
    where: { facturaOriginalId: facturaId },
    orderBy: { id: "asc" },
    select: { id: true, estado: true, ncf: true },
  });
  assert.strictEqual(ncs.length, 1, `${loop.etiqueta}: exactamente una NC esperada`);
  assert.strictEqual(ncs[0].estado, "VIGENTE", `${loop.etiqueta}: NC debe quedar VIGENTE tras devolución`);
  console.log(`  ${loop.etiqueta}: devolución ${loop.tipoReposicion} ${CANTIDAD_DEVUELTA} registrada → NC ${ncs[0].ncf} VIGENTE`);

  const stockPostDevolucion = await leerStock(loop.inventarioId);
  console.log(`  ${loop.etiqueta}: INVENTARIO.cantidad tras devolución = ${stockPostDevolucion}`);

  const movimientos = await leerMovimientos(loop.inventarioId);
  const devolucionMov = movimientos.find((m) => m.notaCreditoId !== null);
  const esperadoTipo = loop.tipoReposicion === "VENDIBLE" ? "ENTRADA_DEVOLUCION" : "SALIDA_MERMA";
  // cantidadMovida is the SIGNED delta: entries positive, exits/merma negative.
  const esperadoDelta = loop.tipoReposicion === "VENDIBLE" ? "4.000" : "-4.000";
  assert.ok(
    devolucionMov !== undefined &&
      devolucionMov.tipoMovimiento === esperadoTipo &&
      devolucionMov.cantidadMovida === esperadoDelta,
    `${loop.etiqueta}: movimiento de devolución esperado ${esperadoTipo} ${esperadoDelta}, observado ${JSON.stringify(devolucionMov)}`,
  );

  return { ventaId, facturaId, ncIds: ncs.map((n) => n.id), stockPostConfirm, stockPostDevolucion };
}

async function main(): Promise<void> {
  console.log("=== stock-shape probe (audit run-3 observation) ===\n");
  const seeds: Seeds = await sembrar();
  const ctx: TenantCtx = {
    empresaId: seeds.empresaId,
    sucursalId: seeds.sucursalId,
    usuarioId: seeds.usuarioId,
    esAdmin: true,
  };

  let obsP: Observed | null = null;
  let obsQ: Observed | null = null;
  try {
    console.log("\n--- Ciclo P (VENDIBLE): venta 10 → devolución 4 VENDIBLE ---");
    obsP = await observarCiclo(seeds, ctx, {
      etiqueta: "P",
      productoId: seeds.productoPId,
      inventarioId: seeds.inventarioPId,
      tipoReposicion: "VENDIBLE",
    });

    console.log("\n--- Ciclo Q (DANADO): venta 10 → devolución 4 DANADO ---");
    obsQ = await observarCiclo(seeds, ctx, {
      etiqueta: "Q",
      productoId: seeds.productoQId,
      inventarioId: seeds.inventarioQId,
      tipoReposicion: "DANADO",
    });
    const invPorEtiqueta = new Map<string, number>([
      ["P", seeds.inventarioPId],
      ["Q", seeds.inventarioQId],
    ]);

    // 3) cancelar both CONFIRMADA sales (motivo fixed by the verification plan).
    console.log(`\n--- cancelarVenta (motivo '${MOTIVO_CANCEL}') ---`);
    const stockPostCancel = new Map<string, string>();
    for (const par of [
      { etiqueta: "P", obs: obsP },
      { etiqueta: "Q", obs: obsQ },
    ] as const) {
      const resultado = await withTenantTransaction(ctx, async (tx) =>
        cancelarVenta(tx, ctx, { id: par.obs.ventaId, motivo: MOTIVO_CANCEL }));
      if (!resultado.ok) throw new Error(`cancelarVenta (${par.etiqueta}) falló: ${resultado.code}`);

      const ventaPost = await sdb.venta.findUnique({ where: { id: par.obs.ventaId }, select: { estado: true } });
      assert.strictEqual(ventaPost?.estado, "CANCELADA", `${par.etiqueta}: VENTA debe quedar CANCELADA`);
      const facturaPost = await sdb.factura.findUnique({ where: { id: par.obs.facturaId }, select: { estado: true } });
      assert.strictEqual(facturaPost?.estado, "ANULADA", `${par.etiqueta}: FACTURA debe quedar ANULADA`);

      const stock = await leerStock(invPorEtiqueta.get(par.etiqueta) as number);
      stockPostCancel.set(par.etiqueta, stock);
      console.log(`  ${par.etiqueta}: cancel ok → VENTA CANCELADA, FACTURA ANULADA, stock=${stock}`);
    }

    // 4) NC estados AFTER cancel (hypothesis: untouched, remain VIGENTE).
    const ncPost = await sdb.notaCredito.findMany({
      where: { id: { in: [...obsP.ncIds, ...obsQ.ncIds] } },
      orderBy: { id: "asc" },
      select: { id: true, ncf: true, estado: true },
    });
    for (const nc of ncPost) {
      assert.strictEqual(nc.estado, "VIGENTE", `NC ${nc.ncf} debe seguir VIGENTE tras cancelar`);
    }

    // 5) Full movement listing per product.
    const movP = await leerMovimientos(seeds.inventarioPId);
    const movQ = await leerMovimientos(seeds.inventarioQId);
    console.log("\n--- MOVIMIENTO_INVENTARIO rows (por producto, en orden de creación) ---");
    for (const [etiqueta, movs] of [["P", movP], ["Q", movQ]] as const) {
      for (const m of movs) {
        console.log(
          `  ${etiqueta}: ${m.tipoMovimiento} cantidadMovida=${m.cantidadMovida} ` +
            `ventaId=${String(m.ventaId)} notaCreditoId=${String(m.notaCreditoId)}`,
        );
      }
    }

    // --------------------------------------------------------------- verdict math
    const semilla = new Decimal(SEMILLA);
    const stockPPost = new Decimal(stockPostCancel.get("P") ?? "NaN");
    const stockQPost = new Decimal(stockPostCancel.get("Q") ?? "NaN");
    const deltaP = stockPPost.minus(new Decimal(obsP.stockPostDevolucion)).toFixed(3);
    const deltaQ = stockQPost.minus(new Decimal(obsQ.stockPostDevolucion)).toFixed(3);
    const sobreCreditoP = stockPPost.minus(semilla).toFixed(3);
    const sobreCreditoQ = stockQPost.minus(semilla).toFixed(3);

    assert.strictEqual(deltaP, "10.000", `P: reposition tras cancel debe ser +10.000, observado ${deltaP}`);
    assert.strictEqual(deltaQ, "10.000", `Q: reposition tras cancel debe ser +10.000, observado ${deltaQ}`);

    const confirmado = sobreCreditoP === "4.000" && sobreCreditoQ === "-4.000";
    console.log("\n--- VEREDICTO ---");
    console.log(`  phantom hypothesis: ${confirmado ? "CONFIRMED" : "REFUTED"}`);
    console.log(`  P: stock post-confirm=${obsP.stockPostConfirm}, post-devolución=${obsP.stockPostDevolucion}, post-cancel=${stockPostCancel.get("P")}; neto vs semilla=${sobreCreditoP} (VENDIBLE over-credit)`);
    console.log(`  Q: stock post-confirm=${obsQ.stockPostConfirm}, post-devolución=${obsQ.stockPostDevolucion}, post-cancel=${stockPostCancel.get("Q")}; neto vs semilla=${sobreCreditoQ} (merma DANADO re-creditada como vendible)`);
    console.log(`  NC estados post-cancel: ${ncPost.map((n) => `${n.ncf}=${n.estado}`).join(", ")}`);
  } finally {
    await limpiar(seeds);
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
    await sdb.$disconnect();
    console.log("\nprobes: ok");
  })
  .catch(async (e) => {
    console.error("\nprobes: fail —", e);
    await prisma.$disconnect();
    await sdb.$disconnect();
    process.exit(1);
  });
