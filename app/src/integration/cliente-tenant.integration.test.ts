/**
 * Integration — fase-5a-clientes (real DB `systemfact_test`, RLS ON).
 *
 * Proves, against a live Postgres with the enforced `cliente_isolation` policy
 * and the two DB partial uniques (fiscal-over-active and CF-over-empresa):
 *   (a) tenant PII isolation (foreign id == unknown id, no existence leak);
 *   (b) Consumidor Final race safety + idempotent seed (exactly one per empresa);
 *   (c) optimistic-lock conflict preserves newer data;
 *   (d) credit edits are Admin-only (Operador rejected with zero writes), the
 *       credit⇒RNC cross-field rule is a zero-write failure, and audit payloads
 *       stay VARCHAR(255)-safe;
 *   (e) the real `Venta` deactivation guard (CONFIRMADA blocks, CANCELADA frees);
 *   (f) the active-only partial unique releases a fiscal ID for reuse after
 *       deactivation — which is ALSO the runtime resolution of the documented
 *       `schema.prisma` `@@unique` drift (the DB partial index governs);
 *   (g) a mid-transaction rollback leaves neither the row nor its audit.
 *
 * The HTTP role gate is not directly importable here (it needs a Supabase
 * session); it is replicated EXACTLY the way the compra non-admin integration
 * test does — the real `tieneRolPermitidoEnTx` over the real role tables, proving
 * the server-side decision, not a mocked return.
 */

import { withTenantTransaction } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import { Decimal } from "decimal.js";
import { crearCliente } from "@/modules/cliente/application/crear-cliente";
import { obtenerCliente } from "@/modules/cliente/application/obtener-cliente";
import { listarClientes } from "@/modules/cliente/application/listar-clientes";
import {
  actualizarCliente,
  llevaCamposDeCredito,
} from "@/modules/cliente/application/actualizar-cliente";
import { desactivarCliente } from "@/modules/cliente/application/desactivar-cliente";
import { getOrCreateConsumidorFinalEnTx } from "@/modules/cliente/application/consumidor-final";
import { tieneRolPermitidoEnTx } from "@/modules/cliente/infrastructure/cliente-repository";
import {
  NO_AUTORIZADO,
  CLIENTE_NO_ENCONTRADO,
} from "@/modules/cliente/domain/errors";
import { seedConsumidorFinalParaEmpresa } from "../../tools/scripts/seed-consumidor-final";
import {
  getHarnessDb,
  seedTenantFixture,
  type TenantFixture,
} from "./setup/fixtures";

const ROLES_GESTION = ["Administrador", "Operador"];
const ROLES_ADMIN_ONLY = ["Administrador"];

// A mod-11-valid 9-digit RNC (the shared-validator fixture).
const RNC_OK = "131045677";

describe("cliente tenant integration (real DB)", () => {
  let fixture: TenantFixture;
  let ctxA: TenantCtx;
  let ctxB: TenantCtx;

  beforeEach(async () => {
    fixture = await seedTenantFixture();
    ctxA = {
      empresaId: fixture.empresaA.id,
      sucursalId: fixture.sucursalA1.id,
      usuarioId: fixture.usuarios.adminA.id,
      esAdmin: true,
    };
    ctxB = {
      empresaId: fixture.empresaB.id,
      sucursalId: fixture.sucursalB1.id,
      usuarioId: fixture.usuarios.adminB.id,
      esAdmin: true,
    };
  });

  /** Create an active non-CF client for `ctx` and return its domain row. */
  async function crear(
    ctx: TenantCtx,
    overrides: Record<string, unknown> = {},
  ): Promise<number> {
    return withTenantTransaction(ctx, async (tx) => {
      const r = await crearCliente(tx, ctx, {
        nombre: `Cliente-${Date.now()}-${Math.random()}`,
        telefono: "809-555-0000",
        direccion: "Av. 1",
        identificacionFiscal: RNC_OK,
        tipoCliente: "MAYORISTA",
        ...overrides,
      });
      if (!r.ok) throw new Error(`crear failed: ${r.code}`);
      return r.data.id;
    });
  }

  async function crearVenta(conf: {
    empresaId: number;
    sucursalId: number;
    usuarioId: number;
    clienteId: number;
    estado: "BORRADOR" | "CONFIRMADA" | "CANCELADA";
  }): Promise<number> {
    const db = getHarnessDb();
    const v = await db.venta.create({
      data: {
        empresaId: conf.empresaId,
        sucursalId: conf.sucursalId,
        usuarioId: conf.usuarioId,
        clienteId: conf.clienteId,
        fecha: new Date("2026-01-10T00:00:00.000Z"),
        estado: conf.estado,
        subtotal: new Decimal("100.00"),
        descuento: new Decimal("0.00"),
        descuentoTipo: "MONTO",
        itbis: new Decimal("18.00"),
        total: new Decimal("118.00"),
      },
    });
    return v.id;
  }

  // ---------------------------------------------------------------------------
  // (a) Tenant PII isolation (R1)
  // ---------------------------------------------------------------------------
  it("(a) a foreign-empresa client is indistinguishable from an unknown id", async () => {
    const idA = await crear(ctxA);

    const detalleAjeno = await withTenantTransaction(ctxB, (tx) =>
      obtenerCliente(tx, ctxB, { id: idA }),
    );
    expect(detalleAjeno.ok === false && detalleAjeno.code).toBe(
      CLIENTE_NO_ENCONTRADO,
    );

    const inexistente = await withTenantTransaction(ctxB, (tx) =>
      obtenerCliente(tx, ctxB, { id: 999_999 }),
    );
    // Both the foreign id and the never-existed id return the SAME code + message
    // — no existence oracle.
    expect(inexistente).toEqual(detalleAjeno);

    // Deactivation of a foreign row is likewise a not-found, never a "forbidden"
    // (which would leak that the row exists elsewhere).
    const deactAjeno = await withTenantTransaction(ctxB, (tx) =>
      desactivarCliente(tx, ctxB, { id: idA }),
    );
    expect(deactAjeno.ok === false && deactAjeno.code).toBe(CLIENTE_NO_ENCONTRADO);

    // Listing never shows another tenant's client.
    const listadoB = await withTenantTransaction(ctxB, (tx) =>
      listarClientes(tx, ctxB, { page: 1, limit: 100 }),
    );
    expect(listadoB.ok === true && listadoB.data.total).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // (b) Consumidor Final — race safety + idempotent seed (R2)
  // ---------------------------------------------------------------------------
  it("(b) two concurrent get-or-creates leave exactly ONE Consumidor Final", async () => {
    const getOrCreateOnce = () =>
      withTenantTransaction(ctxA, (tx) =>
        getOrCreateConsumidorFinalEnTx(tx, ctxA.empresaId),
      );

    const [r1, r2] = await Promise.all([getOrCreateOnce(), getOrCreateOnce()]);

    // Both callers observe the same single row (never a duplicate id, never a
    // thrown P2002 to the caller — the loser refetches the winner).
    expect(r1.id).toBe(r2.id);
    expect(r1.esConsumidorFinal).toBe(true);
    expect(r1.identificacionFiscal).toBeNull();
    expect(r1.nombre).toBe("Consumidor Final");

    const db = getHarnessDb();
    const cfRows = await db.cliente.count({
      where: { empresaId: fixture.empresaA.id, esConsumidorFinal: true },
    });
    expect(cfRows).toBe(1);
  });

  it("(b) the seed is idempotent across re-runs and per-empresa", async () => {
    const db = getHarnessDb();
    await seedConsumidorFinalParaEmpresa(db, fixture.empresaA.id);
    await seedConsumidorFinalParaEmpresa(db, fixture.empresaA.id); // re-run
    await seedConsumidorFinalParaEmpresa(db, fixture.empresaB.id); // other tenant

    for (const empresaId of [fixture.empresaA.id, fixture.empresaB.id]) {
      const cf = await db.cliente.findMany({
        where: { empresaId, esConsumidorFinal: true },
      });
      expect(cf).toHaveLength(1);
      expect(cf[0].identificacionFiscal).toBeNull();
      expect(String(cf[0].limiteCredito)).toBe("0"); // DEFAULT 0.00
      expect(cf[0].plazoCreditoDias).toBe(30);
      expect(cf[0].tipoCliente).toBe("MINORISTA");
    }

    // The reserved CF row is hidden from OPERATOR list and detail (design:
    // list/detail exclude esConsumidorFinal); only the get-or-create seam reads it.
    const listadoA = await withTenantTransaction(ctxA, (tx) =>
      listarClientes(tx, ctxA, { page: 1, limit: 100, incluirInactivos: true }),
    );
    expect(
      listadoA.ok === true &&
        listadoA.data.items.some((c) => c.esConsumidorFinal),
    ).toBe(false);
    const cfA = await db.cliente.findFirst({
      where: { empresaId: fixture.empresaA.id, esConsumidorFinal: true },
    });
    const detalleCf = await withTenantTransaction(ctxA, (tx) =>
      obtenerCliente(tx, ctxA, { id: cfA!.id }),
    );
    expect(detalleCf.ok === false && detalleCf.code).toBe(CLIENTE_NO_ENCONTRADO);
  });

  // ---------------------------------------------------------------------------
  // (c) Optimistic-lock conflict preserves newer data
  // ---------------------------------------------------------------------------
  it("(c) a stale-version update is rejected and the newer data is preserved", async () => {
    const id = await crear(ctxA);

    const primero = await withTenantTransaction(ctxA, (tx) =>
      actualizarCliente(tx, ctxA, { id, version: 1, nombre: "Primero" }),
    );
    expect(primero.ok).toBe(true);

    const conflicto = await withTenantTransaction(ctxA, (tx) =>
      actualizarCliente(tx, ctxA, { id, version: 1, nombre: "Perdio" }),
    );
    expect(conflicto.ok === false && conflicto.code).toBe("CONCURRENCIA_CONFLICTO");

    const final = await withTenantTransaction(ctxA, (tx) =>
      obtenerCliente(tx, ctxA, { id }),
    );
    expect(final.ok === true && final.data.nombre).toBe("Primero");
    expect(final.ok === true && final.data.version).toBe(2);
  });

  // ---------------------------------------------------------------------------
  // (d) Credit: Admin-only server gate + credit⇒RNC zero-write + small audit
  // ---------------------------------------------------------------------------
  it("(d) an Operador credit-field edit is rejected by the real role table, zero writes", async () => {
    const db = getHarnessDb();
    let rolOperador = await db.rol.findFirst({ where: { nombre: "Operador" } });
    if (rolOperador === null) {
      rolOperador = await db.rol.create({
        data: { nombre: "Operador", descripcion: "Integration harness operador role" },
      });
    }
    const operador = await db.usuario.create({
      data: {
        empresaId: fixture.empresaA.id,
        sucursalId: fixture.sucursalA1.id,
        nombre: "Operador A",
        nombreUsuario: `intoper-a-${fixture.usuarios.adminA.nombreUsuario}`,
        passwordHash: "test-hash",
        roles: { create: { rolId: rolOperador.id } },
      },
    });
    const ctxOperador: TenantCtx = {
      empresaId: fixture.empresaA.id,
      sucursalId: fixture.sucursalA1.id,
      usuarioId: operador.id,
      esAdmin: false,
    };

    const id = await crear(ctxA, { identificacionFiscal: RNC_OK });
    const auditBefore = await db.movimientoAuditoria.count({
      where: { entidad: "Cliente" },
    });

    // Exact body of actualizarClienteAction's withTenantTransaction block.
    const result = await withTenantTransaction(ctxOperador, async (tx) => {
      const gestion = await tieneRolPermitidoEnTx(
        tx, ctxOperador.usuarioId, ctxOperador.empresaId, ROLES_GESTION,
      );
      if (!gestion) return { ok: false as const, code: NO_AUTORIZADO };
      const payload = { id, version: 1, creditoHabilitado: true };
      if (llevaCamposDeCredito(payload)) {
        const admin = await tieneRolPermitidoEnTx(
          tx, ctxOperador.usuarioId, ctxOperador.empresaId, ROLES_ADMIN_ONLY,
        );
        if (!admin) return { ok: false as const, code: NO_AUTORIZADO };
      }
      const r = await actualizarCliente(tx, ctxOperador, payload);
      return r.ok ? { ok: true as const } : { ok: false as const, code: r.code };
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(NO_AUTORIZADO);

    const cliente = await db.cliente.findUnique({ where: { id } });
    expect(cliente?.creditoHabilitado).toBe(false); // untouched
    expect(cliente?.version).toBe(1);
    expect(await db.movimientoAuditoria.count({ where: { entidad: "Cliente" } })).toBe(
      auditBefore,
    );
  });

  it("(d) an Admin credit edit succeeds and audits with a small VARCHAR-safe payload", async () => {
    const db = getHarnessDb();
    const id = await crear(ctxA, { identificacionFiscal: RNC_OK });

    const r = await withTenantTransaction(ctxA, (tx) =>
      actualizarCliente(tx, ctxA, {
        id,
        version: 1,
        creditoHabilitado: true,
        limiteCredito: "1500.00",
        tipoCliente: "CREDITO",
      }),
    );
    expect(r.ok).toBe(true);

    const audit = await db.movimientoAuditoria.findFirst({
      where: { entidad: "Cliente", idEntidad: String(id), accion: "ACTUALIZAR" },
      orderBy: { id: "desc" },
    });
    expect(audit).not.toBeNull();
    // VARCHAR(255) safety: the stored payloads are short and never full-row JSON.
    expect((audit!.valorNuevo ?? "").length).toBeLessThanOrEqual(255);
    expect((audit!.valorAnterior ?? "").length).toBeLessThanOrEqual(255);
    const nuevos = JSON.parse(audit!.valorNuevo as string) as Record<string, unknown>;
    expect(Object.keys(nuevos).sort()).toEqual(
      ["creditoHabilitado", "limiteCredito", "tipoCliente"],
    );
  });

  it("(d) enabling credit against a NULL fiscal ID is a zero-write failure", async () => {
    const db = getHarnessDb();
    // A client with no fiscal ID (a plain minorista, not the reserved CF row).
    const id = await crear(ctxA, {
      identificacionFiscal: null,
      tipoCliente: "MINORISTA",
    });
    const auditBefore = await db.movimientoAuditoria.count({
      where: { entidad: "Cliente" },
    });

    const r = await withTenantTransaction(ctxA, (tx) =>
      actualizarCliente(tx, ctxA, { id, version: 1, creditoHabilitado: true }),
    );
    expect(r.ok === false && r.code).toBe("CREDITO_REQUIERE_FISCAL_IDENTIDAD");

    const cliente = await db.cliente.findUnique({ where: { id } });
    expect(cliente?.creditoHabilitado).toBe(false);
    expect(cliente?.version).toBe(1);
    expect(await db.movimientoAuditoria.count({ where: { entidad: "Cliente" } })).toBe(
      auditBefore,
    );
  });

  // ---------------------------------------------------------------------------
  // (e) Guarded deactivation vs a real Venta (R6)
  // ---------------------------------------------------------------------------
  it("(e) a CONFIRMADA sale blocks deactivation; a CANCELADA sale does not", async () => {
    const db = getHarnessDb();

    // Client referenced by a live (CONFIRMADA) sale → blocked, stays active.
    const idVivo = await crear(ctxA);
    await crearVenta({
      empresaId: ctxA.empresaId,
      sucursalId: ctxA.sucursalId,
      usuarioId: ctxA.usuarioId,
      clienteId: idVivo,
      estado: "CONFIRMADA",
    });
    const bloqueado = await withTenantTransaction(ctxA, (tx) =>
      desactivarCliente(tx, ctxA, { id: idVivo }),
    );
    expect(bloqueado.ok === false && bloqueado.code).toBe("CLIENTE_TIENE_VENTAS");
    expect((await db.cliente.findUnique({ where: { id: idVivo } }))?.activo).toBe(
      true,
    );

    // Client referenced ONLY by a cancelled sale → deactivation allowed.
    const idOk = await crear(ctxA, { identificacionFiscal: null, tipoCliente: "MINORISTA" });
    await crearVenta({
      empresaId: ctxA.empresaId,
      sucursalId: ctxA.sucursalId,
      usuarioId: ctxA.usuarioId,
      clienteId: idOk,
      estado: "CANCELADA",
    });
    const permitido = await withTenantTransaction(ctxA, (tx) =>
      desactivarCliente(tx, ctxA, { id: idOk }),
    );
    expect(permitido.ok).toBe(true);
    expect((await db.cliente.findUnique({ where: { id: idOk } }))?.activo).toBe(
      false,
    );
  });

  it("(e) a Consumidor Final cannot be deactivated through operator CRUD", async () => {
    const db = getHarnessDb();
    await seedConsumidorFinalParaEmpresa(db, fixture.empresaA.id);
    const cf = await db.cliente.findFirst({
      where: { empresaId: fixture.empresaA.id, esConsumidorFinal: true },
    });

    const r = await withTenantTransaction(ctxA, (tx) =>
      desactivarCliente(tx, ctxA, { id: cf!.id }),
    );
    expect(r.ok === false && r.code).toBe("CLIENTE_CONSUMIDOR_FINAL_PROTEGIDO");
    expect((await db.cliente.findUnique({ where: { id: cf!.id } }))?.activo).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // (f) Active-only partial unique releases a fiscal ID after deactivation.
  //     This is the runtime resolution of the schema.prisma `@@unique` drift:
  //     Prisma's model still declares a FULL `@@unique([empresaId,
  //     identificacionFiscal])` (schema.prisma cannot express a partial
  //     `WHERE activo=true` predicate), but the DATABASE enforces the partial
  //     index `CLIENTE_empresaId_identificacionFiscal_key ... WHERE (activo =
  //     true)`. Prisma does not enforce `@@unique` client-side, so the partial
  //     index is authoritative and reuse-after-deactivate succeeds. We do NOT
  //     silently rewrite schema.prisma nor change the DB (both frozen by spec):
  //     this test is the executable proof that the effective behaviour is the
  //     active-only constraint.
  // ---------------------------------------------------------------------------
  it("(f) deactivating a client frees its fiscal ID for a new active client", async () => {
    const id1 = await crear(ctxA, { identificacionFiscal: RNC_OK });
    const deact = await withTenantTransaction(ctxA, (tx) =>
      desactivarCliente(tx, ctxA, { id: id1 }),
    );
    expect(deact.ok).toBe(true);

    // Reusing the same fiscal ID now succeeds (the old row is inactive).
    const id2 = await crear(ctxA, { identificacionFiscal: RNC_OK });
    expect(id2).not.toBe(id1);

    const db = getHarnessDb();
    const rows = await db.cliente.findMany({
      where: { empresaId: fixture.empresaA.id, identificacionFiscal: RNC_OK },
      orderBy: { id: "asc" },
    });
    expect(rows).toHaveLength(2);
    expect(rows[0].activo).toBe(false); // the retired holder
    expect(rows[1].activo).toBe(true); // the new active holder
  });

  // ---------------------------------------------------------------------------
  // (g) Rollback leaves neither the client nor its audit
  // ---------------------------------------------------------------------------
  it("(g) a mid-transaction rollback persists no client row and no audit", async () => {
    const db = getHarnessDb();
    await expect(
      withTenantTransaction(ctxA, async (tx) => {
        const r = await crearCliente(tx, ctxA, {
          nombre: "Rolled back",
          telefono: "1",
          direccion: "1",
          identificacionFiscal: RNC_OK,
          tipoCliente: "MAYORISTA",
        });
        if (!r.ok) throw new Error(`unexpected: ${r.code}`);
        // Force a rollback AFTER a successful, audited create.
        throw new Error("boom — deliberate rollback");
      }),
    ).rejects.toThrow("boom");

    expect(await db.cliente.count({ where: { empresaId: ctxA.empresaId } })).toBe(0);
    expect(await db.movimientoAuditoria.count({ where: { entidad: "Cliente" } })).toBe(0);
  });
});
