"use server";

import { withTenantTransaction } from "@/modules/tenant/infrastructure/withTenantTransaction";
import { listarCompras } from "../application/listar-compras";
import { obtenerCompra } from "../application/obtener-compra";
import { tieneRolPermitidoEnTx } from "../infrastructure/compra-repository";
import {
  zListarComprasQuery,
  zObtenerCompraInput,
} from "./validations";
import {
  NO_AUTORIZADO,
  SESION_INVALIDA,
  VALIDATION_ERROR,
  messageFor,
} from "../domain/errors";
import {
  type ActionResult,
  ok,
  error,
  resolverCtx,
  ROLES_VER_COMPRAS,
  ROLES_GESTION_COMPRAS,
} from "./shared";

// Reads are a VIEW capability (screens plan Step 6, S3): the purchase list and
// detail are open to Administrador, Operador and Despachador through the named
// view group. The manage group only decides the write actions and the screen's
// manage controls.

export async function listarComprasAction(
  query: unknown,
): Promise<
  ActionResult<{
    items: {
      id: number;
      correlativoInterno: string;
      tipoCompra: string;
      estado: string;
      ncf: string | null;
      total: string;
      fecha: string;
      proveedorNombre: string;
    }[];
    total: number;
    page: number;
  }>
> {
  const parsed = zListarComprasQuery.safeParse(query);
  if (!parsed.success) {
    return error(VALIDATION_ERROR, messageFor(VALIDATION_ERROR));
  }
  const ctx = await resolverCtx();
  if (ctx === null) return error(SESION_INVALIDA, "Sesión no válida");

  return withTenantTransaction(ctx, async (tx) => {
    const permitido = await tieneRolPermitidoEnTx(
      tx,
      ctx.usuarioId,
      ctx.empresaId,
      ROLES_VER_COMPRAS,
    );
    if (!permitido) {
      return error(NO_AUTORIZADO, "No tiene permisos para listar compras");
    }
    const result = await listarCompras(tx, ctx, parsed.data);
    if (!result.ok) return error(result.code, result.message);
    return ok({
      items: result.data.items.map((c) => ({
        id: c.id,
        correlativoInterno: c.correlativoInterno,
        tipoCompra: c.tipoCompra,
        estado: c.estado,
        ncf: c.ncf,
        total: c.total,
        fecha: c.fecha.toISOString(),
        proveedorNombre: c.proveedorNombre,
      })),
      total: result.data.total,
      page: result.data.page,
    });
  });
}

export async function obtenerCompraAction(
  input: unknown,
): Promise<
  ActionResult<{
    id: number;
    correlativoInterno: string;
    tipoCompra: string;
    estado: string;
    ncf: string | null;
    tipoNcf: string | null;
    fecha: string;
    subtotal: string;
    subtotalGravado: string;
    subtotalExento: string;
    itbis: string;
    retencionIsr: string;
    retencionItbis: string;
    total: string;
    proveedor: { id: number; nombre: string };
    lineas: {
      productoId: number;
      productoNombre: string;
      cantidad: string;
      costoUnitario: string;
      tasaItbis: string;
      itbisLinea: string;
      subtotalLinea: string;
    }[];
  }>
> {
  const parsed = zObtenerCompraInput.safeParse(input);
  if (!parsed.success) {
    return error(VALIDATION_ERROR, messageFor(VALIDATION_ERROR));
  }
  const ctx = await resolverCtx();
  if (ctx === null) return error(SESION_INVALIDA, "Sesión no válida");

  return withTenantTransaction(ctx, async (tx) => {
    const permitido = await tieneRolPermitidoEnTx(
      tx,
      ctx.usuarioId,
      ctx.empresaId,
      ROLES_VER_COMPRAS,
    );
    if (!permitido) {
      return error(NO_AUTORIZADO, "No tiene permisos para ver compras");
    }
    const result = await obtenerCompra(tx, ctx, parsed.data);
    if (!result.ok) return error(result.code, result.message);
    return ok({
      id: result.data.id,
      correlativoInterno: result.data.correlativoInterno,
      tipoCompra: result.data.tipoCompra,
      estado: result.data.estado,
      ncf: result.data.ncf,
      tipoNcf: result.data.tipoNcf,
      fecha: result.data.fecha.toISOString(),
      subtotal: result.data.subtotal,
      subtotalGravado: result.data.subtotalGravado,
      subtotalExento: result.data.subtotalExento,
      itbis: result.data.itbis,
      retencionIsr: result.data.retencionIsr,
      retencionItbis: result.data.retencionItbis,
      total: result.data.total,
      proveedor: result.data.proveedor,
      lineas: result.data.lineas.map((l) => ({
        productoId: l.productoId,
        productoNombre: l.productoNombre,
        cantidad: l.cantidad,
        costoUnitario: l.costoUnitario,
        tasaItbis: l.tasaItbis,
        itbisLinea: l.itbisLinea,
        subtotalLinea: l.subtotalLinea,
      })),
    });
  });
}

/**
 * Whether the caller may create, edit, confirm, cancel and receive purchases,
 * answered from the named manage group so the screen never names a role. It is
 * only a UI question (show or hide the manage controls); each write action
 * re-checks on the server.
 */
export async function obtenerPermisosCompraAction(): Promise<
  ActionResult<{ puedeGestionar: boolean }>
> {
  const ctx = await resolverCtx();
  if (ctx === null) {
    return error(SESION_INVALIDA, messageFor(SESION_INVALIDA));
  }

  return withTenantTransaction(ctx, async (tx) => {
    const puedeGestionar = await tieneRolPermitidoEnTx(
      tx,
      ctx.usuarioId,
      ctx.empresaId,
      ROLES_GESTION_COMPRAS,
    );
    return ok({ puedeGestionar });
  });
}
