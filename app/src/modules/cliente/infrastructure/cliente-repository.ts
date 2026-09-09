import {
  Prisma,
  AccionAuditoria,
  EstadoVenta,
} from "@/generated/prisma/client";
import { Decimal } from "decimal.js";
import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import type { Cliente, TipoCliente } from "../domain/cliente";
import {
  CLIENTE_IDENTIFICACION_DUPLICADA,
  ClienteDomainError,
} from "../domain/errors";

/**
 * Tenant-filtered Prisma repository for Cliente — a faithful port of the
 * proveedor repository (ADR-013: Prisma lives only here). Every operation is
 * scoped by `empresaId`; updates are optimistic-locked on `version`; the DB
 * partial unique on `(empresaId, identificacionFiscal WHERE activo=true)` is the
 * real duplicate guard and its P2002 maps to the stable duplicate code. Money
 * (limiteCredito) crosses as a `Decimal(12,2)`-compatible string on write and a
 * `decimal.js` Decimal on read — never a float.
 */

export interface ListarClientesQuery {
  readonly page: number;
  readonly limit: number;
  readonly buscar?: string;
  readonly incluirInactivos?: boolean;
  /**
   * Regular operator CRUD hides the per-empresa Consumidor Final row. Default
   * false (exclude); only internal provisioning reads set it true. This is the
   * repository-level expression of "CF rows excluded from write/read paths".
   */
  readonly incluirConsumidorFinal?: boolean;
}

export interface CrearClienteData {
  readonly nombre: string;
  readonly telefono: string;
  readonly direccion: string;
  readonly identificacionFiscal: string | null;
  readonly tipoCliente: TipoCliente;
  readonly esConsumidorFinal: boolean;
  readonly creditoHabilitado: boolean;
  /** `Decimal(12,2)`-compatible string; NEVER a float. */
  readonly limiteCredito: string;
  readonly plazoCreditoDias: number;
}

// Mutable, all-optional projection of CrearClienteData for optimistic patches.
export type ActualizarClientePatch = {
  -readonly [K in keyof CrearClienteData]?: CrearClienteData[K];
};

const clienteSelect = {
  id: true,
  empresaId: true,
  nombre: true,
  telefono: true,
  direccion: true,
  identificacionFiscal: true,
  tipoCliente: true,
  esConsumidorFinal: true,
  creditoHabilitado: true,
  limiteCredito: true,
  plazoCreditoDias: true,
  activo: true,
  version: true,
} satisfies Prisma.ClienteSelect;

type ClienteRow = Prisma.ClienteGetPayload<{ select: typeof clienteSelect }>;

function toDominioCliente(row: ClienteRow): Cliente {
  return {
    id: row.id,
    empresaId: row.empresaId,
    nombre: row.nombre,
    telefono: row.telefono,
    direccion: row.direccion,
    identificacionFiscal: row.identificacionFiscal,
    tipoCliente: row.tipoCliente,
    esConsumidorFinal: row.esConsumidorFinal,
    creditoHabilitado: row.creditoHabilitado,
    // Prisma hands back a Decimal; String()-normalize then a decimal.js Decimal
    // so the pure domain never sees a raw driver type and never a float.
    limiteCredito: new Decimal(String(row.limiteCredito)),
    plazoCreditoDias: row.plazoCreditoDias,
    activo: row.activo,
    version: row.version,
  };
}

/**
 * Shared list/count filter builder: always tenant-scoped. Active-only by default
 * and Consumidor-Final-excluded by default (operator CRUD). `buscar` matches the
 * name or the digits-only fiscal ID, mirroring the proveedor precedent so a
 * separator-typed term like `131-0456` still finds the stored `131045677`.
 */
function buildWhere(
  ctx: TenantCtx,
  query: ListarClientesQuery,
): Prisma.ClienteWhereInput {
  const where: Prisma.ClienteWhereInput = { empresaId: ctx.empresaId };
  if (!query.incluirInactivos) where.activo = true;
  if (!query.incluirConsumidorFinal) where.esConsumidorFinal = false;
  if (query.buscar) {
    const or: Prisma.ClienteWhereInput[] = [
      { nombre: { contains: query.buscar, mode: "insensitive" } },
    ];
    const fiscalDigits = query.buscar.replace(/[\s.-]/g, "");
    if (/^\d+$/.test(fiscalDigits)) {
      or.push({ identificacionFiscal: { contains: fiscalDigits } });
    }
    where.OR = or;
  }
  return where;
}

/**
 * Tenant-scoped single-client fetch. A foreign-tenant id is indistinguishable
 * from a missing one (no existence leakage, R1). It intentionally returns the
 * Consumidor Final row too, so the use case can detect and PROTECT it rather
 * than silently treating it as absent.
 */
export async function clienteByIdEnEmpresa(
  tx: PrismaTx,
  empresaId: number,
  id: number,
): Promise<Cliente | null> {
  const row = await tx.cliente.findFirst({
    where: { id, empresaId },
    select: clienteSelect,
  });
  return row === null ? null : toDominioCliente(row);
}

/**
 * Duplicate fiscal-ID probe over ACTIVE, non-CF rows only (mirrors the partial
 * unique). Null fiscal IDs are legitimately repeatable (multiple CF /
 * unverified rows), so the probe is skipped for null; on edit the row itself is
 * excluded.
 */
export async function existeIdentificacionFiscalEnEmpresa(
  tx: PrismaTx,
  empresaId: number,
  identificacionFiscal: string | null,
  excludeClienteId?: number,
): Promise<boolean> {
  if (identificacionFiscal === null) return false;
  const row = await tx.cliente.findFirst({
    where: {
      empresaId,
      identificacionFiscal,
      activo: true,
      ...(excludeClienteId !== undefined
        ? { id: { not: excludeClienteId } }
        : {}),
    },
    select: { id: true },
  });
  return row !== null;
}

/** The partial unique is the real TOCTOU guard; map its P2002 to the domain code. */
function esDuplicadoFiscal(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    err.code === "P2002"
  );
}

export async function crearClienteEnTx(
  tx: PrismaTx,
  ctx: TenantCtx,
  data: CrearClienteData,
): Promise<Cliente> {
  let row: ClienteRow;
  try {
    row = await tx.cliente.create({
      data: {
        empresaId: ctx.empresaId,
        nombre: data.nombre,
        telefono: data.telefono,
        direccion: data.direccion,
        identificacionFiscal: data.identificacionFiscal,
        tipoCliente: data.tipoCliente,
        esConsumidorFinal: data.esConsumidorFinal,
        creditoHabilitado: data.creditoHabilitado,
        limiteCredito: data.limiteCredito,
        plazoCreditoDias: data.plazoCreditoDias,
        activo: true,
      },
      select: clienteSelect,
    });
  } catch (err) {
    if (esDuplicadoFiscal(err)) {
      throw new ClienteDomainError(CLIENTE_IDENTIFICACION_DUPLICADA);
    }
    throw err;
  }
  return toDominioCliente(row);
}

/**
 * Optimistic-lock update: `UPDATE ... WHERE id AND empresaId AND version`. Zero
 * affected rows means a stale version → { updated: false } (mapped upstream to
 * CONCURRENCIA_CONFLICTO); on success `version` bumps atomically. A concurrent
 * write onto a taken fiscal ID maps its P2002 to the duplicate code.
 */
export async function actualizarClienteEnTx(
  tx: PrismaTx,
  empresaId: number,
  id: number,
  version: number,
  patch: ActualizarClientePatch,
): Promise<{ updated: boolean; newVersion: number }> {
  const newVersion = version + 1;
  try {
    const result = await tx.cliente.updateMany({
      where: { id, empresaId, version },
      data: { ...patch, version: newVersion },
    });
    if (result.count === 0) return { updated: false, newVersion: version };
    return { updated: true, newVersion };
  } catch (err) {
    if (esDuplicadoFiscal(err)) {
      throw new ClienteDomainError(CLIENTE_IDENTIFICACION_DUPLICADA);
    }
    throw err;
  }
}

/**
 * Soft deactivation: sets activo=false, never deletes. `activo: true` in the
 * WHERE makes it idempotent (a concurrent deactivate sees { deactivated:
 * false }); the partial unique releases the fiscal ID for reuse automatically.
 */
export async function desactivarClienteEnTx(
  tx: PrismaTx,
  empresaId: number,
  id: number,
): Promise<{ deactivated: boolean }> {
  const result = await tx.cliente.updateMany({
    where: { id, empresaId, activo: true },
    data: { activo: false },
  });
  return { deactivated: result.count > 0 };
}

export async function contarClientesEnEmpresa(
  tx: PrismaTx,
  ctx: TenantCtx,
  query: ListarClientesQuery,
): Promise<number> {
  return tx.cliente.count({ where: buildWhere(ctx, query) });
}

/**
 * Deterministically ordered, tenant-scoped, paginated listing (default filters
 * out inactive rows and the Consumidor Final). The caller passes an already
 * bounded `limit` (cap 100) and a 1-based `page`.
 */
export async function listarClientesEnEmpresa(
  tx: PrismaTx,
  ctx: TenantCtx,
  query: ListarClientesQuery,
): Promise<Cliente[]> {
  const rows = await tx.cliente.findMany({
    where: buildWhere(ctx, query),
    select: clienteSelect,
    orderBy: [{ nombre: "asc" }, { id: "asc" }],
    skip: (query.page - 1) * query.limit,
    take: query.limit,
  });
  return rows.map(toDominioCliente);
}

/**
 * Real deactivation guard (R6): soft-delete is an UPDATE so the FK never fires;
 * the business rule is "any Venta not CANCELADA still references this client".
 * `Venta`/`EstadoVenta` already exist in the schema, so this is a genuine probe,
 * not a stub. It counts 0 today (no sales until 5b) — forward-looking integrity.
 */
export async function tieneVentasNoCanceladas(
  tx: PrismaTx,
  empresaId: number,
  clienteId: number,
): Promise<boolean> {
  const activas = await tx.venta.count({
    where: {
      clienteId,
      empresaId,
      estado: { not: EstadoVenta.CANCELADA },
    },
  });
  return activas > 0;
}

/**
 * Role-based authorization lookup for the Server Actions (Phase 2). Prisma
 * access stays in infrastructure; only the boolean decision crosses into `http/`.
 * Tenant-scoped: user id + empresaId must both match. (Same helper shape as the
 * categoria/producto/proveedor modules; centralization deferred as a refactor.)
 */
export async function tieneRolPermitidoEnTx(
  tx: PrismaTx,
  usuarioId: number,
  empresaId: number,
  rolesPermitidos: readonly string[],
): Promise<boolean> {
  const usuario = await tx.usuario.findUnique({
    where: { id: usuarioId, empresaId },
    select: { roles: { select: { rol: { select: { nombre: true } } } } },
  });
  if (usuario === null) return false;
  return usuario.roles.some((r) => rolesPermitidos.includes(r.rol.nombre));
}

/**
 * Append-only audit row for a client mutation, run inside the same tenant
 * transaction so a rollback drops it with the write. Entity "Cliente" reuses the
 * frozen AccionAuditoria enum (CREAR / ACTUALIZAR / CANCELAR): no migration.
 */
export async function registrarAuditClienteEnTx(
  tx: PrismaTx,
  ctx: TenantCtx,
  accion: AccionAuditoria,
  clienteId: number,
  valoresAnteriores: Record<string, unknown> | null,
  valoresNuevos: Record<string, unknown> | null,
  motivo: string | null = null,
): Promise<void> {
  await tx.movimientoAuditoria.create({
    data: {
      empresaId: ctx.empresaId,
      sucursalId: ctx.sucursalId,
      usuarioId: ctx.usuarioId,
      fechaHora: new Date(),
      accion,
      entidad: "Cliente",
      idEntidad: String(clienteId),
      valorAnterior:
        valoresAnteriores === null ? null : JSON.stringify(valoresAnteriores),
      valorNuevo:
        valoresNuevos === null ? null : JSON.stringify(valoresNuevos),
      motivo,
    },
  });
}
