/**
 * Integration — role gating + tenant isolation at the Cobros guard (R-C6, R-B1).
 *
 * The authorization gate lives INSIDE `withTenantTransaction` in the Server
 * Action layer (`cobros/http/actions.ts`): `tieneRolPermitidoEnTx` queries the
 * user's actual DB roles. A Supabase session cannot be forged in the node
 * harness, so — exactly as `compra-non-admin.integration.test.ts` does — this
 * test replicates the action's guard flow against the REAL database using the
 * SAME allow-lists, and proves an unauthorized actor is refused with
 * `PAGO_NO_AUTORIZADO` BEFORE any write or receipt burn, and that every read and
 * write is tenant-scoped under the RLS GUCs.
 */

import { Prisma } from "@/generated/prisma/client";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import { withTenantTransaction } from "@/modules/tenant/infrastructure/withTenantTransaction";
import { tieneRolPermitidoEnTx } from "@/modules/venta/infrastructure/venta-repository";
import {
  messageFor,
  PAGO_NO_AUTORIZADO,
  FACTURA_COBRO_NO_VIGENTE,
} from "@/modules/cobros/domain/errors";
import { registrarCobro } from "@/modules/cobros/application/registrar-cobro";
import { registrarReembolso } from "@/modules/cobros/application/registrar-reembolso";
import { consultarSaldoCxC } from "@/modules/cobros/application/consultar-saldo-cxc";
import { getHarnessDb, seedTenantFixture, type TenantFixture } from "./setup/fixtures";

// Same allow-lists as cobros/http/actions.ts (re-declared so the "use server"
// module is not imported into a plain node integration test).
const ROLES_COBROS = ["Administrador", "Operador"];
const ROLES_REEMBOLSO = ["Administrador"];

let fixture: TenantFixture | null = null;
let ctxAdminA: TenantCtx;
let ctxAdminB: TenantCtx;
let ctxDespachador: TenantCtx;
let ctxOperador: TenantCtx;
let facturaA: number;
let facturaB: number;

function ctxDe(
  f: TenantFixture,
  empresaId: number,
  sucursalId: number,
  usuarioId: number,
): TenantCtx {
  return { empresaId, sucursalId, usuarioId, esAdmin: true };
}

/** Create a role find-or-create (ROL.nombre is NOT unique) and a user in empresa A. */
async function crearUsuarioConRol(rolNombre: string, etiqueta: string): Promise<number> {
  const db = getHarnessDb();
  let rol = await db.rol.findFirst({ where: { nombre: rolNombre } });
  if (rol === null) {
    rol = await db.rol.create({
      data: { nombre: rolNombre, descripcion: `Cobros guard integration ${rolNombre}` },
    });
  }
  const u = await db.usuario.create({
    data: {
      empresaId: ctxAdminA.empresaId,
      sucursalId: ctxAdminA.sucursalId,
      nombre: etiqueta,
      nombreUsuario: `cob-${etiqueta}-${fixture!.usuarios.adminA.nombreUsuario}`,
      passwordHash: "test-hash",
      roles: { create: { rolId: rol.id } },
    },
    select: { id: true },
  });
  return u.id;
}

/** VIGENTE invoice for a tenant/branch (superuser seed, bypasses RLS). */
async function crearFactura(
  empresaId: number,
  sucursalId: number,
  usuarioId: number,
  ncf: string,
  total: string,
): Promise<number> {
  const db = getHarnessDb();
  const cliente = await db.cliente.create({
    data: {
      empresaId,
      nombre: `Cliente-${ncf}`,
      telefono: "0",
      direccion: "x",
      tipoCliente: "CREDITO",
      creditoHabilitado: true,
      limiteCredito: new Prisma.Decimal("20000.00"),
      plazoCreditoDias: 30,
    },
    select: { id: true },
  });
  const f = await db.factura.create({
    data: {
      empresaId,
      sucursalId,
      clienteId: cliente.id,
      usuarioId,
      tipoNcf: "B01",
      ncf,
      correlativoInterno: `FAC-${ncf}`,
      estado: "VIGENTE",
      subtotalGravado: new Prisma.Decimal(total),
      itbis: new Prisma.Decimal("0.00"),
      subtotalExento: new Prisma.Decimal("0.00"),
      descuento: new Prisma.Decimal("0.00"),
      total: new Prisma.Decimal(total),
      fechaEmision: new Date("2026-09-01T12:00:00.000Z"),
    },
    select: { id: true },
  });
  return f.id;
}

describe("cobros role gating + tenant isolation (real DB, RLS on; R-C6/R-B1)", () => {
  beforeEach(async () => {
    fixture = await seedTenantFixture();
    ctxAdminA = ctxDe(fixture, fixture.empresaA.id, fixture.sucursalA1.id, fixture.usuarios.adminA.id);
    ctxAdminB = ctxDe(fixture, fixture.empresaB.id, fixture.sucursalB1.id, fixture.usuarios.adminB.id);
    const despachadorId = await crearUsuarioConRol("Despachador", "DespachadorA");
    const operadorId = await crearUsuarioConRol("Operador", "OperadorA");
    ctxDespachador = { ...ctxAdminA, usuarioId: despachadorId, esAdmin: false };
    ctxOperador = { ...ctxAdminA, usuarioId: operadorId, esAdmin: false };

    facturaA = await crearFactura(ctxAdminA.empresaId, ctxAdminA.sucursalId, ctxAdminA.usuarioId, "B01000000030", "5000.00");
    facturaB = await crearFactura(ctxAdminB.empresaId, ctxAdminB.sucursalId, ctxAdminB.usuarioId, "B01000000031", "7000.00");
  });

  it("Despachador is denied Cobros with PAGO_NO_AUTORIZADO before any write", async () => {
    const db = getHarnessDb();
    const antes = await db.pago.count({ where: { empresaId: ctxAdminA.empresaId } });

    // Exact body of registrarCobroAction's withTenantTransaction block.
    const result = await withTenantTransaction(ctxDespachador, async (tx) => {
      const permitido = await tieneRolPermitidoEnTx(
        tx,
        ctxDespachador.usuarioId,
        ctxDespachador.empresaId,
        ROLES_COBROS,
      );
      if (!permitido) return { ok: false as const, error: { code: PAGO_NO_AUTORIZADO, message: messageFor(PAGO_NO_AUTORIZADO) } };
      const r = await registrarCobro(tx, ctxDespachador, { facturaId: facturaA, monto: "100.00" });
      return r.ok ? { ok: true as const, data: r.data } : { ok: false as const, error: { code: r.code, message: r.message } };
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe(PAGO_NO_AUTORIZADO);
    expect(await db.pago.count({ where: { empresaId: ctxAdminA.empresaId } })).toBe(antes);
  });

  it("unauthorized refund actor → PAGO_NO_AUTORIZADO, no row and no receipt burned", async () => {
    const db = getHarnessDb();
    const antes = await db.pago.count({ where: { empresaId: ctxAdminA.empresaId } });

    // registrarReembolsoAction gate: an Operador is allowed Cobros but NOT refunds.
    const result = await withTenantTransaction(ctxOperador, async (tx) => {
      const permitido = await tieneRolPermitidoEnTx(
        tx,
        ctxOperador.usuarioId,
        ctxOperador.empresaId,
        ROLES_REEMBOLSO,
      );
      if (!permitido) return { ok: false as const, error: { code: PAGO_NO_AUTORIZADO, message: messageFor(PAGO_NO_AUTORIZADO) } };
      const r = await registrarReembolso(tx, ctxOperador, { facturaId: facturaA, monto: "100.00", idempotencyKey: "K-UNAUTH" });
      return r.ok ? { ok: true as const, data: r.data } : { ok: false as const, error: { code: r.code, message: r.message } };
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe(PAGO_NO_AUTORIZADO);
    // Nothing written and no receipt number allocated (guard precedes the use case).
    expect(await db.pago.count({ where: { empresaId: ctxAdminA.empresaId } })).toBe(antes);
    expect(await db.pago.count({ where: { idempotencyKey: "K-UNAUTH" } })).toBe(0);
  });

  it("tenant-scoped under RLS: A cannot collect B's invoice and each view is its own company", async () => {
    const db = getHarnessDb();

    // (a) adminA collecting a foreign (empresa B) invoice is refused pre-write:
    //     the tenant-locked, VIGENTE-only lookup never surfaces B's row.
    const cobroB = await withTenantTransaction(ctxAdminA, (tx) =>
      registrarCobro(tx, ctxAdminA, { facturaId: facturaB, monto: "100.00" }),
    );
    expect(!cobroB.ok && cobroB.code).toBe(FACTURA_COBRO_NO_VIGENTE);
    expect(await db.pago.count({ where: { facturaId: facturaB } })).toBe(0);

    // (b) A valid collection commits in A, and the sole CxC read reflects it.
    const cobro = await withTenantTransaction(ctxAdminA, (tx) =>
      registrarCobro(tx, ctxAdminA, { facturaId: facturaA, monto: "1500.00" }),
    );
    expect(cobro.ok).toBe(true);
    const saldoA = await withTenantTransaction(ctxAdminA, (tx) =>
      consultarSaldoCxC(tx, ctxAdminA, {}),
    );
    expect(saldoA.ok).toBe(true);
    if (!saldoA.ok) throw new Error("la lectura de A debería tener éxito");
    // Empresa A sees ONLY its own receivable — never B's (RLS + explicit scope).
    expect(saldoA.data.map((f) => f.facturaId)).toEqual([facturaA]);
    expect(saldoA.data[0].saldoPendiente).toBe("3500.00");
    expect(saldoA.data[0].estadoPago).toBe("PARCIAL");

    // (c) The same read under empresa B sees only B's invoice.
    const saldoB = await withTenantTransaction(ctxAdminB, (tx) =>
      consultarSaldoCxC(tx, ctxAdminB, {}),
    );
    expect(saldoB.ok).toBe(true);
    if (!saldoB.ok) throw new Error("la lectura de B debería tener éxito");
    expect(saldoB.data.map((f) => f.facturaId)).toEqual([facturaB]);
  });
});
