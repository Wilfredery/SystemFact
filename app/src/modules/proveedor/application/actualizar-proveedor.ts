import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import {
  PROVEEDOR_NO_ENCONTRADO,
  PROVEEDOR_YA_INACTIVO,
  RNC_PROVEEDOR_DUPLICADO,
  RNC_FORMATO_INVALIDO,
  CONCURRENCIA_CONFLICTO,
  VALIDATION_ERROR,
  messageFor,
  ProveedorDomainError,
  type ProveedorErrorCode,
} from "../domain/errors";
import {
  normalizeNombre,
  normalizeRnc,
  type Proveedor,
  type ProveedorResult,
  type TipoPersona,
  type TipoProveedor,
} from "../domain/proveedor";
import {
  proveedorByIdEnEmpresa,
  existeRncEnEmpresa,
  actualizarProveedorEnTx,
  registrarAuditProveedorEnTx,
  type ActualizarProveedorPatch,
} from "../infrastructure/proveedor-repository";

/**
 * PRV-EDIT partial-edit command. `id` + `version` identify the target row and
 * its expected state; every other field is an optional patch member. `rnc`
 * distinguishes "unchanged" (undefined) from "cleared to null" (explicit
 * null) — mirroring the product module's patch semantics.
 */
export interface ActualizarProveedorInput {
  readonly id: number;
  readonly version: number;
  readonly nombre?: string;
  readonly contacto?: string;
  readonly telefono?: string;
  readonly rnc?: string | null;
  readonly tipoProveedor?: TipoProveedor;
  readonly tipoPersona?: TipoPersona;
}

export type ActualizarProveedorResult = ProveedorResult<Proveedor>;

function buildError(
  code: ProveedorErrorCode,
): { ok: false; code: ProveedorErrorCode; message: string } {
  return { ok: false, code, message: messageFor(code) };
}

export async function actualizarProveedor(
  tx: PrismaTx,
  ctx: TenantCtx,
  input: ActualizarProveedorInput,
): Promise<ActualizarProveedorResult> {
  const patch: ActualizarProveedorPatch = {};
  const cambios: {
    anteriores: Record<string, unknown>;
    nuevos: Record<string, unknown>;
  } = { anteriores: {}, nuevos: {} };

  const provided = [
    "nombre",
    "contacto",
    "telefono",
    "rnc",
    "tipoProveedor",
    "tipoPersona",
  ] as const;
  if (!provided.some((k) => input[k] !== undefined)) {
    return buildError(VALIDATION_ERROR);
  }

  // String fields: normalize when present, keep the frozen 1–255 bounds.
  for (const field of ["nombre", "contacto"] as const) {
    if (input[field] === undefined) continue;
    const value = normalizeNombre(input[field] as string);
    if (value.length === 0 || value.length > 255) {
      return buildError(VALIDATION_ERROR);
    }
    patch[field] = value;
  }
  if (input.telefono !== undefined) {
    const telefono = input.telefono.trim();
    if (telefono.length === 0 || telefono.length > 255) {
      return buildError(VALIDATION_ERROR);
    }
    patch.telefono = telefono;
  }
  if (input.tipoProveedor !== undefined) patch.tipoProveedor = input.tipoProveedor;
  if (input.tipoPersona !== undefined) patch.tipoPersona = input.tipoPersona;

  const actual = await proveedorByIdEnEmpresa(tx, ctx.empresaId, input.id);
  if (actual === null) {
    // Foreign-tenant ids are indistinguishable from missing ones (PRV-ISO).
    return buildError(PROVEEDOR_NO_ENCONTRADO);
  }
  if (!actual.activo) {
    return buildError(PROVEEDOR_YA_INACTIVO);
  }

  // RNC: undefined keeps the stored value; explicit null clears it (nulls are
  // repeatable and never probed); a new string must normalize and stay free.
  let rncFinal = actual.rnc;
  if (input.rnc !== undefined) {
    try {
      rncFinal = normalizeRnc(input.rnc);
    } catch (err) {
      if (
        err instanceof ProveedorDomainError &&
        err.code === RNC_FORMATO_INVALIDO
      ) {
        return buildError(RNC_FORMATO_INVALIDO);
      }
      throw err;
    }
    patch.rnc = rncFinal;
  }
  if (rncFinal !== null && rncFinal !== actual.rnc) {
    const duplicado = await existeRncEnEmpresa(
      tx,
      ctx.empresaId,
      rncFinal,
      input.id,
    );
    if (duplicado) {
      return buildError(RNC_PROVEEDOR_DUPLICADO);
    }
  }

  // Audit old/new only for fields the patch actually carries.
  for (const key of Object.keys(patch) as (keyof ActualizarProveedorPatch)[]) {
    cambios.anteriores[key] = actual[key];
    cambios.nuevos[key] = patch[key];
  }

  let update: { updated: boolean; newVersion: number };
  try {
    update = await actualizarProveedorEnTx(
      tx,
      ctx.empresaId,
      input.id,
      // Optimistic lock from the CLIENT version, never the re-read one:
      // `UPDATE ... WHERE version = input.version` yields { updated: false }
      // exactly when the caller edited against a stale row (PRV-EDIT-B).
      input.version,
      patch,
    );
  } catch (err) {
    // P2002 race on the partial unique maps to the duplicate-RNC result;
    // unexpected errors propagate untouched.
    if (
      err instanceof ProveedorDomainError &&
      err.code === RNC_PROVEEDOR_DUPLICADO
    ) {
      return buildError(RNC_PROVEEDOR_DUPLICADO);
    }
    throw err;
  }
  if (!update.updated) {
    return buildError(CONCURRENCIA_CONFLICTO);
  }

  // Re-read inside the same transaction: the entity reflects the committed
  // state (including the bumped version), not a local guess.
  const refreshed = await proveedorByIdEnEmpresa(tx, ctx.empresaId, input.id);
  if (refreshed === null) {
    // Defensive: the row existed microseconds ago inside this transaction.
    return buildError(PROVEEDOR_NO_ENCONTRADO);
  }

  // Audit runs only after the mutation succeeded, so a rolled-back edit
  // persists neither change nor event; old/new carry the changed fields.
  await registrarAuditProveedorEnTx(
    tx,
    ctx,
    "ACTUALIZAR",
    input.id,
    cambios.anteriores,
    cambios.nuevos,
  );

  return { ok: true, data: refreshed };
}
