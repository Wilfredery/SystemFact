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

"use server";

import { createClient } from "@/lib/supabase/client";
import { withTenantTransaction } from "@/modules/tenant/infrastructure/withTenantTransaction";
import { getCurrentTenantContext } from "@/modules/tenant/infrastructure/tenant-runtime";
import {
  crearVenta,
  actualizarVenta,
  cancelarVenta,
  listarVentas,
  obtenerVenta,
} from "../application/venta-service";
import { confirmarVenta } from "../application/confirmar-venta";
import { tieneRolPermitidoEnTx } from "../infrastructure/venta-repository";
import type { StockWarning, VentaErrorCode } from "../domain/errors";
import type { VentaGuardadoErrorCode } from "../application/venta-guardado";
import type { VentaDetalle } from "../infrastructure/venta-repository";
import {
  zCrearVentaInput,
  zActualizarVentaInput,
  zCancelarVentaInput,
  zConfirmarVentaInput,
  zListarVentasQuery,
  zObtenerVentaInput,
  NO_AUTORIZADO,
  SESION_INVALIDA,
  VALIDATION_ERROR,
  mensajeTransporte,
} from "./validations";

/** Sale CRUD is operational (Admin + Operador); the discount gate is per-payload. */
const ROLES_VENTA = ["Administrador", "Operador"];

/** Composed action error surface: domain ∪ config ∪ transport codes. */
export type VentaAccionesErrorCode =
  | VentaErrorCode
  | Extract<VentaGuardadoErrorCode, "DESC_MAX_FALTANTE">
  | typeof NO_AUTORIZADO
  | typeof SESION_INVALIDA
  | typeof VALIDATION_ERROR;

export type ActionResult<T> =
  | { readonly ok: true; readonly data: T; readonly warnings?: readonly StockWarning[] }
  | {
      readonly ok: false;
      readonly error: { readonly code: VentaAccionesErrorCode; readonly message: string };
    };

function ok<T>(data: T, warnings?: readonly StockWarning[]): ActionResult<T> {
  return warnings && warnings.length > 0 ? { ok: true, data, warnings } : { ok: true, data };
}

function fail(code: VentaAccionesErrorCode, message: string): ActionResult<never> {
  return { ok: false, error: { code, message } };
}

// The use case already resolves a stable user message for its composed code, so
// the adapter forwards `result.message` verbatim (no duplicate copy at the
// boundary — the single source of truth stays in the domain/config catalogs).
async function resolverCtx() {
  const supabase = await createClient();
  return getCurrentTenantContext(supabase);
}

export async function crearVentaAction(
  input: unknown,
): Promise<
  ActionResult<{
    id: number;
    estado: string;
    total: string;
    subtotalGravado: string;
    subtotalExento: string;
  }>
> {
  const parsed = zCrearVentaInput.safeParse(input);
  if (!parsed.success) return fail(VALIDATION_ERROR, mensajeTransporte(VALIDATION_ERROR));

  const ctx = await resolverCtx();
  if (ctx === null) return fail(SESION_INVALIDA, mensajeTransporte(SESION_INVALIDA));

  return withTenantTransaction(ctx, async (tx) => {
    const permitido = await tieneRolPermitidoEnTx(tx, ctx.usuarioId, ctx.empresaId, ROLES_VENTA);
    if (!permitido) {
      return fail(NO_AUTORIZADO, "No tiene permisos para registrar ventas");
    }
    const result = await crearVenta(tx, ctx, parsed.data);
    if (!result.ok) return fail(result.code, result.message);
    return ok(result.data, result.warnings);
  });
}

export async function actualizarVentaAction(
  input: unknown,
): Promise<ActionResult<{ id: number; total: string }>> {
  const parsed = zActualizarVentaInput.safeParse(input);
  if (!parsed.success) return fail(VALIDATION_ERROR, mensajeTransporte(VALIDATION_ERROR));

  const ctx = await resolverCtx();
  if (ctx === null) return fail(SESION_INVALIDA, mensajeTransporte(SESION_INVALIDA));

  return withTenantTransaction(ctx, async (tx) => {
    const permitido = await tieneRolPermitidoEnTx(tx, ctx.usuarioId, ctx.empresaId, ROLES_VENTA);
    if (!permitido) {
      return fail(NO_AUTORIZADO, "No tiene permisos para editar ventas");
    }
    const result = await actualizarVenta(tx, ctx, parsed.data);
    if (!result.ok) return fail(result.code, result.message);
    return ok(result.data, result.warnings);
  });
}

export async function cancelarVentaAction(
  input: unknown,
): Promise<ActionResult<{ id: number; estado: string }>> {
  const parsed = zCancelarVentaInput.safeParse(input);
  if (!parsed.success) return fail(VALIDATION_ERROR, mensajeTransporte(VALIDATION_ERROR));

  const ctx = await resolverCtx();
  if (ctx === null) return fail(SESION_INVALIDA, mensajeTransporte(SESION_INVALIDA));

  return withTenantTransaction(ctx, async (tx) => {
    const permitido = await tieneRolPermitidoEnTx(tx, ctx.usuarioId, ctx.empresaId, ROLES_VENTA);
    if (!permitido) {
      return fail(NO_AUTORIZADO, "No tiene permisos para cancelar ventas");
    }
    const result = await cancelarVenta(tx, ctx, parsed.data);
    if (!result.ok) return fail(result.code, result.message);
    return ok(result.data);
  });
}

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

/**
 * VENT-CONFIRM (R-V15): confirm a `BORRADOR` and emit its `VIGENTE` invoice
 * atomically. Same three-step adapter contract: zod → tenant ctx → tenant
 * transaction with the coarse role gate, then the use case owns the observable
 * order (emission gate → NCF eligibility → hard stock preview → NCF lock+consume
 * → guarded flip → invoice → stock exit). The NCF_UMBRAL_90 threshold surfaces
 * as `ncfWarning` directly on the payload — a banner, never a block.
 */
export async function confirmarVentaAction(
  input: unknown,
): Promise<
  ActionResult<{
    id: number;
    estado: string;
    facturaId: number;
    ncf: string;
    tipoNcf: string;
    correlativoInterno: string;
    total: string;
    ncfWarning: string | null;
  }>
> {
  const parsed = zConfirmarVentaInput.safeParse(input);
  if (!parsed.success) return fail(VALIDATION_ERROR, mensajeTransporte(VALIDATION_ERROR));

  const ctx = await resolverCtx();
  if (ctx === null) return fail(SESION_INVALIDA, mensajeTransporte(SESION_INVALIDA));

  return withTenantTransaction(ctx, async (tx) => {
    const permitido = await tieneRolPermitidoEnTx(tx, ctx.usuarioId, ctx.empresaId, ROLES_VENTA);
    if (!permitido) {
      return fail(NO_AUTORIZADO, "No tiene permisos para confirmar ventas");
    }
    const result = await confirmarVenta(tx, ctx, parsed.data);
    if (!result.ok) return fail(result.code, result.message);
    const { data } = result;
    return ok({
      id: data.id,
      estado: data.estado,
      facturaId: data.facturaId,
      ncf: data.ncf,
      tipoNcf: data.tipoNcf,
      correlativoInterno: data.correlativoInterno,
      total: data.total,
      ncfWarning:
        result.warnings !== undefined && result.warnings.length > 0
          ? result.warnings[0].code
          : null,
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
