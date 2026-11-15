/**
 * Application use cases — branch management writes (odd/tasks/
 * administracion-sucursales-crear-editar.md, S3-S7).
 *
 * `crearSucursal` and `editarSucursal` run inside the caller's
 * `withTenantTransaction`. Authorization (who may call) is the action's job,
 * and the admin-only RLS policies are the independent second wall: a write the
 * database refuses comes back as `TEN_OPS_NO_AUTORIZADO`, never a Prisma error.
 *
 * Edit sequence (same idempotency rule as the user writes): read the branch of
 * the session empresa (`TEN_SUCURSAL_NO_VALIDA` for unknown AND foreign ids),
 * version check (a stale `versionEsperada` ALWAYS conflicts, even when the
 * values are already in place), pure decision (identical values = success
 * no-op: no write, no version bump, NO audit), duplicate probe against ALL
 * branches incl. inactive, verified UPDATE, ONE audit row.
 */

import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "../domain/tenant";
import {
  TEN_CONCURRENCIA_CONFLICTO,
  TEN_OPS_NO_AUTORIZADO,
  TEN_SUCURSAL_NO_VALIDA,
  TEN_SUCURSAL_NOMBRE_DUPLICADO,
  messageFor,
  type TenantErrorCode,
} from "../domain/errors";
import {
  decidirEdicionSucursal,
  limpiarDatosSucursal,
  type DatosSucursal,
} from "../domain/sucursal-gestion";
import {
  actualizarSucursalEnTx,
  crearSucursalEnTx,
  existeSucursalConNombreEnTx,
  leerSucursalGestionableEnTx,
  registrarAuditSucursalActualizadaEnTx,
  registrarAuditSucursalCreadaEnTx,
  type SucursalGestionable,
} from "../infrastructure/sucursal-gestion-repository";

export type CrearSucursalInput = DatosSucursal;

export interface EditarSucursalInput extends DatosSucursal {
  readonly sucursalId: number;
  readonly versionEsperada: number;
}

export type EditarSucursalData = SucursalGestionable & {
  /** `false` = idempotent no-op (nothing written, no audit row). */
  readonly cambio: boolean;
};

export type ResultadoSucursal<T> =
  | { readonly ok: true; readonly data: T }
  | {
      readonly ok: false;
      readonly code: TenantErrorCode;
      readonly message: string;
    };

function rechazo(code: TenantErrorCode): ResultadoSucursal<never> {
  return { ok: false, code, message: messageFor(code) };
}

export async function crearSucursal(
  tx: PrismaTx,
  ctx: TenantCtx,
  input: CrearSucursalInput,
): Promise<ResultadoSucursal<SucursalGestionable>> {
  const datos = limpiarDatosSucursal(input);

  if (await existeSucursalConNombreEnTx(tx, ctx.empresaId, datos.nombre, null)) {
    return rechazo(TEN_SUCURSAL_NOMBRE_DUPLICADO);
  }

  const creada = await crearSucursalEnTx(tx, ctx, datos);
  if (creada.tipo === "NOMBRE_DUPLICADO") {
    return rechazo(TEN_SUCURSAL_NOMBRE_DUPLICADO);
  }
  if (creada.tipo === "DENEGADA") return rechazo(TEN_OPS_NO_AUTORIZADO);

  await registrarAuditSucursalCreadaEnTx(tx, ctx, creada.sucursal);
  return { ok: true, data: creada.sucursal };
}

export async function editarSucursal(
  tx: PrismaTx,
  ctx: TenantCtx,
  input: EditarSucursalInput,
): Promise<ResultadoSucursal<EditarSucursalData>> {
  const actual = await leerSucursalGestionableEnTx(
    tx,
    ctx.empresaId,
    input.sucursalId,
  );
  if (actual === null) return rechazo(TEN_SUCURSAL_NO_VALIDA);
  if (actual.version !== input.versionEsperada) {
    return rechazo(TEN_CONCURRENCIA_CONFLICTO);
  }

  const decision = decidirEdicionSucursal(actual, input);
  if (decision.tipo === "SIN_CAMBIO") {
    return { ok: true, data: { ...actual, cambio: false } };
  }

  if (
    decision.requiereVerificarNombre &&
    (await existeSucursalConNombreEnTx(
      tx,
      ctx.empresaId,
      limpiarDatosSucursal(input).nombre,
      actual.id,
    ))
  ) {
    return rechazo(TEN_SUCURSAL_NOMBRE_DUPLICADO);
  }

  const aplicado = await actualizarSucursalEnTx(
    tx,
    ctx.empresaId,
    actual.id,
    input.versionEsperada,
    decision.despues,
  );
  if (aplicado.tipo === "NOMBRE_DUPLICADO") {
    return rechazo(TEN_SUCURSAL_NOMBRE_DUPLICADO);
  }
  if (aplicado.tipo === "DENEGADA") return rechazo(TEN_OPS_NO_AUTORIZADO);
  if (aplicado.tipo === "SIN_FILAS") {
    // 0 rows: either a concurrent writer moved the version, or RLS silently
    // filtered the row out of the UPDATE (non-admin). Re-read to tell them apart.
    const vigente = await leerSucursalGestionableEnTx(
      tx,
      ctx.empresaId,
      actual.id,
    );
    return rechazo(
      vigente !== null && vigente.version === input.versionEsperada
        ? TEN_OPS_NO_AUTORIZADO
        : TEN_CONCURRENCIA_CONFLICTO,
    );
  }

  await registrarAuditSucursalActualizadaEnTx(
    tx,
    ctx,
    actual.id,
    decision.antes,
    decision.despues,
  );
  return {
    ok: true,
    data: {
      ...actual,
      ...decision.despues,
      version: aplicado.version,
      cambio: true,
    },
  };
}
