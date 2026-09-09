"use server";

import { createClient } from "@/lib/supabase/client";
import { withTenantTransaction } from "@/modules/tenant/infrastructure/withTenantTransaction";
import { getCurrentTenantContext } from "@/modules/tenant/infrastructure/tenant-runtime";
import { crearCompra } from "../application/crear-compra";
import { actualizarCompra } from "../application/actualizar-compra";
import { confirmarCompra } from "../application/confirmar-compra";
import { cancelarCompra } from "../application/cancelar-compra";
import { recibirCompra } from "../application/recibir-compra";
import { listarCompras } from "../application/listar-compras";
import { obtenerCompra } from "../application/obtener-compra";
import { tieneRolPermitidoEnTx } from "../infrastructure/compra-repository";
import {
  zCrearCompraInput,
  zActualizarCompraInput,
  zConfirmarCompraInput,
  zCancelarCompraInput,
  zRecibirCompraInput,
  zListarComprasQuery,
  zObtenerCompraInput,
} from "./validations";
import {
  NO_AUTORIZADO,
  SESION_INVALIDA,
  VALIDATION_ERROR,
  messageFor,
  CompraDomainError,
  type CompraErrorCode,
} from "../domain/errors";

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: CompraErrorCode; message: string } };

// Compra-core is an operational/management capability reserved for the tenant
// Administrador (product decision 7 / role matrix 04). Server-side enforcement
// is the control — hiding UI buttons is not security.
const ROLES_ADMIN_ONLY = ["Administrador"];

function ok<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}

function error(code: CompraErrorCode, message: string): ActionResult<never> {
  return { ok: false, error: { code, message } };
}

async function resolverCtx() {
  const supabase = await createClient();
  return getCurrentTenantContext(supabase);
}

// Session/ctx resolution happens before withTenantTransaction (an auth read,
// not tenant-DB access); ALL role checks and Prisma access stay inside the wrap
// below (Producto/Proveedor convention, ESLint server-action-must-wrap-tenant).

export async function crearCompraAction(
  input: unknown,
): Promise<
  ActionResult<{ id: number; estado: string; correlativoInterno: string; total: string }>
> {
  const parsed = zCrearCompraInput.safeParse(input);
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
      ROLES_ADMIN_ONLY,
    );
    if (!permitido) {
      return error(NO_AUTORIZADO, "Solo un administrador puede crear compras");
    }
    const result = await crearCompra(tx, ctx, parsed.data);
    if (!result.ok) return error(result.code, result.message);
    return ok(result.data);
  });
}

export async function actualizarCompraAction(
  input: unknown,
): Promise<ActionResult<{ id: number; total: string }>> {
  const parsed = zActualizarCompraInput.safeParse(input);
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
      ROLES_ADMIN_ONLY,
    );
    if (!permitido) {
      return error(NO_AUTORIZADO, "Solo un administrador puede editar compras");
    }
    const result = await actualizarCompra(tx, ctx, parsed.data);
    if (!result.ok) return error(result.code, result.message);
    return ok(result.data);
  });
}

export async function confirmarCompraAction(
  input: unknown,
): Promise<
  ActionResult<{
    id: number;
    estado: string;
    correlativoInterno: string;
    total: string;
    retencionIsr: string;
    retencionItbis: string;
  }>
> {
  const parsed = zConfirmarCompraInput.safeParse(input);
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
      ROLES_ADMIN_ONLY,
    );
    if (!permitido) {
      return error(NO_AUTORIZADO, "Solo un administrador puede confirmar compras");
    }
    const result = await confirmarCompra(tx, ctx, parsed.data);
    if (!result.ok) return error(result.code, result.message);
    return ok(result.data);
  });
}

export async function cancelarCompraAction(
  input: unknown,
): Promise<ActionResult<{ id: number; estado: string }>> {
  const parsed = zCancelarCompraInput.safeParse(input);
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
      ROLES_ADMIN_ONLY,
    );
    if (!permitido) {
      return error(NO_AUTORIZADO, "Solo un administrador puede cancelar compras");
    }
    const result = await cancelarCompra(tx, ctx, parsed.data);
    if (!result.ok) return error(result.code, result.message);
    return ok(result.data);
  });
}

export async function recibirCompraAction(
  input: unknown,
): Promise<ActionResult<{ id: number; estado: string; movimientosAplicados: number }>> {
  const parsed = zRecibirCompraInput.safeParse(input);
  if (!parsed.success) {
    return error(VALIDATION_ERROR, messageFor(VALIDATION_ERROR));
  }
  const ctx = await resolverCtx();
  if (ctx === null) return error(SESION_INVALIDA, "Sesión no válida");

  try {
    return await withTenantTransaction(ctx, async (tx) => {
      const permitido = await tieneRolPermitidoEnTx(
        tx,
        ctx.usuarioId,
        ctx.empresaId,
        ROLES_ADMIN_ONLY,
      );
      if (!permitido) {
        return error(NO_AUTORIZADO, "Solo un administrador puede recibir compras");
      }
      const result = await recibirCompra(tx, ctx, parsed.data);
      if (!result.ok) return error(result.code, result.message);
      return ok(result.data);
    });
  } catch (err) {
    // An inventario entry rejection THROWS after the guarded estado flip so the
    // whole transaction rolls back; here it becomes a stable typed business
    // error (the bridge code never leaks inventario internals).
    if (err instanceof CompraDomainError) {
      return error(err.code, err.message);
    }
    throw err;
  }
}

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
      ROLES_ADMIN_ONLY,
    );
    if (!permitido) {
      return error(NO_AUTORIZADO, "Solo un administrador puede listar compras");
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
      ROLES_ADMIN_ONLY,
    );
    if (!permitido) {
      return error(NO_AUTORIZADO, "Solo un administrador puede ver compras");
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
