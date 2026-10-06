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
} from "./shared";

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
      ROLES_GESTION_CLIENTES,
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
  ActionResult<{ items: ClienteDto[]; total: number; page: number }>
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
      ROLES_GESTION_CLIENTES,
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
    });
  });
}
