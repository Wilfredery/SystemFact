import {
  Prisma,
  AccionAuditoria,
  EstadoCompra,
} from "@/generated/prisma/client";
import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import type { Proveedor, TipoPersona, TipoProveedor } from "../domain/proveedor";
import {
  RNC_PROVEEDOR_DUPLICADO,
  ProveedorDomainError,
} from "../domain/errors";

export interface ListarProveedoresQuery {
  readonly page: number;
  readonly limit: number;
  readonly buscar?: string;
  readonly incluirInactivos?: boolean;
}

export interface CrearProveedorData {
  readonly nombre: string;
  readonly contacto: string;
  readonly telefono: string;
  readonly rnc: string | null;
  readonly tipoProveedor: TipoProveedor;
  readonly tipoPersona: TipoPersona;
}

const proveedorSelect = {
  id: true,
  empresaId: true,
  nombre: true,
  contacto: true,
  telefono: true,
  rnc: true,
  tipoProveedor: true,
  tipoPersona: true,
  activo: true,
  version: true,
} satisfies Prisma.ProveedorSelect;

type ProveedorRow = Prisma.ProveedorGetPayload<{
  select: typeof proveedorSelect;
}>;

function toDomainProveedor(row: ProveedorRow): Proveedor {
  return {
    id: row.id,
    empresaId: row.empresaId,
    nombre: row.nombre,
    contacto: row.contacto,
    telefono: row.telefono,
    rnc: row.rnc,
    tipoProveedor: row.tipoProveedor,
    tipoPersona: row.tipoPersona,
    activo: row.activo,
    version: row.version,
  };
}

function buildWhere(
  ctx: TenantCtx,
  query: ListarProveedoresQuery,
): Prisma.ProveedorWhereInput {
  const where: Prisma.ProveedorWhereInput = { empresaId: ctx.empresaId };
  // Active-only by default (PRV-LIST); inactivos appear only when explicitly asked.
  if (!query.incluirInactivos) {
    where.activo = true;
  }
  if (query.buscar) {
    // `buscar` matches the name or the digits-only RNC: the separator-stripped
    // term lets "1-3800" find the stored "138000001"; non-digit-only terms
    // still get the nombre arm of the OR.
    const rncDigits = query.buscar.replace(/[\s.-]/g, "");
    const or: Prisma.ProveedorWhereInput[] = [
      { nombre: { contains: query.buscar, mode: "insensitive" } },
    ];
    if (/^\d+$/.test(rncDigits)) {
      or.push({ rnc: { contains: rncDigits } });
    }
    where.OR = or;
  }
  return where;
}

/**
 * Tenant-filtered single-supplier fetch. A foreign-tenant id is
 * indistinguishable from a missing one: no cross-tenant disclosure (PRV-ISO).
 */
export async function proveedorByIdEnEmpresa(
  tx: PrismaTx,
  empresaId: number,
  id: number,
): Promise<Proveedor | null> {
  const row = await tx.proveedor.findFirst({
    where: { id, empresaId },
    select: proveedorSelect,
  });
  return row === null ? null : toDomainProveedor(row);
}

/**
 * Duplicate RNC probe over ACTIVE rows only (PRV-RNC): mirrors the partial
 * unique (empresaId, rnc WHERE activo=true). Null RNCs are legitimately
 * repeatable (informal suppliers), so the probe is skipped for null; on edit,
 * the row itself is excluded.
 */
export async function existeRncEnEmpresa(
  tx: PrismaTx,
  empresaId: number,
  rnc: string | null,
  excludeProveedorId?: number,
): Promise<boolean> {
  if (rnc === null) return false;
  const row = await tx.proveedor.findFirst({
    where: {
      empresaId,
      rnc,
      activo: true,
      ...(excludeProveedorId !== undefined
        ? { id: { not: excludeProveedorId } }
        : {}),
    },
    select: { id: true },
  });
  return row !== null;
}

/**
 * The partial unique (empresaId, rnc) is the real guard against the
 * application pre-check TOCTOU race; map its P2002 violation to the domain
 * duplicate-RNC error. Any other error is a defect and propagates untouched.
 */
function esDuplicadoRnc(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    err.code === "P2002"
  );
}

export async function crearProveedorEnTx(
  tx: PrismaTx,
  ctx: TenantCtx,
  data: CrearProveedorData,
): Promise<Proveedor> {
  let row: ProveedorRow;
  try {
    row = await tx.proveedor.create({
      data: {
        empresaId: ctx.empresaId,
        nombre: data.nombre,
        contacto: data.contacto,
        telefono: data.telefono,
        rnc: data.rnc,
        tipoProveedor: data.tipoProveedor,
        tipoPersona: data.tipoPersona,
        activo: true,
      },
      select: proveedorSelect,
    });
  } catch (err) {
    if (esDuplicadoRnc(err)) {
      throw new ProveedorDomainError(RNC_PROVEEDOR_DUPLICADO);
    }
    throw err;
  }
  return toDomainProveedor(row);
}

// Mutable, all-optional projection of CrearProveedorData: Partial<> keeps
// readonly modifiers, and the use case builds this patch field by field.
export type ActualizarProveedorPatch = {
  -readonly [K in keyof CrearProveedorData]?: CrearProveedorData[K];
};

/**
 * Optimistic-lock update (PRV-EDIT): `UPDATE ... WHERE id AND empresaId AND
 * version`. Zero affected rows means the caller's version is stale →
 * { updated: false }, mapped to CONCURRENCIA_CONFLICTO upstream. The patch
 * carries already-normalized values; the frozen enums prevent loose strings.
 */
export async function actualizarProveedorEnTx(
  tx: PrismaTx,
  empresaId: number,
  id: number,
  version: number,
  patch: ActualizarProveedorPatch,
): Promise<{ updated: boolean; newVersion: number }> {
  const newVersion = version + 1;
  try {
    const result = await tx.proveedor.updateMany({
      where: { id, empresaId, version },
      data: { ...patch, version: newVersion },
    });
    if (result.count === 0) return { updated: false, newVersion: version };
    return { updated: true, newVersion };
  } catch (err) {
    // Same TOCTOU mapping as create: concurrent edit onto a taken RNC.
    if (esDuplicadoRnc(err)) {
      throw new ProveedorDomainError(RNC_PROVEEDOR_DUPLICADO);
    }
    throw err;
  }
}

/**
 * Soft deactivation (PRV-DEACT): sets activo=false, never deletes.
 * `activo: true` in the WHERE makes the write idempotent — a concurrent
 * deactivation sees { deactivated: false } instead of double-firing audit.
 * The partial unique on (empresaId, rnc) releases the RNC automatically.
 */
export async function desactivarProveedorEnTx(
  tx: PrismaTx,
  empresaId: number,
  id: number,
): Promise<{ deactivated: boolean }> {
  const result = await tx.proveedor.updateMany({
    where: { id, empresaId, activo: true },
    data: { activo: false },
  });
  return { deactivated: result.count > 0 };
}

export async function contarProveedoresEnEmpresa(
  tx: PrismaTx,
  ctx: TenantCtx,
  query: ListarProveedoresQuery,
): Promise<number> {
  return tx.proveedor.count({ where: buildWhere(ctx, query) });
}

export async function listarProveedoresEnEmpresa(
  tx: PrismaTx,
  ctx: TenantCtx,
  query: ListarProveedoresQuery,
): Promise<Proveedor[]> {
  const rows = await tx.proveedor.findMany({
    where: buildWhere(ctx, query),
    select: proveedorSelect,
    orderBy: { nombre: "asc" },
    skip: (query.page - 1) * query.limit,
    take: query.limit,
  });
  return rows.map(toDomainProveedor);
}

/**
 * Explicit purchase-reference guard for deactivation (PRV-GUARD). Soft-delete
 * is an UPDATE, so FK Restrict never fires; the business rule is "any Compra
 * not in CANCELADA state still points here", checked in one tenant-scoped
 * count. Returns 0 rows today (fase 4 owns purchases) — the guard is
 * forward-looking integrity, not speculative feature.
 */
export async function tieneComprasNoCanceladas(
  tx: PrismaTx,
  empresaId: number,
  proveedorId: number,
): Promise<boolean> {
  const activas = await tx.compra.count({
    where: {
      proveedorId,
      empresaId,
      estado: { not: EstadoCompra.CANCELADA },
    },
  });
  return activas > 0;
}

/**
 * Role-based authorization lookup for supplier Server Actions (PRV-AUTH).
 * Prisma access stays in infrastructure; only the boolean decision crosses
 * back into `http/`. Scoped to the tenant: id + empresaId must both match.
 * Third copy of this ~15-line helper (categoria, producto, proveedor):
 * centralization was evaluated and deferred as a separate refactor (YAGNI).
 */
export async function tieneRolPermitidoEnTx(
  tx: PrismaTx,
  usuarioId: number,
  empresaId: number,
  rolesPermitidos: readonly string[],
): Promise<boolean> {
  const usuario = await tx.usuario.findUnique({
    where: { id: usuarioId, empresaId },
    select: {
      roles: { select: { rol: { select: { nombre: true } } } },
    },
  });
  if (usuario === null) return false;
  return usuario.roles.some((r) => rolesPermitidos.includes(r.rol.nombre));
}

/**
 * Append-only audit row for a supplier mutation (PRV-AUDIT). Runs inside the
 * same tenant transaction as the mutation, so a rolled-back write rolls the
 * event back with it. Entity "Proveedor" reuses the frozen AccionAuditoria
 * enum (CREAR / ACTUALIZAR / CANCELAR): no migration for new values.
 */
export async function registrarAuditProveedorEnTx(
  tx: PrismaTx,
  ctx: TenantCtx,
  accion: AccionAuditoria,
  proveedorId: number,
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
      entidad: "Proveedor",
      idEntidad: String(proveedorId),
      valorAnterior:
        valoresAnteriores === null ? null : JSON.stringify(valoresAnteriores),
      valorNuevo:
        valoresNuevos === null ? null : JSON.stringify(valoresNuevos),
      motivo,
    },
  });
}
