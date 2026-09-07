import {
  Prisma,
  AccionAuditoria,
  EstadoVenta,
  EstadoCompra,
} from "@/generated/prisma/client";
import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import type { Producto, TasaItbis } from "../domain/producto";
import { esTasaItbisValida } from "../domain/producto";
import {
  CODIGO_PRODUCTO_DUPLICADO,
  ProductoDomainError,
} from "../domain/errors";

export interface CrearProductoInput {
  readonly categoriaId: number;
  readonly codigo: string;
  readonly nombre: string;
  readonly descripcion?: string | null;
  readonly precioVenta: Prisma.Decimal;
  readonly itbisTasa: TasaItbis;
  readonly itbisVigenteDesde: Date;
  readonly itbisVigenteHasta: Date | null;
  readonly itbisAplicaRetencionITBIS: boolean;
}

export interface ListarProductosQuery {
  readonly page: number;
  readonly limit: number;
  readonly descripcion?: string;
  readonly incluirInactivos?: boolean;
}

const productoSelect = {
  id: true,
  empresaId: true,
  categoriaId: true,
  codigo: true,
  nombre: true,
  descripcion: true,
  precioVenta: true,
  tasaItbis: true,
  itbisVigenteDesde: true,
  itbisVigenteHasta: true,
  itbisAplicaRetencionITBIS: true,
  activo: true,
} satisfies Prisma.ProductoSelect;

type ProductoRow = Prisma.ProductoGetPayload<{
  select: typeof productoSelect;
}>;

function toDomainProducto(row: ProductoRow): Producto {
  const tasaString = new Prisma.Decimal(row.tasaItbis).toString();
  if (!esTasaItbisValida(tasaString)) {
    throw new Error(`Tasa ITBIS inválida en base de datos: ${tasaString}`);
  }
  return {
    id: row.id,
    empresaId: row.empresaId,
    categoriaId: row.categoriaId,
    codigo: row.codigo,
    nombre: row.nombre,
    descripcion: row.descripcion,
    precioVenta: row.precioVenta,
    itbis: {
      tasa: tasaString,
      vigenteDesde: row.itbisVigenteDesde,
      vigenteHasta: row.itbisVigenteHasta,
      aplicaRetencionITBIS: row.itbisAplicaRetencionITBIS,
    },
    exento: tasaString === "0",
    activo: row.activo,
  };
}

function buildWhere(
  ctx: TenantCtx,
  query: ListarProductosQuery,
): Prisma.ProductoWhereInput {
  const where: Prisma.ProductoWhereInput = {
    empresaId: ctx.empresaId,
  };
  if (!query.incluirInactivos) {
    where.activo = true;
  }
  if (query.descripcion !== undefined && query.descripcion.trim().length > 0) {
    const term = query.descripcion.trim();
    where.OR = [
      { nombre: { contains: term, mode: "insensitive" } },
      { descripcion: { contains: term, mode: "insensitive" } },
    ];
  }
  return where;
}

export async function existeCodigoEnEmpresa(
  tx: PrismaTx,
  empresaId: number,
  codigo: string,
  excludeProductoId?: number,
): Promise<boolean> {
  const row = await tx.producto.findFirst({
    where: {
      empresaId,
      codigo,
      // On edit, the product's own row must not count as a duplicate.
      ...(excludeProductoId !== undefined
        ? { id: { not: excludeProductoId } }
        : {}),
    },
    select: { id: true },
  });
  return row !== null;
}

export interface ProductoConVersion {
  readonly producto: Producto;
  readonly version: number;
}

/**
 * Tenant-filtered single-product fetch for the edit/deactivate flows.
 * Returns the domain entity plus the row `version` (the domain entity itself
 * deliberately omits it — optimistic locking is infrastructure metadata).
 */
export async function obtenerProductoPorId(
  tx: PrismaTx,
  empresaId: number,
  id: number,
): Promise<ProductoConVersion | null> {
  const row = await tx.producto.findFirst({
    where: { id, empresaId },
    select: { ...productoSelect, version: true },
  });
  if (row === null) return null;
  return { producto: toDomainProducto(row), version: row.version };
}

export interface ActualizarProductoData {
  nombre?: string;
  descripcion?: string | null;
  precioVenta?: Prisma.Decimal;
  tasaItbis?: TasaItbis;
  itbisVigenteDesde?: Date;
  itbisVigenteHasta?: Date | null;
  itbisAplicaRetencionITBIS?: boolean;
  codigo?: string;
  categoriaId?: number;
}

/**
 * Optimistic-lock partial update (REQ-PROD-011): `UPDATE ... WHERE id AND
 * empresaId AND version`. Zero affected rows means the caller's version is
 * stale → { updated: false }, mapped to CONCURRENCIA_CONFLICTO upstream.
 * `version` is incremented only by this statement, so concurrent writers
 * serialize on the row and at most one sees { updated: true }.
 */
export async function actualizarProductoEnTx(
  tx: PrismaTx,
  empresaId: number,
  id: number,
  version: number,
  data: ActualizarProductoData,
): Promise<{ updated: boolean; newVersion: number }> {
  const newVersion = version + 1;
  try {
    const result = await tx.producto.updateMany({
      where: { id, empresaId, version },
      data: {
        ...data,
        // Column stores the rate as Decimal; the domain keeps it as string.
        ...(data.tasaItbis !== undefined
          ? { tasaItbis: new Prisma.Decimal(data.tasaItbis) }
          : {}),
        version: newVersion,
      },
    });
    if (result.count === 0) return { updated: false, newVersion: version };
    return { updated: true, newVersion };
  } catch (err) {
    // Same TOCTOU guard as create: the partial unique (empresaId, codigo) is
    // the real constraint; map a concurrent duplicate code to the domain error.
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      const target = err.meta?.target;
      const targetsCodigo =
        Array.isArray(target)
          ? target.includes("codigo")
          : String(target ?? "").includes("codigo");
      if (targetsCodigo) {
        throw new ProductoDomainError(CODIGO_PRODUCTO_DUPLICADO);
      }
    }
    throw err;
  }
}

/**
 * Soft deactivation (REQ-PROD-012): sets activo=false, never deletes.
 * `activo: true` in the WHERE makes the write idempotent — a concurrent
 * deactivation sees { deactivated: false } instead of double-firing audit.
 * The partial unique on (empresaId, codigo) releases the code automatically.
 */
export async function desactivarProductoEnTx(
  tx: PrismaTx,
  empresaId: number,
  id: number,
): Promise<{ deactivated: boolean }> {
  const result = await tx.producto.updateMany({
    where: { id, empresaId, activo: true },
    data: { activo: false },
  });
  return { deactivated: result.count > 0 };
}

/**
 * Explicit active-reference guard for deactivation (REQ-PROD-012).
 * Soft-delete is an UPDATE, so FK `onDelete: Restrict` never fires; the
 * project rule for "active reference" is any sale line under a Venta that is
 * not CANCELADA, or any purchase line under a Compra that is not CANCELADA
 * (cancelled documents have no fiscal effect per the frozen state enums).
 * Both counts stay tenant-scoped through the parent document's empresaId.
 */
export async function tieneMovimientosActivos(
  tx: PrismaTx,
  empresaId: number,
  productoId: number,
): Promise<boolean> {
  const [ventas, compras] = await Promise.all([
    tx.detalleVenta.count({
      where: {
        productoId,
        venta: { empresaId, estado: { not: EstadoVenta.CANCELADA } },
      },
    }),
    tx.detalleCompra.count({
      where: {
        productoId,
        compra: { empresaId, estado: { not: EstadoCompra.CANCELADA } },
      },
    }),
  ]);
  return ventas > 0 || compras > 0;
}

/**
 * Role-based authorization lookup for a Server Action (REQ-PROD-007).
 *
 * Prisma access is isolated here (infrastructure) so the HTTP adapter never
 * touches the ORM directly: the action supplies the active transaction and the
 * allowed role names, and only the boolean decision crosses back into `http/`.
 * The role set comes from USUARIO_ROL → ROL; an unknown user is denied.
 *
 * The lookup is scoped to the tenant: both the usuario id and the empresaId
 * must match, so a cross-tenant id collision can never authorize a role
 * (USUARIO.empresaId is 1:1 — a user belongs to exactly one company).
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

export async function crearProductoEnTx(
  tx: PrismaTx,
  ctx: TenantCtx,
  input: CrearProductoInput,
): Promise<Producto> {
  let row: ProductoRow;
  try {
    row = await tx.producto.create({
      data: {
        empresaId: ctx.empresaId,
        categoriaId: input.categoriaId,
        codigo: input.codigo,
        nombre: input.nombre,
        descripcion: input.descripcion ?? null,
        codigoBarras: "",
        unidadMedida: "",
        unidadEmpaque: "",
        stockMinimo: 0,
        precioCompra: new Prisma.Decimal("0"),
        precioVenta: input.precioVenta,
        costoPromedio: new Prisma.Decimal("0"),
        tasaItbis: new Prisma.Decimal(input.itbisTasa),
        itbisVigenteDesde: input.itbisVigenteDesde,
        itbisVigenteHasta: input.itbisVigenteHasta,
        itbisAplicaRetencionITBIS: input.itbisAplicaRetencionITBIS,
        activo: true,
      },
      select: productoSelect,
    });
  } catch (err) {
    // Unique (empresaId, codigo) is the real guard against the check-then-insert
    // race; the pre-check in the application layer is only a fast path. Map the
    // constraint violation (P2002) to the domain duplicate-code error; any other
    // error is a defect and propagates untouched.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const target = err.meta?.target;
      const targetsCodigo =
        Array.isArray(target)
          ? target.includes("codigo")
          : String(target ?? "").includes("codigo");
      if (targetsCodigo) {
        throw new ProductoDomainError(CODIGO_PRODUCTO_DUPLICADO);
      }
    }
    throw err;
  }
  return toDomainProducto(row);
}

export async function contarProductos(
  tx: PrismaTx,
  ctx: TenantCtx,
  query: ListarProductosQuery,
): Promise<number> {
  return tx.producto.count({
    where: buildWhere(ctx, query),
  });
}

export async function listarProductosEnTx(
  tx: PrismaTx,
  ctx: TenantCtx,
  query: ListarProductosQuery,
): Promise<Producto[]> {
  const rows = await tx.producto.findMany({
    where: buildWhere(ctx, query),
    select: productoSelect,
    orderBy: { codigo: "asc" },
    skip: (query.page - 1) * query.limit,
    take: query.limit,
  });
  return rows.map(toDomainProducto);
}

/**
 * Append-only audit row for a created product (REQ-PROD-010).
 * Prisma access stays isolated in this infrastructure layer; the application
 * layer only orchestrates and calls this helper with the active transaction.
 */
export async function registrarProductoCreadoEnTx(
  tx: PrismaTx,
  ctx: TenantCtx,
  producto: Producto,
): Promise<void> {
  await tx.movimientoAuditoria.create({
    data: {
      empresaId: ctx.empresaId,
      sucursalId: ctx.sucursalId,
      usuarioId: ctx.usuarioId,
      fechaHora: new Date(),
      accion: AccionAuditoria.CREAR,
      entidad: "Producto",
      idEntidad: String(producto.id),
      valorAnterior: null,
      valorNuevo: JSON.stringify({
        codigo: producto.codigo,
        tasa: producto.itbis.tasa,
      }),
      motivo: null,
    },
  });
}

/**
 * Append-only audit row for a product edit (REQ-PROD-014, event
 * `producto.updated`). Only the changed fields travel in old/new JSON.
 * Called inside the same transaction as the mutation: a rolled-back edit
 * rolls this row back with it.
 */
export async function registrarProductoActualizadoEnTx(
  tx: PrismaTx,
  ctx: TenantCtx,
  productoId: number,
  valoresAnteriores: Record<string, unknown>,
  valoresNuevos: Record<string, unknown>,
): Promise<void> {
  await tx.movimientoAuditoria.create({
    data: {
      empresaId: ctx.empresaId,
      sucursalId: ctx.sucursalId,
      usuarioId: ctx.usuarioId,
      fechaHora: new Date(),
      accion: AccionAuditoria.ACTUALIZAR,
      entidad: "Producto",
      idEntidad: String(productoId),
      valorAnterior: JSON.stringify(valoresAnteriores),
      valorNuevo: JSON.stringify(valoresNuevos),
      motivo: null,
    },
  });
}

/**
 * Append-only audit row for a product soft-deactivation (REQ-PROD-014, event
 * `producto.deactivated`).
 *
 * DESIGN DEVIATION (documented in apply): tasks 1.7 named
 * `AccionAuditoria.ELIMINAR`, but the frozen DB enum has no such value and
 * adding one requires a migration, explicitly out of scope. `CANCELAR` is the
 * closest legal semantic (retire without destruction); the entity/ID payload
 * keeps the event distinguishable from a fiscal cancellation of a document.
 */
export async function registrarProductoDesactivadoEnTx(
  tx: PrismaTx,
  ctx: TenantCtx,
  productoId: number,
): Promise<void> {
  await tx.movimientoAuditoria.create({
    data: {
      empresaId: ctx.empresaId,
      sucursalId: ctx.sucursalId,
      usuarioId: ctx.usuarioId,
      fechaHora: new Date(),
      accion: AccionAuditoria.CANCELAR,
      entidad: "Producto",
      idEntidad: String(productoId),
      valorAnterior: JSON.stringify({ activo: true }),
      valorNuevo: JSON.stringify({ activo: false }),
      motivo: "producto.desactivado",
    },
  });
}

/**
 * Append-only audit row for a product listing read (REQ-PROD-010).
 */
export async function registrarProductoListadoEnTx(
  tx: PrismaTx,
  ctx: TenantCtx,
  page: number,
  count: number,
  total: number,
): Promise<void> {
  await tx.movimientoAuditoria.create({
    data: {
      empresaId: ctx.empresaId,
      sucursalId: ctx.sucursalId,
      usuarioId: ctx.usuarioId,
      fechaHora: new Date(),
      accion: AccionAuditoria.LEER,
      entidad: "Producto",
      idEntidad: String(page),
      valorAnterior: null,
      valorNuevo: JSON.stringify({ count, total }),
      motivo: null,
    },
  });
}
