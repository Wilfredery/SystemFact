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

/**
 * Build the non-RNC UPDATE patch from the input. `undefined` fields are skipped
 * (R-QC-02: undefined leaves the column unchanged); a `null` never reaches here
 * because `rnc` is resolved separately and the remaining fields are
 * non-nullable strings/enums. Field normalization and the frozen 1–255 bounds
 * live here and throw `ProveedorDomainError(VALIDATION_ERROR)`, which the caller
 * maps to a typed result. Pure: no Prisma/Next imports.
 */
function construirPatchProveedor(
  input: ActualizarProveedorInput,
): ActualizarProveedorPatch {
  const patch: ActualizarProveedorPatch = {};

  // String fields: normalize when present, keep the frozen 1–255 bounds.
  for (const field of ["nombre", "contacto"] as const) {
    if (input[field] === undefined) continue;
    const value = normalizeNombre(input[field] as string);
    if (value.length === 0 || value.length > 255) {
      throw new ProveedorDomainError(VALIDATION_ERROR);
    }
    patch[field] = value;
  }
  if (input.telefono !== undefined) {
    const telefono = input.telefono.trim();
    if (telefono.length === 0 || telefono.length > 255) {
      throw new ProveedorDomainError(VALIDATION_ERROR);
    }
    patch.telefono = telefono;
  }
  if (input.tipoProveedor !== undefined) patch.tipoProveedor = input.tipoProveedor;
  if (input.tipoPersona !== undefined) patch.tipoPersona = input.tipoPersona;

  return patch;
}

/**
 * Resolve the final RNC to store. `undefined` keeps the stored value; explicit
 * `null` clears it (nulls are repeatable and never probed); a new string is
 * normalized and may throw `ProveedorDomainError(RNC_FORMATO_INVALIDO)`, mapped
 * by the caller. Pure over the already-read row — no DB access.
 */
function resolverRncFinal(
  input: ActualizarProveedorInput,
  actual: Proveedor,
): string | null {
  if (input.rnc === undefined) return actual.rnc;
  return normalizeRnc(input.rnc);
}

/**
 * Run `construirPatchProveedor` and translate only its frozen VALIDATION_ERROR
 * into a typed result; an unexpected error propagates untouched. Kept module-local
 * and pure (no DB) so the malformed-name-before-any-read ordering is preserved.
 */
function prepararPatchProveedor(
  input: ActualizarProveedorInput,
): { ok: true; patch: ActualizarProveedorPatch } | { ok: false; code: ProveedorErrorCode } {
  try {
    return { ok: true, patch: construirPatchProveedor(input) };
  } catch (err) {
    if (err instanceof ProveedorDomainError && err.code === VALIDATION_ERROR) {
      return { ok: false, code: VALIDATION_ERROR };
    }
    throw err;
  }
}

/**
 * Resolve the final RNC through `resolverRncFinal`, translating only the known
 * RNC_FORMATO_INVALIDO into a typed result and rethrowing any other error. Pure
 * over the already-read row.
 */
function resolverRncFinalSeguro(
  input: ActualizarProveedorInput,
  actual: Proveedor,
): { ok: true; rnc: string | null } | { ok: false; code: ProveedorErrorCode } {
  try {
    return { ok: true, rnc: resolverRncFinal(input, actual) };
  } catch (err) {
    if (
      err instanceof ProveedorDomainError &&
      err.code === RNC_FORMATO_INVALIDO
    ) {
      return { ok: false, code: RNC_FORMATO_INVALIDO };
    }
    throw err;
  }
}

/**
 * Duplicate-RNC probe, run only when the resolved RNC is non-null and differs
 * from the stored value (nulls are repeatable and never probed). Returns the
 * duplicate code or `null`. Kept in the use case because it hits the DB.
 */
async function sondaRncDuplicado(
  tx: PrismaTx,
  ctx: TenantCtx,
  actual: Proveedor,
  input: ActualizarProveedorInput,
  rncFinal: string | null,
): Promise<ProveedorErrorCode | null> {
  if (rncFinal !== null && rncFinal !== actual.rnc) {
    const duplicado = await existeRncEnEmpresa(
      tx,
      ctx.empresaId,
      rncFinal,
      input.id,
    );
    if (duplicado) {
      return RNC_PROVEEDOR_DUPLICADO;
    }
  }
  return null;
}

/** Audit old/new only for the fields the patch actually carries (VARCHAR-safe). */
function calcularDifAuditoria(
  actual: Proveedor,
  patch: ActualizarProveedorPatch,
): { anteriores: Record<string, unknown>; nuevos: Record<string, unknown> } {
  const anteriores: Record<string, unknown> = {};
  const nuevos: Record<string, unknown> = {};
  for (const key of Object.keys(patch) as (keyof ActualizarProveedorPatch)[]) {
    anteriores[key] = actual[key];
    nuevos[key] = patch[key];
  }
  return { anteriores, nuevos };
}

export async function actualizarProveedor(
  tx: PrismaTx,
  ctx: TenantCtx,
  input: ActualizarProveedorInput,
): Promise<ActualizarProveedorResult> {
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

  // Normalize the non-RNC fields BEFORE any DB read, preserving the original
  // ordering: a malformed name must fail with zero store access.
  const preparada = prepararPatchProveedor(input);
  if (!preparada.ok) return buildError(preparada.code);
  const patch = preparada.patch;

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
  const rncResuelto = resolverRncFinalSeguro(input, actual);
  if (!rncResuelto.ok) return buildError(rncResuelto.code);
  if (input.rnc !== undefined) patch.rnc = rncResuelto.rnc;
  const duplicadoError = await sondaRncDuplicado(
    tx,
    ctx,
    actual,
    input,
    rncResuelto.rnc,
  );
  if (duplicadoError !== null) return buildError(duplicadoError);

  const cambios = calcularDifAuditoria(actual, patch);

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
