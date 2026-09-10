"use server";

import { createClient } from "@/lib/supabase/client";
import { withTenantTransaction } from "@/modules/tenant/infrastructure/withTenantTransaction";
import { getCurrentTenantContext } from "@/modules/tenant/infrastructure/tenant-runtime";
import { crearCliente } from "../application/crear-cliente";
import { obtenerCliente } from "../application/obtener-cliente";
import { listarClientes } from "../application/listar-clientes";
import {
  actualizarCliente,
  llevaCamposDeCredito,
} from "../application/actualizar-cliente";
import { desactivarCliente } from "../application/desactivar-cliente";
import { tieneRolPermitidoEnTx } from "../infrastructure/cliente-repository";
import type { Cliente } from "../domain/cliente";
import {
  zCrearClienteInput,
  zObtenerClienteInput,
  zListarClientesQuery,
  zActualizarClienteInput,
  zDesactivarClienteInput,
} from "./validation";
import {
  NO_AUTORIZADO,
  SESION_INVALIDA,
  VALIDATION_ERROR,
  messageFor,
  type ClienteErrorCode,
} from "../domain/errors";

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: ClienteErrorCode; message: string } };

// Regular client management (create/read/list/ordinary edit) is operational:
// Administrador + Operador per the role matrix.
const ROLES_GESTION_CLIENTES = ["Administrador", "Operador"];
// Credit fields, tipoCliente and deactivation are reserved for Administrador and
// enforced SERVER-SIDE inside the transaction — never by hiding UI controls.
const ROLES_ADMIN_ONLY = ["Administrador"];

function ok<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}

function error(code: ClienteErrorCode, message: string): ActionResult<never> {
  return { ok: false, error: { code, message } };
}

/**
 * Explicit read DTO — Prisma models and the raw `decimal.js` Decimal never
 * cross the HTTP boundary. Money serializes as a fixed-point STRING so a client
 * cannot round-trip it through a float. Credit fields are carried so 5b/5c/6
 * read them without re-plumbing (listing/detail projection requirement).
 */
type ClienteDto = {
  id: number;
  nombre: string;
  telefono: string;
  direccion: string;
  identificacionFiscal: string | null;
  tipoCliente: string;
  esConsumidorFinal: boolean;
  creditoHabilitado: boolean;
  limiteCredito: string;
  plazoCreditoDias: number;
  activo: boolean;
  version: number;
};

function toDto(c: Cliente): ClienteDto {
  return {
    id: c.id,
    nombre: c.nombre,
    telefono: c.telefono,
    direccion: c.direccion,
    identificacionFiscal: c.identificacionFiscal,
    tipoCliente: c.tipoCliente,
    esConsumidorFinal: c.esConsumidorFinal,
    creditoHabilitado: c.creditoHabilitado,
    limiteCredito: c.limiteCredito.toFixed(2),
    plazoCreditoDias: c.plazoCreditoDias,
    activo: c.activo,
    version: c.version,
  };
}

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
