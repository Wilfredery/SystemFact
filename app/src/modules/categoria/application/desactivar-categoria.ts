import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import {
  CATEGORIA_NO_ENCONTRADA,
  CATEGORIA_YA_INACTIVA,
  CATEGORIA_TIENE_PRODUCTOS,
  messageFor,
  type CategoriaErrorCode,
} from "../domain/errors";
import type { CategoriaResult } from "../domain/categoria";
import {
  categoriaByIdEnEmpresa,
  tieneProductosActivos,
  desactivarCategoriaEnTx,
  registrarAuditCategoriaEnTx,
} from "../infrastructure/categoria-repository";

export interface DesactivarCategoriaInput {
  readonly id: number;
}

export type DesactivarCategoriaOutput = {
  readonly id: number;
  readonly nombre: string;
};

export type DesactivarCategoriaResult = CategoriaResult<DesactivarCategoriaOutput>;

function buildError(
  code: CategoriaErrorCode,
): { ok: false; code: CategoriaErrorCode; message: string } {
  return { ok: false, code, message: messageFor(code) };
}

/**
 * CAT-005: guarded soft deactivation — the row is never deleted. Blocked only
 * by active products (explicit business guard, never Prisma P2003), idempotent
 * against concurrent deactivations, and the partial unique index releases the
 * name for reuse afterwards. Admin-only authorization is enforced at the
 * action layer; this use case keeps every read/write tenant-scoped.
 */
export async function desactivarCategoria(
  tx: PrismaTx,
  ctx: TenantCtx,
  input: DesactivarCategoriaInput,
): Promise<DesactivarCategoriaResult> {
  const actual = await categoriaByIdEnEmpresa(tx, ctx.empresaId, input.id);
  if (actual === null) {
    return buildError(CATEGORIA_NO_ENCONTRADA);
  }
  if (!actual.activa) {
    return buildError(CATEGORIA_YA_INACTIVA);
  }

  const enUso = await tieneProductosActivos(tx, ctx.empresaId, input.id);
  if (enUso) {
    return buildError(CATEGORIA_TIENE_PRODUCTOS);
  }

  const { deactivated } = await desactivarCategoriaEnTx(
    tx,
    ctx.empresaId,
    input.id,
  );
  if (!deactivated) {
    // Lost a race against a concurrent deactivation: same user-visible state.
    return buildError(CATEGORIA_YA_INACTIVA);
  }

  // CANCELAR is the frozen-enum closest to "retire without destruction"
  // (design D2: no enum extension, no migration); motivo keeps it traceable.
  await registrarAuditCategoriaEnTx(
    tx,
    ctx,
    "CANCELAR",
    input.id,
    { activa: true },
    { activa: false },
    "categoria.desactivada",
  );

  return { ok: true, data: { id: input.id, nombre: actual.nombre } };
}
