/**
 * Integration — activate / deactivate a branch against real Postgres
 * (odd/tasks/administracion-sucursales-activar.md, T1, S3-S6/S9).
 *
 * Runs the use cases through `withTenantTransaction` as the least-privilege
 * `systemfact_app` role (FORCE RLS), the way the Server Actions do. The harness
 * superuser client only seeds and reads back, so every "refused" assertion also
 * proves that stored rows, versions and audit are unchanged.
 *
 * The two RACES (user move / branch switch into X vs deactivation of X) run two
 * parallel `withTenantTransaction` calls and assert the INVARIANT (exactly one
 * wins; never an active user on an inactive branch), not a fixed winner: which
 * transaction reaches the branch row first is the database's call, and both
 * orders must end consistent.
 */

import { randomUUID } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { withTenantTransaction } from "@/modules/tenant/infrastructure/withTenantTransaction";
import { tieneRolPermitidoEnTx } from "@/modules/tenant/infrastructure/usuario-repository";
import {
  liberarSucursalActivaEnTx,
  activarSucursalEnTx,
} from "@/modules/tenant/infrastructure/repo-sucursal";
import { contarBloqueosSucursalEnTx } from "@/modules/tenant/infrastructure/sucursal-gestion-repository";
import {
  cambiarEstadoSucursal,
  type CambiarEstadoSucursalInput,
} from "@/modules/tenant/application/estado-sucursal";
import { moverUsuarioDeSucursal } from "@/modules/tenant/application/gestion-usuarios";
import { cambiarSucursalActiva } from "@/modules/tenant/application/cambiarSucursalActiva";
import {
  TEN_CONCURRENCIA_CONFLICTO,
  TEN_OPS_NO_AUTORIZADO,
  TEN_SUCURSAL_CON_DOCUMENTOS_ABIERTOS,
  TEN_SUCURSAL_CON_SALDOS_PENDIENTES,
  TEN_SUCURSAL_CON_STOCK,
  TEN_SUCURSAL_CON_USUARIOS,
  TEN_SUCURSAL_NO_VALIDA,
  TEN_SUCURSAL_PROPIA_NO_DESACTIVABLE,
  TEN_SUCURSAL_ULTIMA_ACTIVA,
} from "@/modules/tenant/domain/errors";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import {
  ROLES_GESTION_SUCURSALES,
  ROLES_GESTION_USUARIOS,
} from "@/modules/tenant/http/shared";
import { fijarStock } from "./setup/venta-helpers";
import { getHarnessDb, nombreUsuarioFixture, seedTenantFixture, type TenantFixture } from "./setup/fixtures";

const LIBRE = { usuarios: 0, stock: 0, documentosAbiertos: 0, saldos: 0 };

describe("cambiarEstadoSucursal (real DB)", () => {
  let fx: TenantFixture;
  let rolAdminId: number;
  let rolOperadorId: number;
  let sucursalXId: number; // empty, active, not the session branch
  let clienteId: number;
  let ctxAdmin: TenantCtx; // adminA, session branch A1
  let ctxOperador: TenantCtx;
  let seq = 0;

  const db = () => getHarnessDb();

  const cambiar = (ctx: TenantCtx, input: CambiarEstadoSucursalInput) =>
    withTenantTransaction(ctx, (tx) => cambiarEstadoSucursal(tx, ctx, input));
  const desactivar = (ctx: TenantCtx, sucursalId: number, versionEsperada = 1) =>
    cambiar(ctx, { sucursalId, activa: false, versionEsperada });
  const activar = (ctx: TenantCtx, sucursalId: number, versionEsperada: number) =>
    cambiar(ctx, { sucursalId, activa: true, versionEsperada });

  async function findOrCreateRol(nombre: string): Promise<number> {
    const existente = await db().rol.findFirst({ where: { nombre, activo: true } });
    if (existente !== null) return existente.id;
    return (
      await db().rol.create({ data: { nombre, descripcion: `Integration ${nombre}` } })
    ).id;
  }

  async function crearSucursal(nombre: string, activa = true, empresaId = fx.empresaA.id) {
    return (
      await db().sucursal.create({
        data: { empresaId, nombre, direccion: "x", telefono: "0", activa },
      })
    ).id;
  }

  async function crearUsuario(
    sucursalId: number,
    tag: string,
    rolId: number,
    opts: { activo?: boolean; empresaId?: number } = {},
  ): Promise<number> {
    return (
      await db().usuario.create({
        data: {
          empresaId: opts.empresaId ?? fx.empresaA.id,
          sucursalId,
          nombre: tag,
          nombreUsuario: await nombreUsuarioFixture(opts.empresaId ?? fx.empresaA.id, tag),
          passwordHash: "test-hash",
          activo: opts.activo ?? true,
          roles: { create: { rolId } },
        },
      })
    ).id;
  }

  async function crearCliente(empresaId: number): Promise<number> {
    return (
      await db().cliente.create({
        data: {
          empresaId,
          nombre: `cli-${randomUUID()}`,
          telefono: "0",
          direccion: "x",
          tipoCliente: "CREDITO",
          creditoHabilitado: true,
          limiteCredito: new Prisma.Decimal("20000.00"),
          plazoCreditoDias: 30,
        },
      })
    ).id;
  }

  async function sembrarVenta(
    sucursalId: number,
    estado: "BORRADOR" | "CONFIRMADA" | "CANCELADA",
    empresaId = fx.empresaA.id,
    cliente = clienteId,
    usuarioId = fx.usuarios.adminA.id,
  ) {
    await db().venta.create({
      data: {
        empresaId,
        sucursalId,
        usuarioId,
        clienteId: cliente,
        fecha: new Date("2026-09-01T12:00:00.000Z"),
        estado,
        subtotal: new Prisma.Decimal("100.00"),
        descuento: new Prisma.Decimal("0.00"),
        descuentoTipo: "MONTO",
        itbis: new Prisma.Decimal("0.00"),
        total: new Prisma.Decimal("100.00"),
      },
    });
  }

  async function sembrarCompra(
    sucursalId: number,
    estado: "BORRADOR" | "PENDIENTE" | "RECIBIDA" | "PAGADA" | "CANCELADA",
  ) {
    seq += 1;
    await db().compra.create({
      data: {
        empresaId: fx.empresaA.id,
        sucursalId,
        proveedorId: fx.proveedores.formalJuridica.id,
        usuarioId: fx.usuarios.adminA.id,
        tipoCompra: "MERCANCIA",
        estado,
        correlativoInterno: `CMP-ACT-${seq}-${randomUUID()}`,
        subtotal: new Prisma.Decimal(0),
        subtotalGravado: new Prisma.Decimal(0),
        itbis: new Prisma.Decimal(0),
        subtotalExento: new Prisma.Decimal(0),
        retencionIsr: new Prisma.Decimal(0),
        retencionItbis: new Prisma.Decimal(0),
        total: new Prisma.Decimal(0),
        fecha: new Date("2026-01-10T00:00:00.000Z"),
      },
    });
  }

  /** A fiscal invoice of the branch; optionally one COBRO in the given state. */
  async function sembrarFactura(
    sucursalId: number,
    opts: {
      estado?: "VIGENTE" | "ANULADA";
      total?: string;
      cobro?: { monto: string; estado: "APLICADO" | "REGISTRADO" | "REVERTIDO" };
      empresaId?: number;
      cliente?: number;
      usuarioId?: number;
    } = {},
  ) {
    seq += 1;
    const empresaId = opts.empresaId ?? fx.empresaA.id;
    const total = opts.total ?? "500.00";
    const usuarioId = opts.usuarioId ?? fx.usuarios.adminA.id;
    const factura = await db().factura.create({
      data: {
        empresaId,
        sucursalId,
        clienteId: opts.cliente ?? clienteId,
        usuarioId,
        tipoNcf: "B01",
        ncf: `B01${String(seq).padStart(8, "0")}${empresaId}`,
        correlativoInterno: `FAC-ACT-${seq}-${empresaId}`,
        estado: opts.estado ?? "VIGENTE",
        subtotalGravado: new Prisma.Decimal(total),
        itbis: new Prisma.Decimal("0.00"),
        subtotalExento: new Prisma.Decimal("0.00"),
        descuento: new Prisma.Decimal("0.00"),
        total: new Prisma.Decimal(total),
        fechaEmision: new Date("2026-09-01T12:00:00.000Z"),
      },
    });
    if (opts.cobro !== undefined) {
      await db().pago.create({
        data: {
          facturaId: factura.id,
          empresaId,
          sucursalId,
          usuarioId,
          metodoPago: "EFECTIVO",
          monto: new Prisma.Decimal(opts.cobro.monto),
          fecha: new Date("2026-09-05T12:00:00.000Z"),
          estado: opts.cobro.estado,
          tipo: "COBRO",
          correlativoRecibo: seq,
        },
      });
    }
  }

  async function estado(id: number) {
    return db().sucursal.findUniqueOrThrow({
      where: { id },
      select: { activa: true, version: true },
    });
  }
  async function auditoriaSucursalTotal() {
    return db().movimientoAuditoria.count({ where: { entidad: "Sucursal" } });
  }
  async function auditoriaSucursal(id: number) {
    return db().movimientoAuditoria.findMany({
      where: { entidad: "Sucursal", idEntidad: String(id) },
      orderBy: { id: "asc" },
    });
  }

  /** Seed one blocker of each kind into branch `sucursalId`. */
  const BLOQUEADORES = {
    usuarios: async (s: number) => {
      await crearUsuario(s, "activo", rolOperadorId);
      await crearUsuario(s, "activo2", rolOperadorId);
    },
    stock: async (s: number) => {
      await fijarStock(s, fx.productos.prodA1.id, "5.000");
    },
    documentosAbiertos: async (s: number) => {
      await sembrarVenta(s, "BORRADOR");
      await sembrarCompra(s, "PENDIENTE");
      await sembrarCompra(s, "BORRADOR");
    },
    saldos: async (s: number) => {
      await sembrarFactura(s, { total: "500.00" });
      await sembrarFactura(s, {
        total: "500.00",
        cobro: { monto: "200.00", estado: "APLICADO" },
      });
    },
  } as const;
  const CONTEO_ESPERADO = { usuarios: 2, stock: 1, documentosAbiertos: 3, saldos: 2 } as const;
  const CODIGO = {
    usuarios: TEN_SUCURSAL_CON_USUARIOS,
    stock: TEN_SUCURSAL_CON_STOCK,
    documentosAbiertos: TEN_SUCURSAL_CON_DOCUMENTOS_ABIERTOS,
    saldos: TEN_SUCURSAL_CON_SALDOS_PENDIENTES,
  } as const;

  beforeEach(async () => {
    fx = await seedTenantFixture();
    rolAdminId = await findOrCreateRol("Administrador");
    rolOperadorId = await findOrCreateRol("Operador");
    sucursalXId = await crearSucursal("X-objetivo");
    clienteId = await crearCliente(fx.empresaA.id);
    const operadorId = await crearUsuario(fx.sucursalA1.id, "oper", rolOperadorId);
    ctxAdmin = {
      empresaId: fx.empresaA.id,
      sucursalId: fx.sucursalA1.id,
      usuarioId: fx.usuarios.adminA.id,
      esAdmin: true,
    };
    ctxOperador = { ...ctxAdmin, usuarioId: operadorId, esAdmin: false };
  });

  describe("deactivation", () => {
    it("OK when there are no blockers: activa=false, version +1, ONE ACTUALIZAR audit row {activa} before/after", async () => {
      const result = await desactivar(ctxAdmin, sucursalXId);

      expect(result).toEqual({
        ok: true,
        data: { sucursalId: sucursalXId, activa: false, version: 2, cambio: true },
      });
      expect(await estado(sucursalXId)).toEqual({ activa: false, version: 2 });
      expect(await auditoriaSucursalTotal()).toBe(1);
      const [fila] = await auditoriaSucursal(sucursalXId);
      expect(fila).toMatchObject({
        empresaId: fx.empresaA.id,
        sucursalId: null,
        usuarioId: fx.usuarios.adminA.id,
        accion: "ACTUALIZAR",
        entidad: "Sucursal",
        idEntidad: String(sucursalXId),
        valorAnterior: JSON.stringify({ activa: true }),
        valorNuevo: JSON.stringify({ activa: false }),
      });
    });

    it.each(["usuarios", "stock", "documentosAbiertos", "saldos"] as const)(
      "blocker alone (%s): refused with its code and count, nothing changes, no audit",
      async (bloqueador) => {
        await BLOQUEADORES[bloqueador](sucursalXId);

        const result = await desactivar(ctxAdmin, sucursalXId);

        expect(result).toMatchObject({
          ok: false,
          code: CODIGO[bloqueador],
          detalle: { ...LIBRE, [bloqueador]: CONTEO_ESPERADO[bloqueador], codigos: [CODIGO[bloqueador]] },
        });
        expect(await estado(sucursalXId)).toEqual({ activa: true, version: 1 });
        expect(await auditoriaSucursalTotal()).toBe(0);
      },
    );

    it("all four blockers together: ALL counts and all codes are reported", async () => {
      for (const sembrar of Object.values(BLOQUEADORES)) await sembrar(sucursalXId);

      const result = await desactivar(ctxAdmin, sucursalXId);

      expect(result).toEqual({
        ok: false,
        code: TEN_SUCURSAL_CON_USUARIOS,
        message: expect.any(String),
        detalle: {
          ...CONTEO_ESPERADO,
          codigos: [
            TEN_SUCURSAL_CON_USUARIOS,
            TEN_SUCURSAL_CON_STOCK,
            TEN_SUCURSAL_CON_DOCUMENTOS_ABIERTOS,
            TEN_SUCURSAL_CON_SALDOS_PENDIENTES,
          ],
        },
      });
      expect(await estado(sucursalXId)).toEqual({ activa: true, version: 1 });
      expect(await auditoriaSucursalTotal()).toBe(0);
    });

    it("things that are NOT blockers do not count: inactive user, zero stock, confirmed/cancelled sale, received/paid/cancelled purchase, settled or annulled invoice", async () => {
      await crearUsuario(sucursalXId, "inactivo", rolOperadorId, { activo: false });
      await fijarStock(sucursalXId, fx.productos.prodA1.id, "0.000");
      await sembrarVenta(sucursalXId, "CONFIRMADA");
      await sembrarVenta(sucursalXId, "CANCELADA");
      await sembrarCompra(sucursalXId, "RECIBIDA");
      await sembrarCompra(sucursalXId, "PAGADA");
      await sembrarCompra(sucursalXId, "CANCELADA");
      await sembrarFactura(sucursalXId, {
        total: "300.00",
        cobro: { monto: "300.00", estado: "APLICADO" },
      });
      await sembrarFactura(sucursalXId, { estado: "ANULADA", total: "300.00" });

      const result = await desactivar(ctxAdmin, sucursalXId);

      expect(result).toMatchObject({ ok: true, data: { cambio: true } });
      expect(await estado(sucursalXId)).toEqual({ activa: false, version: 2 });
    });

    it("canonical balance rule: only COBRO/APLICADO reduces it, so an invoice paid only by a REGISTRADO or REVERTIDO cobro still counts as unpaid", async () => {
      await sembrarFactura(sucursalXId, {
        total: "300.00",
        cobro: { monto: "300.00", estado: "REGISTRADO" },
      });
      await sembrarFactura(sucursalXId, {
        total: "300.00",
        cobro: { monto: "300.00", estado: "REVERTIDO" },
      });

      const result = await desactivar(ctxAdmin, sucursalXId);

      expect(result).toMatchObject({
        ok: false,
        code: TEN_SUCURSAL_CON_SALDOS_PENDIENTES,
        detalle: { saldos: 2 },
      });
    });

    it("the session's own branch is refused with its own code", async () => {
      const ctxEnX = { ...ctxAdmin, sucursalId: sucursalXId };

      const result = await desactivar(ctxEnX, sucursalXId);

      expect(result).toMatchObject({
        ok: false,
        code: TEN_SUCURSAL_PROPIA_NO_DESACTIVABLE,
        detalle: { codigos: [TEN_SUCURSAL_PROPIA_NO_DESACTIVABLE] },
      });
      expect(await estado(sucursalXId)).toEqual({ activa: true, version: 1 });
      expect(await auditoriaSucursalTotal()).toBe(0);
    });

    it("the company's last active branch is refused with its own code", async () => {
      await db().sucursal.updateMany({
        where: { id: { in: [fx.sucursalA1.id, fx.sucursalA2.id] } },
        data: { activa: false },
      });

      const result = await desactivar(ctxAdmin, sucursalXId);

      expect(result).toMatchObject({
        ok: false,
        code: TEN_SUCURSAL_ULTIMA_ACTIVA,
        detalle: { codigos: [TEN_SUCURSAL_ULTIMA_ACTIVA] },
      });
      expect(await estado(sucursalXId)).toEqual({ activa: true, version: 1 });
      expect(await auditoriaSucursalTotal()).toBe(0);
    });

    it("counts see OTHER branches' rows (widen): the blockers live in X, the session is in A1", async () => {
      await BLOQUEADORES.usuarios(sucursalXId);
      await BLOQUEADORES.stock(sucursalXId);
      // The session branch has its own rows that must NOT be mixed in.
      await sembrarVenta(fx.sucursalA1.id, "BORRADOR");

      const result = await desactivar(ctxAdmin, sucursalXId);

      expect(result).toMatchObject({
        ok: false,
        detalle: { usuarios: 2, stock: 1, documentosAbiertos: 0, saldos: 0 },
      });
    });

    it("counts never include ANOTHER empresa's rows: counting a foreign branch yields zeros", async () => {
      const rolA = rolOperadorId;
      const usuarioB = await crearUsuario(fx.sucursalB1.id, "userB", rolA, {
        empresaId: fx.empresaB.id,
      });
      const clienteB = await crearCliente(fx.empresaB.id);
      await sembrarVenta(fx.sucursalB1.id, "BORRADOR", fx.empresaB.id, clienteB, usuarioB);
      await sembrarFactura(fx.sucursalB1.id, {
        empresaId: fx.empresaB.id,
        cliente: clienteB,
        usuarioId: usuarioB,
      });
      // empresa B's branch already carries seeded stock (fixture) and users.

      const conteos = await withTenantTransaction(ctxAdmin, async (tx) => {
        await liberarSucursalActivaEnTx(tx);
        try {
          return await contarBloqueosSucursalEnTx(tx, ctxAdmin, fx.sucursalB1.id);
        } finally {
          await activarSucursalEnTx(tx, ctxAdmin.sucursalId);
        }
      });

      expect(conteos).toEqual(LIBRE);
      // Sanity: the rows really exist for empresa B (the superuser sees them).
      expect(await db().inventario.count({ where: { sucursalId: fx.sucursalB1.id } })).toBeGreaterThan(0);
    });

    it("restores the branch GUC after the call, on success AND after a refusal; the empresa GUC is untouched", async () => {
      await BLOQUEADORES.usuarios(sucursalXId);
      const otraId = await crearSucursal("Y-vacia");

      const gucs = await withTenantTransaction(ctxAdmin, async (tx) => {
        const leer = async () =>
          (
            await tx.$queryRaw<{ sucursal: string; empresa: string }[]>`
              SELECT current_setting('app.current_sucursal_id', true) AS "sucursal",
                     current_setting('app.current_empresa_id', true) AS "empresa"`
          )[0];
        const refusal = await cambiarEstadoSucursal(tx, ctxAdmin, {
          sucursalId: sucursalXId,
          activa: false,
          versionEsperada: 1,
        });
        const trasRechazo = await leer();
        const exito = await cambiarEstadoSucursal(tx, ctxAdmin, {
          sucursalId: otraId,
          activa: false,
          versionEsperada: 1,
        });
        const trasExito = await leer();
        return { refusal, exito, trasRechazo, trasExito };
      });

      expect(gucs.refusal.ok).toBe(false);
      expect(gucs.exito.ok).toBe(true);
      for (const guc of [gucs.trasRechazo, gucs.trasExito]) {
        expect(guc).toEqual({
          sucursal: String(fx.sucursalA1.id),
          empresa: String(fx.empresaA.id),
        });
      }
    });
  });

  describe("reactivation and idempotency", () => {
    it("reactivation has no conditions: OK, version +1, ONE audit row with {activa:false} -> {activa:true}", async () => {
      await db().sucursal.update({ where: { id: sucursalXId }, data: { activa: false } });
      // Leftovers do not matter for a reactivation.
      await BLOQUEADORES.stock(sucursalXId);

      const result = await activar(ctxAdmin, sucursalXId, 1);

      expect(result).toEqual({
        ok: true,
        data: { sucursalId: sucursalXId, activa: true, version: 2, cambio: true },
      });
      expect(await estado(sucursalXId)).toEqual({ activa: true, version: 2 });
      expect(await auditoriaSucursalTotal()).toBe(1);
      const [fila] = await auditoriaSucursal(sucursalXId);
      expect(fila).toMatchObject({
        accion: "ACTUALIZAR",
        sucursalId: null,
        valorAnterior: JSON.stringify({ activa: false }),
        valorNuevo: JSON.stringify({ activa: true }),
      });
    });

    it.each([
      ["deactivate an already inactive branch", false],
      ["activate an already active branch", true],
    ] as const)("%s is a no-op: success, no version bump, NO audit", async (_n, activa) => {
      if (!activa) {
        await db().sucursal.update({ where: { id: sucursalXId }, data: { activa: false } });
      }
      // Even with blockers present, a no-op never refuses.
      await BLOQUEADORES.usuarios(sucursalXId);

      const result = await cambiar(ctxAdmin, { sucursalId: sucursalXId, activa, versionEsperada: 1 });

      expect(result).toEqual({
        ok: true,
        data: { sucursalId: sucursalXId, activa, version: 1, cambio: false },
      });
      expect(await estado(sucursalXId)).toEqual({ activa, version: 1 });
      expect(await auditoriaSucursalTotal()).toBe(0);
    });

    it("a stale version is refused (even when the state is already in place): nothing changes", async () => {
      const result = await desactivar(ctxAdmin, sucursalXId, 9);
      expect(result).toMatchObject({ ok: false, code: TEN_CONCURRENCIA_CONFLICTO });

      await db().sucursal.update({ where: { id: sucursalXId }, data: { activa: false } });
      const yaInactiva = await desactivar(ctxAdmin, sucursalXId, 9);
      expect(yaInactiva).toMatchObject({ ok: false, code: TEN_CONCURRENCIA_CONFLICTO });

      expect(await estado(sucursalXId)).toEqual({ activa: false, version: 1 });
      expect(await auditoriaSucursalTotal()).toBe(0);
    });
  });

  describe("authorization and tenancy", () => {
    it("the action gate refuses an Operador: the use case is never reached", async () => {
      const result = await withTenantTransaction(ctxOperador, async (tx) => {
        const permitido = await tieneRolPermitidoEnTx(
          tx,
          ctxOperador.usuarioId,
          ctxOperador.empresaId,
          ROLES_GESTION_SUCURSALES,
        );
        if (!permitido) return { ok: false as const, code: TEN_OPS_NO_AUTORIZADO };
        return cambiarEstadoSucursal(tx, ctxOperador, {
          sucursalId: sucursalXId,
          activa: false,
          versionEsperada: 1,
        });
      });

      expect(result).toEqual({ ok: false, code: TEN_OPS_NO_AUTORIZADO });
      expect(await estado(sucursalXId)).toEqual({ activa: true, version: 1 });
    });

    it("with the gate bypassed, RLS still refuses an Operador: typed TEN_OPS_NO_AUTORIZADO, nothing stored, no audit", async () => {
      const desactivacion = await desactivar(ctxOperador, sucursalXId);
      expect(desactivacion).toMatchObject({ ok: false, code: TEN_OPS_NO_AUTORIZADO });

      await db().sucursal.update({ where: { id: sucursalXId }, data: { activa: false } });
      const reactivacion = await activar(ctxOperador, sucursalXId, 1);
      expect(reactivacion).toMatchObject({ ok: false, code: TEN_OPS_NO_AUTORIZADO });

      expect(await estado(sucursalXId)).toEqual({ activa: false, version: 1 });
      expect(await auditoriaSucursalTotal()).toBe(0);
    });

    it("a branch of ANOTHER empresa (and an unknown id) is TEN_SUCURSAL_NO_VALIDA; nothing changes", async () => {
      const foranea = await desactivar(ctxAdmin, fx.sucursalB1.id, 1);
      const inexistente = await desactivar(ctxAdmin, 999_999, 1);

      for (const result of [foranea, inexistente]) {
        expect(result).toEqual({
          ok: false,
          code: TEN_SUCURSAL_NO_VALIDA,
          message: expect.any(String),
        });
      }
      expect((await estado(fx.sucursalB1.id)).activa).toBe(true);
      expect(await auditoriaSucursalTotal()).toBe(0);
    });
  });

  describe("races (S5): two parallel withTenantTransaction calls", () => {
    const VUELTAS = 5;

    it("(a) user move into X vs deactivation of X: exactly one wins, never an ACTIVE user on an inactive branch", async () => {
      for (let i = 0; i < VUELTAS; i += 1) {
        const x = await crearSucursal(`X-move-${i}`);
        const usuarioId = await crearUsuario(fx.sucursalA1.id, `mov${i}`, rolOperadorId);

        const mover = () =>
          withTenantTransaction(ctxAdmin, (tx) =>
            moverUsuarioDeSucursal(
              tx,
              ctxAdmin,
              { usuarioId, sucursalDestinoId: x, versionEsperada: 1 },
              ROLES_GESTION_USUARIOS,
            ),
          );
        const baja = () => desactivar(ctxAdmin, x);
        // Alternate which transaction is launched first to vary the arrival order.
        const [resMover, resBaja] =
          i % 2 === 0
            ? await Promise.all([mover(), baja()])
            : await Promise.all([baja(), mover()]).then(([b, m]) => [m, b] as const);

        expect([resMover.ok, resBaja.ok].filter(Boolean)).toHaveLength(1);
        const sucursal = await estado(x);
        const usuario = await db().usuario.findUniqueOrThrow({
          where: { id: usuarioId },
          select: { sucursalId: true, activo: true },
        });
        if (resMover.ok) {
          expect(resBaja).toMatchObject({ ok: false, code: TEN_SUCURSAL_CON_USUARIOS });
          expect(sucursal.activa).toBe(true);
          expect(usuario.sucursalId).toBe(x);
        } else {
          expect(resMover).toMatchObject({ ok: false, code: TEN_SUCURSAL_NO_VALIDA });
          expect(sucursal.activa).toBe(false);
          expect(usuario.sucursalId).toBe(fx.sucursalA1.id);
        }
        // The invariant, stated directly:
        const activosEnInactiva = await db().usuario.count({
          where: { sucursalId: x, activo: true, sucursal: { activa: false } },
        });
        expect(activosEnInactiva).toBe(0);
      }
    }, 60_000);

    it("(b) branch switch into X vs deactivation of X: exactly one wins, never an ACTIVE user on an inactive branch", async () => {
      for (let i = 0; i < VUELTAS; i += 1) {
        const x = await crearSucursal(`X-switch-${i}`);
        const admin2Id = await crearUsuario(fx.sucursalA1.id, `adm${i}`, rolAdminId);
        const ctxAdmin2: TenantCtx = { ...ctxAdmin, usuarioId: admin2Id };

        const cambiarSucursal = () =>
          withTenantTransaction(ctxAdmin2, (tx) =>
            cambiarSucursalActiva(ctxAdmin2, { sucursalId: x }, tx),
          );
        const baja = () => desactivar(ctxAdmin, x);
        const [resSwitch, resBaja] =
          i % 2 === 0
            ? await Promise.all([cambiarSucursal(), baja()])
            : await Promise.all([baja(), cambiarSucursal()]).then(([b, s]) => [s, b] as const);

        expect([resSwitch.ok, resBaja.ok].filter(Boolean)).toHaveLength(1);
        const sucursal = await estado(x);
        const admin2 = await db().usuario.findUniqueOrThrow({
          where: { id: admin2Id },
          select: { sucursalId: true },
        });
        if (resSwitch.ok) {
          expect(resBaja).toMatchObject({ ok: false, code: TEN_SUCURSAL_CON_USUARIOS });
          expect(sucursal.activa).toBe(true);
          expect(admin2.sucursalId).toBe(x);
        } else {
          expect(resSwitch).toMatchObject({ ok: false, code: TEN_SUCURSAL_NO_VALIDA });
          expect(sucursal.activa).toBe(false);
          expect(admin2.sucursalId).toBe(fx.sucursalA1.id);
        }
        const activosEnInactiva = await db().usuario.count({
          where: { sucursalId: x, activo: true, sucursal: { activa: false } },
        });
        expect(activosEnInactiva).toBe(0);
      }
    }, 60_000);
  });
});
