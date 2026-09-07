import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import {
  NOMBRE_CATEGORIA_DUPLICADO,
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
  existeNombreEnEmpresa,
  crearCategoriaEnTx,
  registrarAuditCategoriaEnTx,
} from "../infrastructure/categoria-repository";

export interface CrearCategoriaInput {
  readonly nombre: string;
}

export type CrearCategoriaResult = CategoriaResult<Categoria>;

function buildError(
  code: CategoriaErrorCode,
): { ok: false; code: CategoriaErrorCode; message: string } {
  return { ok: false, code, message: messageFor(code) };
}

/**
 * CAT-001/CAT-002: create an active, tenant-scoped category. The name is
 * normalized before both the friendly pre-check and the insert; the partial
 * unique (empresaId, nombre over activa=true) remains the real TOCTOU guard
 * and the repository maps its P2002 to the duplicate-name error.
 */
export async function crearCategoria(
  tx: PrismaTx,
  ctx: TenantCtx,
  input: CrearCategoriaInput,
): Promise<CrearCategoriaResult> {
  const nombre = normalizeNombre(input.nombre);
  if (nombre.length === 0 || nombre.length > 255) {
    return buildError(VALIDATION_ERROR);
  }

  const duplicado = await existeNombreEnEmpresa(tx, ctx.empresaId, nombre);
  if (duplicado) {
    return buildError(NOMBRE_CATEGORIA_DUPLICADO);
  }

  let categoria: Categoria;
  try {
    categoria = await crearCategoriaEnTx(tx, ctx, nombre);
  } catch (err) {
    // Race between pre-check and insert (CAT-002-B): known domain violation
    // becomes a typed result; anything else is a defect and propagates.
    if (
      err instanceof CategoriaDomainError &&
      err.code === NOMBRE_CATEGORIA_DUPLICADO
    ) {
      return buildError(NOMBRE_CATEGORIA_DUPLICADO);
    }
    throw err;
  }

  // Same-transaction, append-only audit: a rollback drops category and event.
  await registrarAuditCategoriaEnTx(tx, ctx, "CREAR", categoria.id, null, {
    id: categoria.id,
    nombre: categoria.nombre,
  });

  return { ok: true, data: categoria };
}
