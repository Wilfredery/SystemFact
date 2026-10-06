"use server";

import { withTenantTransaction } from "@/modules/tenant/infrastructure/withTenantTransaction";
import { listarVentas, obtenerVenta } from "../application/venta-service";
import { tieneRolPermitidoEnTx } from "../infrastructure/venta-repository";
import type { VentaDetalle } from "../infrastructure/venta-repository";
import {
  zListarVentasQuery,
  zObtenerVentaInput,
  NO_AUTORIZADO,
  SESION_INVALIDA,
  VALIDATION_ERROR,
  mensajeTransporte,
} from "./validations";
import { type ActionResult, ok, fail, resolverCtx, ROLES_VENTA } from "./shared";

/**
 * Venta Server Actions — thin HTTP adapters (R-V8, R-V11, R-V12).
 *
 * Each action is the SAME three steps and NOTHING more (zero business logic):
 *   1. zod-parse the payload → stable `VALIDATION_ERROR` on a bad shape;
 *   2. resolve the tenant context from the Supabase session (an AUTH read, not
 *      tenant-DB access, so it precedes the wrapper — Producto/Compra convention);
 *   3. inside `withTenantTransaction`: enforce the coarse role
 *      (`Administrador` + `Operador` for sale CRUD), then delegate to the use
 *      case and map its typed result (or `warnings`) into the action envelope.
 *
 * The ADMIN-ONLY discount (R-V8) is enforced SERVER-SIDE inside the shared save
 * pipeline (`prepararLineasVenta` → `DESCUENTO_NO_AUTORIZADO`), NOT as a separate
 * discount endpoint: a parallel verb would duplicate the cap/config logic and risk
 * divergent enforcement. The single enforcement point is authoritative; UI hiding
 * is never the control. Zod is never authoritative for roles either.
 *
 * Every DB access here sits inside `withTenantTransaction`, satisfying the
 * project-local ESLint rule `systemfact/server-action-must-wrap-tenant`.
 */

export async function listarVentasAction(
  query: unknown,
): Promise<
  ActionResult<{
    items: {
      id: number;
      fecha: string;
      estado: string;
      total: string;
      descuento: string;
      clienteNombre: string;
      usuarioNombre: string;
      ncf: string | null;
    }[];
    total: number;
    page: number;
    limit: number;
  }>
> {
  const parsed = zListarVentasQuery.safeParse(query);
  if (!parsed.success) return fail(VALIDATION_ERROR, mensajeTransporte(VALIDATION_ERROR));

  const ctx = await resolverCtx();
  if (ctx === null) return fail(SESION_INVALIDA, mensajeTransporte(SESION_INVALIDA));

  return withTenantTransaction(ctx, async (tx) => {
    const permitido = await tieneRolPermitidoEnTx(tx, ctx.usuarioId, ctx.empresaId, ROLES_VENTA);
    if (!permitido) {
      return fail(NO_AUTORIZADO, "No tiene permisos para listar ventas");
    }
    const result = await listarVentas(tx, ctx, parsed.data);
    if (!result.ok) return fail(result.code, result.message);
    return ok({
      items: result.data.items.map((v) => ({
        id: v.id,
        fecha: v.fecha.toISOString(),
        estado: v.estado,
        total: v.total,
        descuento: v.descuento,
        clienteNombre: v.clienteNombre,
        usuarioNombre: v.usuarioNombre,
        ncf: v.ncf,
      })),
      total: result.data.total,
      page: result.data.page,
      limit: result.data.limit,
    });
  });
}

/** The DTO shape handed to the client: Prisma/Decimal never cross the boundary. */
type VentaDetalleDto = {
  id: number;
  clienteId: number;
  clienteNombre: string;
  fecha: string;
  estado: string;
  subtotal: string;
  descuento: string;
  descuentoTipo: string;
  descuentoAutorizadoPor: number | null;
  itbis: string;
  total: string;
  lineas: {
    productoId: number;
    productoNombre: string;
    cantidad: string;
    precioUnitario: string;
    tasaItbis: string;
    descuentoLinea: string;
    descuentoTipo: string;
    itbisLinea: string;
    subtotalLinea: string;
  }[];
};

function toDetalleDto(d: VentaDetalle): VentaDetalleDto {
  return {
    id: d.id,
    clienteId: d.clienteId,
    clienteNombre: d.clienteNombre,
    fecha: d.fecha.toISOString(),
    estado: d.estado,
    subtotal: d.subtotal,
    descuento: d.descuento,
    descuentoTipo: d.descuentoTipo,
    descuentoAutorizadoPor: d.descuentoAutorizadoPor,
    itbis: d.itbis,
    total: d.total,
    lineas: d.lineas.map((l) => ({
      productoId: l.productoId,
      productoNombre: l.productoNombre,
      cantidad: l.cantidad,
      precioUnitario: l.precioUnitario,
      tasaItbis: l.tasaItbis,
      descuentoLinea: l.descuentoLinea,
      descuentoTipo: l.descuentoTipo,
      itbisLinea: l.itbisLinea,
      subtotalLinea: l.subtotalLinea,
    })),
  };
}

export async function obtenerVentaAction(
  input: unknown,
): Promise<ActionResult<VentaDetalleDto>> {
  const parsed = zObtenerVentaInput.safeParse(input);
  if (!parsed.success) return fail(VALIDATION_ERROR, mensajeTransporte(VALIDATION_ERROR));

  const ctx = await resolverCtx();
  if (ctx === null) return fail(SESION_INVALIDA, mensajeTransporte(SESION_INVALIDA));

  return withTenantTransaction(ctx, async (tx) => {
    const permitido = await tieneRolPermitidoEnTx(tx, ctx.usuarioId, ctx.empresaId, ROLES_VENTA);
    if (!permitido) {
      return fail(NO_AUTORIZADO, "No tiene permisos para ver ventas");
    }
    const result = await obtenerVenta(tx, ctx, parsed.data);
    if (!result.ok) return fail(result.code, result.message);
    return ok(toDetalleDto(result.data));
  });
}
