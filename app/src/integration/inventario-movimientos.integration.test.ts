/**
 * Integration tests — Inventario movement history (odd/tasks/inventario-historial.md
 * S2-S4, S7) against the real `systemfact_test` database, through
 * `withTenantTransaction` (least-privilege app role + RLS GUCs).
 *
 * Seeds movements of several tipos/dates in branch A1, the sibling branch A2 and
 * empresa B, then proves only the session branch's rows are ever returned.
 */

import { Prisma, type TipoMovimiento } from "@/generated/prisma/client";
import { withTenantTransaction } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import { listarMovimientosInventario } from "@/modules/inventario/application/listar-movimientos-inventario";
import { tieneRolPermitidoEnTx } from "@/modules/inventario/infrastructure/inventario-repository";
import { ROLES_GESTION_INVENTARIO } from "@/modules/inventario/http/shared";
import { getHarnessDb, seedTenantFixture, type TenantFixture } from "./setup/fixtures";

const AHORA = new Date("2026-11-14T16:00:00.000Z");

function ctxA1(fixture: TenantFixture): TenantCtx {
  return {
    empresaId: fixture.empresaA.id,
    sucursalId: fixture.sucursalA1.id,
    usuarioId: fixture.usuarios.adminA.id,
    esAdmin: true,
  };
}

interface MovimientoSeed {
  readonly inventarioId: number;
  readonly usuarioId: number;
  readonly tipo: TipoMovimiento;
  readonly fecha: string;
  readonly motivo: string;
  readonly anterior?: string;
  readonly movida?: string;
}

async function crearMovimiento(m: MovimientoSeed) {
  const anterior = new Prisma.Decimal(m.anterior ?? "10");
  const movida = new Prisma.Decimal(m.movida ?? "1");
  return getHarnessDb().movimientoInventario.create({
    data: {
      inventarioId: m.inventarioId,
      usuarioId: m.usuarioId,
      tipoMovimiento: m.tipo,
      motivo: m.motivo,
      cantidadAnterior: anterior,
      cantidadMovida: movida,
      cantidadNueva: anterior.plus(movida),
      fecha: new Date(m.fecha),
      idempotencyKey: `secret-${m.motivo}`,
    },
  });
}

describe("listarMovimientosInventario (real DB, app role + RLS)", () => {
  let fixture: TenantFixture;
  let ctx: TenantCtx;
  let inventarioA1b: number;

  const listar = (query: Parameters<typeof listarMovimientosInventario>[2]) =>
    withTenantTransaction(ctx, (tx) => listarMovimientosInventario(tx, ctx, query, AHORA));

  async function motivos(query: Parameters<typeof listarMovimientosInventario>[2]) {
    const r = await listar(query);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("unreachable");
    return { motivos: r.data.items.map((i) => i.motivo), data: r.data };
  }

  beforeEach(async () => {
    fixture = await seedTenantFixture();
    ctx = ctxA1(fixture);
    const db = getHarnessDb();
    const adminA = fixture.usuarios.adminA.id;

    // A second product with its own stock row in A1 (name differs for the text filter).
    const prodA1 = await db.producto.findUniqueOrThrow({ where: { id: fixture.productos.prodA1.id } });
    const arroz = await db.producto.create({
      data: {
        empresaId: fixture.empresaA.id,
        categoriaId: prodA1.categoriaId,
        nombre: "Arroz Selecto",
        codigo: "ARZ-100",
        codigoBarras: "BC-ARZ-100",
        unidadMedida: "u",
        unidadEmpaque: "c",
        stockMinimo: 0,
        precioCompra: new Prisma.Decimal(0),
        precioVenta: new Prisma.Decimal(0),
        costoPromedio: new Prisma.Decimal(0),
        tasaItbis: new Prisma.Decimal(18),
        itbisVigenteDesde: new Date(),
      },
    });
    const invArroz = await db.inventario.create({
      data: {
        sucursalId: fixture.sucursalA1.id,
        productoId: arroz.id,
        cantidad: new Prisma.Decimal("10.000"),
      },
    });
    inventarioA1b = invArroz.id;
    const inventarioA1 = fixture.inventarios.a1ProdA1.id;

    // Branch A1 (visible): tipos and dates, SD window 2026-11-01 .. 2026-11-10.
    await crearMovimiento({ inventarioId: inventarioA1, usuarioId: adminA, tipo: "AJUSTE", fecha: "2026-11-05T15:00:00.000Z", motivo: "a1-ajuste", movida: "-2.500", anterior: "12.500" });
    await crearMovimiento({ inventarioId: inventarioA1, usuarioId: adminA, tipo: "SALIDA_VENTA", fecha: "2026-11-06T15:00:00.000Z", motivo: "a1-venta" });
    await crearMovimiento({ inventarioId: inventarioA1, usuarioId: adminA, tipo: "ENTRADA_COMPRA", fecha: "2026-11-07T15:00:00.000Z", motivo: "a1-compra" });
    await crearMovimiento({ inventarioId: invArroz.id, usuarioId: adminA, tipo: "AJUSTE", fecha: "2026-11-08T15:00:00.000Z", motivo: "a1-arroz-ajuste" });
    await crearMovimiento({ inventarioId: invArroz.id, usuarioId: adminA, tipo: "SALIDA_MERMA", fecha: "2026-11-09T15:00:00.000Z", motivo: "a1-arroz-merma" });
    // Same instant: order must fall back to id desc.
    await crearMovimiento({ inventarioId: invArroz.id, usuarioId: adminA, tipo: "ENTRADA_DEVOLUCION", fecha: "2026-11-09T16:00:00.000Z", motivo: "a1-empate-1" });
    await crearMovimiento({ inventarioId: invArroz.id, usuarioId: adminA, tipo: "REPOSICION_CANCELACION", fecha: "2026-11-09T16:00:00.000Z", motivo: "a1-empate-2" });
    // SD day-window boundaries of [2026-11-01, 2026-11-10] (SD = UTC-4).
    await crearMovimiento({ inventarioId: inventarioA1, usuarioId: adminA, tipo: "AJUSTE", fecha: "2026-11-01T03:59:59.999Z", motivo: "borde-antes-inicio" });
    await crearMovimiento({ inventarioId: inventarioA1, usuarioId: adminA, tipo: "AJUSTE", fecha: "2026-11-01T04:00:00.000Z", motivo: "borde-inicio" });
    await crearMovimiento({ inventarioId: inventarioA1, usuarioId: adminA, tipo: "AJUSTE", fecha: "2026-11-11T03:59:59.999Z", motivo: "borde-fin-incluido" });
    await crearMovimiento({ inventarioId: inventarioA1, usuarioId: adminA, tipo: "AJUSTE", fecha: "2026-11-11T04:00:00.000Z", motivo: "borde-fin-excluido" });

    // Never visible from A1: sibling branch A2 and the other empresa.
    await crearMovimiento({ inventarioId: fixture.inventarios.a2ProdA2Only.id, usuarioId: adminA, tipo: "AJUSTE", fecha: "2026-11-05T15:00:00.000Z", motivo: "a2-ajuste" });
    await crearMovimiento({ inventarioId: fixture.inventarios.b1ProdB1.id, usuarioId: fixture.usuarios.adminB.id, tipo: "AJUSTE", fecha: "2026-11-05T15:00:00.000Z", motivo: "b-ajuste" });
  });

  const RANGO = { desde: "2026-11-01", hasta: "2026-11-10" };

  it("returns ONLY the session branch's rows: sibling branch A2 and empresa B never appear", async () => {
    const { motivos: m, data } = await motivos({ page: 1, limit: 100, ...RANGO });

    expect(m).toEqual(
      expect.arrayContaining(["a1-ajuste", "a1-venta", "a1-compra", "a1-arroz-ajuste", "a1-arroz-merma"]),
    );
    expect(m).not.toContain("a2-ajuste");
    expect(m).not.toContain("b-ajuste");
    expect(data.total).toBe(m.length);
  });

  it("applies the SD day window half-open: [SD 00:00 desde, SD 00:00 after hasta)", async () => {
    const { motivos: m } = await motivos({ page: 1, limit: 100, ...RANGO });

    expect(m).toContain("borde-inicio");
    expect(m).toContain("borde-fin-incluido");
    expect(m).not.toContain("borde-antes-inicio");
    expect(m).not.toContain("borde-fin-excluido");

    // The excluded instants belong to the neighbouring SD days.
    const antes = await motivos({ page: 1, limit: 100, desde: "2026-10-31", hasta: "2026-10-31" });
    expect(antes.motivos).toEqual(["borde-antes-inicio"]);
    const despues = await motivos({ page: 1, limit: 100, desde: "2026-11-11", hasta: "2026-11-11" });
    expect(despues.motivos).toEqual(["borde-fin-excluido"]);
  });

  it("orders newest first with id desc as the tie-break", async () => {
    const { data } = await listar({ page: 1, limit: 100, ...RANGO }).then((r) => {
      if (!r.ok) throw new Error(r.code);
      return r;
    });

    const fechas = data.items.map((i) => i.fecha);
    expect(fechas).toEqual([...fechas].sort().reverse());
    const empates = data.items.filter((i) => i.fecha === "2026-11-09T16:00:00.000Z");
    expect(empates.map((i) => i.motivo)).toEqual(["a1-empate-2", "a1-empate-1"]);
    expect(empates[0].id).toBeGreaterThan(empates[1].id);
  });

  it("filters by tipo and keeps total == the filtered row count", async () => {
    const { motivos: m, data } = await motivos({ page: 1, limit: 100, tipo: "AJUSTE", ...RANGO });

    expect(m.sort()).toEqual(["a1-ajuste", "a1-arroz-ajuste", "borde-fin-incluido", "borde-inicio"]);
    expect(data.total).toBe(4);
  });

  it("filters by producto text over codigo and nombre, case-insensitive, combined with tipo", async () => {
    const porNombre = await motivos({ page: 1, limit: 100, producto: "arroz", ...RANGO });
    const porCodigo = await motivos({ page: 1, limit: 100, producto: "arz-1", ...RANGO });
    const porCodigoFixture = await motivos({
      page: 1,
      limit: 100,
      producto: fixture.productos.prodA1.codigo.toLowerCase(),
      ...RANGO,
    });
    const combinado = await motivos({ page: 1, limit: 100, producto: "ARROZ", tipo: "SALIDA_MERMA", ...RANGO });
    const nada = await motivos({ page: 1, limit: 100, producto: "zz-no-existe", ...RANGO });

    expect(porNombre.data.total).toBe(porNombre.motivos.length);
    expect(porNombre.motivos.sort()).toEqual(
      ["a1-arroz-ajuste", "a1-arroz-merma", "a1-empate-1", "a1-empate-2"].sort(),
    );
    expect(porCodigo.motivos.sort()).toEqual(porNombre.motivos.sort());
    expect(porCodigoFixture.motivos).not.toContain("a1-arroz-merma");
    expect(porCodigoFixture.motivos).toContain("a1-ajuste");
    expect(combinado.motivos).toEqual(["a1-arroz-merma"]);
    expect(combinado.data.total).toBe(1);
    expect(nada.data).toMatchObject({ items: [], total: 0 });
  });

  it("treats % and _ in the producto text literally (no wildcard)", async () => {
    const porcentaje = await motivos({ page: 1, limit: 100, producto: "%", ...RANGO });
    const guion = await motivos({ page: 1, limit: 100, producto: "_", ...RANGO });

    expect(porcentaje.data.total).toBe(0);
    expect(guion.data.total).toBe(0);
  });

  it("paginates: pages are disjoint, cover the whole filtered set and total stays constant", async () => {
    const todo = await motivos({ page: 1, limit: 100, ...RANGO });
    const p1 = await motivos({ page: 1, limit: 3, ...RANGO });
    const p2 = await motivos({ page: 2, limit: 3, ...RANGO });
    const p4 = await motivos({ page: 4, limit: 3, ...RANGO });

    expect(p1.motivos).toEqual(todo.motivos.slice(0, 3));
    expect(p2.motivos).toEqual(todo.motivos.slice(3, 6));
    expect(p4.motivos).toEqual(todo.motivos.slice(9, 12));
    expect(new Set([...p1.motivos, ...p2.motivos]).size).toBe(6);
    for (const p of [p1, p2, p4]) expect(p.data.total).toBe(todo.data.total);
    const fuera = await motivos({ page: 99, limit: 3, ...RANGO });
    expect(fuera.data).toMatchObject({ items: [], total: todo.data.total });
  });

  it("defaults to the last 30 SD days and echoes the applied range", async () => {
    const r = await listar({ page: 1, limit: 100 });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data).toMatchObject({ desde: "2026-10-16", hasta: "2026-11-14" });
    expect(r.data.items.length).toBeGreaterThan(0);
  });

  it("returns an empty page for a window with no movements", async () => {
    const r = await listar({ page: 1, limit: 25, desde: "2026-09-01", hasta: "2026-09-10" });

    expect(r).toMatchObject({ ok: true, data: { items: [], total: 0, page: 1, limit: 25 } });
  });

  it("rejects an inverted range and a range over 90 days with typed codes (no read)", async () => {
    const invertido = await listar({ page: 1, limit: 25, desde: "2026-11-10", hasta: "2026-11-01" });
    const excedido = await listar({ page: 1, limit: 25, desde: "2026-06-01", hasta: "2026-11-01" });

    expect(invertido).toMatchObject({ ok: false, code: "RANGO_FECHAS_INVALIDO" });
    expect(excedido).toMatchObject({ ok: false, code: "RANGO_FECHAS_EXCEDIDO" });
  });

  it("maps quantities as Decimal strings and never exposes idempotencyKey or costs", async () => {
    const r = await listar({ page: 1, limit: 100, tipo: "AJUSTE", producto: fixture.productos.prodA1.codigo, ...RANGO });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const fila = r.data.items.find((i) => i.motivo === "a1-ajuste");
    expect(fila).toEqual({
      id: expect.any(Number),
      fecha: "2026-11-05T15:00:00.000Z",
      tipo: "AJUSTE",
      productoCodigo: fixture.productos.prodA1.codigo,
      productoNombre: fixture.productos.prodA1.codigo,
      cantidadMovida: "-2.5",
      cantidadAnterior: "12.5",
      cantidadNueva: "10",
      usuarioNombre: "Admin A",
      motivo: "a1-ajuste",
    });
    expect(JSON.stringify(r.data)).not.toMatch(/idempotencyKey|secret-|costo|precio/i);
  });

  it("does not leak when the SAME product code exists in both empresas' rows (anchor is the branch)", async () => {
    // A user of empresa B reading with its own ctx sees only B's movement.
    const ctxB: TenantCtx = {
      empresaId: fixture.empresaB.id,
      sucursalId: fixture.sucursalB1.id,
      usuarioId: fixture.usuarios.adminB.id,
      esAdmin: true,
    };
    const r = await withTenantTransaction(ctxB, (tx) =>
      listarMovimientosInventario(tx, ctxB, { page: 1, limit: 100, ...RANGO }, AHORA),
    );

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.items.map((i) => i.motivo)).toEqual(["b-ajuste"]);
    expect(r.data.total).toBe(1);
  });

  it("still lists a movement written by a user of ANOTHER branch (user row hidden by RLS must not break the page)", async () => {
    const db = getHarnessDb();
    const otroUsuario = await db.usuario.create({
      data: {
        empresaId: fixture.empresaA.id,
        sucursalId: fixture.sucursalA2.id,
        nombre: "Usuario de A2",
        nombreUsuario: `int-a2-${Date.now()}`,
        passwordHash: "test-hash",
      },
    });
    await crearMovimiento({ inventarioId: inventarioA1b, usuarioId: otroUsuario.id, tipo: "AJUSTE", fecha: "2026-11-09T20:00:00.000Z", motivo: "a1-usuario-a2" });

    const r = await motivos({ page: 1, limit: 100, ...RANGO });

    expect(r.motivos).toContain("a1-usuario-a2");
  });
});

describe("history access guard (real DB)", () => {
  async function rolDe(
    fixture: TenantFixture,
    nombreRol: "Operador" | "Despachador",
  ): Promise<number> {
    const db = getHarnessDb();
    let rol = await db.rol.findFirst({ where: { nombre: nombreRol } });
    if (rol === null) {
      rol = await db.rol.create({ data: { nombre: nombreRol, descripcion: "Integration harness role" } });
    }
    const usuario = await db.usuario.create({
      data: {
        empresaId: fixture.empresaA.id,
        sucursalId: fixture.sucursalA1.id,
        nombre: nombreRol,
        nombreUsuario: `int-${nombreRol}-${Date.now()}`,
        passwordHash: "test-hash",
        roles: { create: { rolId: rol.id } },
      },
    });
    return usuario.id;
  }

  it("lets the Administrador in and refuses Operador and Despachador (manage group only)", async () => {
    const fixture = await seedTenantFixture();
    const operadorId = await rolDe(fixture, "Operador");
    const despachadorId = await rolDe(fixture, "Despachador");
    const ctx = ctxA1(fixture);

    const respuestas = await withTenantTransaction(ctx, async (tx) => ({
      admin: await tieneRolPermitidoEnTx(tx, fixture.usuarios.adminA.id, fixture.empresaA.id, ROLES_GESTION_INVENTARIO),
      operador: await tieneRolPermitidoEnTx(tx, operadorId, fixture.empresaA.id, ROLES_GESTION_INVENTARIO),
      despachador: await tieneRolPermitidoEnTx(tx, despachadorId, fixture.empresaA.id, ROLES_GESTION_INVENTARIO),
    }));

    expect(respuestas).toEqual({ admin: true, operador: false, despachador: false });
  });
});
