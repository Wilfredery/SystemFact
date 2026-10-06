"use server";

import { withTenantTransaction } from "@/modules/tenant/infrastructure/withTenantTransaction";
import { crearCompra } from "../application/crear-compra";
import { actualizarCompra } from "../application/actualizar-compra";
import { confirmarCompra } from "../application/confirmar-compra";
import { cancelarCompra } from "../application/cancelar-compra";
import { recibirCompra } from "../application/recibir-compra";
import { tieneRolPermitidoEnTx } from "../infrastructure/compra-repository";
import {
  zCrearCompraInput,
  zActualizarCompraInput,
  zConfirmarCompraInput,
  zCancelarCompraInput,
  zRecibirCompraInput,
} from "./validations";
import {
  NO_AUTORIZADO,
  SESION_INVALIDA,
  VALIDATION_ERROR,
  messageFor,
  CompraDomainError,
} from "../domain/errors";
import {
  type ActionResult,
  ok,
  error,
  resolverCtx,
  ROLES_ADMIN_ONLY,
} from "./shared";

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