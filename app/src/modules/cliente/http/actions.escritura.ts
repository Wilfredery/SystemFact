"use server";

import { createClient } from "@/lib/supabase/client";
import { withTenantTransaction } from "@/modules/tenant/infrastructure/withTenantTransaction";
import { getCurrentTenantContext } from "@/modules/tenant/infrastructure/tenant-runtime";
import { crearCliente } from "../application/crear-cliente";
import {
  actualizarCliente,
  llevaCamposDeCredito,
} from "../application/actualizar-cliente";
import { desactivarCliente } from "../application/desactivar-cliente";
import { tieneRolPermitidoEnTx } from "../infrastructure/cliente-repository";
import {
  zCrearClienteInput,
  zActualizarClienteInput,
  zDesactivarClienteInput,
} from "./validation";
import {
  NO_AUTORIZADO,
  SESION_INVALIDA,
  VALIDATION_ERROR,
  messageFor,
} from "../domain/errors";
import {
  type ActionResult,
  type ClienteDto,
  ok,
  error,
  toDto,
  ROLES_GESTION_CLIENTES,
  ROLES_ADMIN_ONLY,
} from "./shared";

// The tenant context is resolved from the Supabase session (an auth read, not
// tenant-DB access) BEFORE withTenantTransaction can receive it, so the wrapper
// is not the literal first statement; all authorization and every Prisma call
// still run inside it (Producto/Proveedor convention).

export async function crearClienteAction(
  input: unknown,
): Promise<ActionResult<ClienteDto>> {
  const parsed = zCrearClienteInput.safeParse(input);
  if (!parsed.success) return error(VALIDATION_ERROR, messageFor(VALIDATION_ERROR));

  const supabase = await createClient();
  const ctx = await getCurrentTenantContext(supabase);
  if (ctx === null) return error(SESION_INVALIDA, "Sesión no válida");

  return withTenantTransaction(ctx, async (tx) => {
    const permitido = await tieneRolPermitidoEnTx(
      tx,
      ctx.usuarioId,
      ctx.empresaId,
      ROLES_GESTION_CLIENTES,
    );
    if (!permitido) {
      return error(NO_AUTORIZADO, "No tiene permisos para crear clientes");
    }

    const result = await crearCliente(tx, ctx, parsed.data);
    if (!result.ok) return error(result.code, result.message);
    return ok(toDto(result.data));
  });
}

/**
 * Optimistic-lock edit. Ordinary fields require Admin+Operador; if the patch
 * carries any credit-bearing field (`creditoHabilitado`, `limiteCredito`,
 * `plazoCreditoDias`, `tipoCliente`) the SAME command additionally requires
 * Administrador, checked server-side inside the transaction (design "Credit
 * authorization"). The CF/protection, credit-rule and stale-version decisions
 * live in the use case.
 */
export async function actualizarClienteAction(
  input: unknown,
): Promise<ActionResult<ClienteDto>> {
  const parsed = zActualizarClienteInput.safeParse(input);
  if (!parsed.success) return error(VALIDATION_ERROR, messageFor(VALIDATION_ERROR));

  const supabase = await createClient();
  const ctx = await getCurrentTenantContext(supabase);
  if (ctx === null) return error(SESION_INVALIDA, "Sesión no válida");

  return withTenantTransaction(ctx, async (tx) => {
    const permitido = await tieneRolPermitidoEnTx(
      tx,
      ctx.usuarioId,
      ctx.empresaId,
      ROLES_GESTION_CLIENTES,
    );
    if (!permitido) {
      return error(NO_AUTORIZADO, "No tiene permisos para editar clientes");
    }

    if (llevaCamposDeCredito(parsed.data)) {
      const admin = await tieneRolPermitidoEnTx(
        tx,
        ctx.usuarioId,
        ctx.empresaId,
        ROLES_ADMIN_ONLY,
      );
      if (!admin) {
        return error(
          NO_AUTORIZADO,
          "Solo un administrador puede editar crédito o clasificación",
        );
      }
    }

    const result = await actualizarCliente(tx, ctx, parsed.data);
    if (!result.ok) return error(result.code, result.message);
    return ok(toDto(result.data));
  });
}

/** Guarded soft deactivation. Administrador-only; CF-protection, ventas guard
 *  and idempotency are decided by the use case. */
export async function desactivarClienteAction(
  input: unknown,
): Promise<ActionResult<{ id: number }>> {
  const parsed = zDesactivarClienteInput.safeParse(input);
  if (!parsed.success) return error(VALIDATION_ERROR, messageFor(VALIDATION_ERROR));

  const supabase = await createClient();
  const ctx = await getCurrentTenantContext(supabase);
  if (ctx === null) return error(SESION_INVALIDA, "Sesión no válida");

  return withTenantTransaction(ctx, async (tx) => {
    const permitido = await tieneRolPermitidoEnTx(
      tx,
      ctx.usuarioId,
      ctx.empresaId,
      ROLES_ADMIN_ONLY,
    );
    if (!permitido) {
      return error(
        NO_AUTORIZADO,
        "Solo un administrador puede desactivar clientes",
      );
    }

    const result = await desactivarCliente(tx, ctx, parsed.data);
    if (!result.ok) return error(result.code, result.message);
    return ok({ id: result.data.id });
  });
}
