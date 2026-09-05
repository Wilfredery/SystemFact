import { Prisma, AccionAuditoria } from "@/generated/prisma/client";
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
): Promise<boolean> {
  const row = await tx.producto.findFirst({
    where: { empresaId, codigo },
    select: { id: true },
  });
  return row !== null;
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

export async function categoriaPerteneceAEmpresa(
  tx: PrismaTx,
  empresaId: number,
  categoriaId: number,
): Promise<boolean> {
  const row = await tx.categoria.findUnique({
    where: { id: categoriaId },
    select: { empresaId: true },
  });
  return row !== null && row.empresaId === empresaId;
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
