import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import {
  CATEGORIA_NO_ENCONTRADA,
  CATEGORIA_YA_INACTIVA,
  NOMBRE_CATEGORIA_DUPLICADO,
  CONCURRENCIA_CONFLICTO,
  VALIDATION_ERROR,
  messageFor,
  CategoriaDomainError,
  type CategoriaErrorCode,
} from "../domain/errors";
import {
  normalizeNombre,
  type Categoria,
  type CategoriaResult,
} from "../domain/categoria";
import {
  categoriaByIdEnEmpresa,
  existeNombreEnEmpresa,
  actualizarCategoriaEnTx,
  registrarAuditCategoriaEnTx,
} from "../infrastructure/categoria-repository";

/**
 * CAT-004 partial-edit command. `id` + `version` identify the target row and
 * its expected state; `nombre` is the single editable field, so an absent
 * nombre is an empty patch (VALIDATION_ERROR, same contract as Producto).
 */
export interface ActualizarCategoriaInput {
  readonly id: number;
  readonly version: number;
  readonly nombre?: string;
}

export type ActualizarCategoriaResult = CategoriaResult<Categoria>;

function buildError(
  code: CategoriaErrorCode,
): { ok: false; code: CategoriaErrorCode; message: string } {
  return { ok: false, code, message: messageFor(code) };
}

export async function actualizarCategoria(
  tx: PrismaTx,
  ctx: TenantCtx,
  input: ActualizarCategoriaInput,
): Promise<ActualizarCategoriaResult> {
  if (input.nombre === undefined) {
    return buildError(VALIDATION_ERROR);
  }
  const nombre = normalizeNombre(input.nombre);
  if (nombre.length === 0 || nombre.length > 255) {
    return buildError(VALIDATION_ERROR);
  }

  const actual = await categoriaByIdEnEmpresa(tx, ctx.empresaId, input.id);
  if (actual === null) {
    // Foreign-tenant ids are indistinguishable from missing ones (CAT-006-B).
    return buildError(CATEGORIA_NO_ENCONTRADA);
  }
  if (!actual.activa) {
    return buildError(CATEGORIA_YA_INACTIVA);
  }

  // Uniqueness is probed only when the name actually changes; the edited row
  // itself is excluded so re-submitting its own name is a no-op rename.
  if (nombre !== actual.nombre) {
    const duplicado = await existeNombreEnEmpresa(
      tx,
      ctx.empresaId,
      nombre,
      input.id,
    );
    if (duplicado) {
      return buildError(NOMBRE_CATEGORIA_DUPLICADO);
    }
  }

  let update: { updated: boolean; newVersion: number };
  try {
    update = await actualizarCategoriaEnTx(
      tx,
      ctx.empresaId,
      input.id,
      // Optimistic lock from the CLIENT version, never the re-read one:
      // `UPDATE ... WHERE version = input.version` yields { updated: false }
      // exactly when the caller edited against a stale row (CRITICAL-1).
      input.version,
      nombre,
    );
  } catch (err) {
    // P2002 race on the partial unique maps to the duplicate-name result;
    // unexpected errors propagate untouched.
    if (
      err instanceof CategoriaDomainError &&
      err.code === NOMBRE_CATEGORIA_DUPLICADO
    ) {
      return buildError(NOMBRE_CATEGORIA_DUPLICADO);
    }
    throw err;
  }
  if (!update.updated) {
    return buildError(CONCURRENCIA_CONFLICTO);
  }

  // Re-read inside the same transaction: the entity reflects the committed
  // state (including the bumped version), not a local guess.
  const refreshed = await categoriaByIdEnEmpresa(tx, ctx.empresaId, input.id);
  if (refreshed === null) {
    // Defensive: the row existed microseconds ago inside this transaction.
    return buildError(CATEGORIA_NO_ENCONTRADA);
  }

  // Audit runs only after the mutation succeeded, so a rolled-back edit
  // persists neither change nor event; old/new carry the changed nombre.
  await registrarAuditCategoriaEnTx(
    tx,
    ctx,
    "ACTUALIZAR",
    input.id,
    { nombre: actual.nombre },
    { nombre: refreshed.nombre },
  );

  return { ok: true, data: refreshed };
}
