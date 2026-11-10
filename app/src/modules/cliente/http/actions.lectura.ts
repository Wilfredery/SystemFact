"use server";

import { createClient } from "@/lib/supabase/client";
import { withTenantTransaction } from "@/modules/tenant/infrastructure/withTenantTransaction";
import { getCurrentTenantContext } from "@/modules/tenant/infrastructure/tenant-runtime";
import { obtenerCliente } from "../application/obtener-cliente";
import { listarClientes } from "../application/listar-clientes";
import { tieneRolPermitidoEnTx } from "../infrastructure/cliente-repository";
import {
  zObtenerClienteInput,
  zListarClientesQuery,
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
  ROLES_GESTION_CREDITO,
  ROLES_VER_CLIENTES,
} from "./shared";

// Reads are a view capability: the Clientes list (plan Step 3, S3/L9) is open to
// Administrador, Operador and Despachador through the named view group — they
// sell to and collect from clients. The manage group only decides the write
// actions and the screen's manage controls.

export async function obtenerClienteAction(
  input: unknown,
): Promise<ActionResult<ClienteDto>> {
  const parsed = zObtenerClienteInput.safeParse(input);
  if (!parsed.success) return error(VALIDATION_ERROR, messageFor(VALIDATION_ERROR));

  const supabase = await createClient();
  const ctx = await getCurrentTenantContext(supabase);
  if (ctx === null) return error(SESION_INVALIDA, "Sesión no válida");

  return withTenantTransaction(ctx, async (tx) => {
    const permitido = await tieneRolPermitidoEnTx(
      tx,
      ctx.usuarioId,
      ctx.empresaId,
      ROLES_VER_CLIENTES,
    );
    if (!permitido) {
      return error(NO_AUTORIZADO, "No tiene permisos para ver clientes");
    }

    const result = await obtenerCliente(tx, ctx, parsed.data);
    if (!result.ok) return error(result.code, result.message);
    return ok(toDto(result.data));
  });
}

export async function listarClientesAction(
  query: unknown,
): Promise<
  ActionResult<{ items: ClienteDto[]; total: number; page: number; limit: number }>
> {
  const parsed = zListarClientesQuery.safeParse(query);
  if (!parsed.success) return error(VALIDATION_ERROR, messageFor(VALIDATION_ERROR));

  const supabase = await createClient();
  const ctx = await getCurrentTenantContext(supabase);
  if (ctx === null) return error(SESION_INVALIDA, "Sesión no válida");

  return withTenantTransaction(ctx, async (tx) => {
    const permitido = await tieneRolPermitidoEnTx(
      tx,
      ctx.usuarioId,
      ctx.empresaId,
      ROLES_VER_CLIENTES,
    );
    if (!permitido) {
      return error(NO_AUTORIZADO, "No tiene permisos para listar clientes");
    }

    const result = await listarClientes(tx, ctx, parsed.data);
    if (!result.ok) return error(result.code, result.message);
    return ok({
      items: result.data.items.map(toDto),
      total: result.data.total,
      page: result.data.page,
      limit: result.data.limit,
    });
  });
}

/**
 * Whether the caller may create, edit and deactivate clients, and whether the
 * credit fields are visible to them, answered from the named role groups so the
 * screen never names a role. It is only a UI question (show or hide the manage
 * controls and the credit columns); each write action re-checks on the server,
 * and the credit gate is re-checked there too.
 */
export async function obtenerPermisosClienteAction(): Promise<
  ActionResult<{ puedeGestionar: boolean; puedeVerCredito: boolean }>
> {
  const supabase = await createClient();
  const ctx = await getCurrentTenantContext(supabase);
  if (ctx === null) {
    return error(SESION_INVALIDA, messageFor(SESION_INVALIDA));
  }

  return withTenantTransaction(ctx, async (tx) => {
    // Sequential on purpose: both queries run on the same transaction client.
    const puedeGestionar = await tieneRolPermitidoEnTx(
      tx,
      ctx.usuarioId,
      ctx.empresaId,
      ROLES_GESTION_CLIENTES,
    );
    const puedeVerCredito = await tieneRolPermitidoEnTx(
      tx,
      ctx.usuarioId,
      ctx.empresaId,
      ROLES_GESTION_CREDITO,
    );
    return ok({ puedeGestionar, puedeVerCredito });
  });
}
