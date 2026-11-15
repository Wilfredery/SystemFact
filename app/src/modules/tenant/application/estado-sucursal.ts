/**
 * Application use case — activate / deactivate a branch (odd/tasks/
 * administracion-sucursales-activar.md, S3-S6).
 *
 * Runs inside the caller's `withTenantTransaction`. Authorization (who may call)
 * is the action's job; the admin-only `sucursal_update` RLS policy is the second
 * wall (a refused write or lock comes back as `TEN_OPS_NO_AUTORIZADO`, never a
 * Prisma error). Sequence, decided UNDER the row lock:
 *
 *   1. `SELECT ... FOR UPDATE` on the branch (S5a): queues behind every user
 *      move/switch into it (they read it `FOR SHARE`) and blocks new ones
 *   2. read the branch                         -> TEN_SUCURSAL_NO_VALIDA
 *   3. version check                           -> TEN_CONCURRENCIA_CONFLICTO
 *      (runs BEFORE the no-op check: a stale version ALWAYS conflicts)
 *   4. only for an active -> inactive request: the blocker counts, read under
 *      the company-wide widen (blank branch GUC for the reads only, restored in
 *      `finally`, empresa GUC never touched) + the active-branch count
 *   5. pure decision: SIN_CAMBIO (no write, no version bump, NO audit) |
 *      RECHAZAR (every reason together, with the counts) | APLICAR
 *   6. version-checked UPDATE (savepoint, RLS refusal mapped) -> ONE audit row
 */

import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "../domain/tenant";
import {
  TEN_CONCURRENCIA_CONFLICTO,
  TEN_OPS_NO_AUTORIZADO,
  TEN_SUCURSAL_CON_DOCUMENTOS_ABIERTOS,
  TEN_SUCURSAL_CON_SALDOS_PENDIENTES,
  TEN_SUCURSAL_CON_STOCK,
  TEN_SUCURSAL_CON_USUARIOS,
  TEN_SUCURSAL_NO_VALIDA,
  TEN_SUCURSAL_PROPIA_NO_DESACTIVABLE,
  TEN_SUCURSAL_ULTIMA_ACTIVA,
  messageFor,
  type TenantErrorCode,
} from "../domain/errors";
import {
  decidirCambioEstadoSucursal,
  type ConteosBloqueoSucursal,
  type MotivoRechazoDesactivacion,
} from "../domain/sucursal-gestion";
import {
  actualizarSucursalEnTx,
  bloquearSucursalEnTx,
  contarBloqueosSucursalEnTx,
  contarSucursalesActivasEnTx,
  leerSucursalGestionableEnTx,
  registrarAuditSucursalActualizadaEnTx,
} from "../infrastructure/sucursal-gestion-repository";
import {
  activarSucursalEnTx,
  liberarSucursalActivaEnTx,
} from "../infrastructure/repo-sucursal";

export interface CambiarEstadoSucursalInput {
  readonly sucursalId: number;
  /** The requested state: `false` = deactivate, `true` = reactivate. */
  readonly activa: boolean;
  readonly versionEsperada: number;
}

export interface CambioEstadoSucursalData {
  readonly sucursalId: number;
  readonly activa: boolean;
  readonly version: number;
  /** `false` = idempotent no-op (nothing written, no audit row). */
  readonly cambio: boolean;
}

/** Everything a refused deactivation reports: the counts and EVERY applicable code. */
export interface DetalleBloqueoSucursal extends ConteosBloqueoSucursal {
  readonly codigos: readonly TenantErrorCode[];
}

export type ResultadoCambioEstadoSucursal =
  | { readonly ok: true; readonly data: CambioEstadoSucursalData }
  | {
      readonly ok: false;
      /** The first applicable reason; `detalle.codigos` lists all of them. */
      readonly code: TenantErrorCode;
      readonly message: string;
      /** Present only on a deactivation refused for one or more blockers. */
      readonly detalle?: DetalleBloqueoSucursal;
    };

const CODIGO_DE_MOTIVO: Readonly<Record<MotivoRechazoDesactivacion, TenantErrorCode>> = {
  SUCURSAL_PROPIA: TEN_SUCURSAL_PROPIA_NO_DESACTIVABLE,
  ULTIMA_ACTIVA: TEN_SUCURSAL_ULTIMA_ACTIVA,
  USUARIOS: TEN_SUCURSAL_CON_USUARIOS,
  STOCK: TEN_SUCURSAL_CON_STOCK,
  DOCUMENTOS_ABIERTOS: TEN_SUCURSAL_CON_DOCUMENTOS_ABIERTOS,
  SALDOS: TEN_SUCURSAL_CON_SALDOS_PENDIENTES,
};

const SIN_CONTEOS: ConteosBloqueoSucursal = {
  usuarios: 0,
  stock: 0,
  documentosAbiertos: 0,
  saldos: 0,
};

function rechazo(code: TenantErrorCode): ResultadoCambioEstadoSucursal {
  return { ok: false, code, message: messageFor(code) };
}

/**
 * The counts need the company-wide view: RLS pins branch-scoped tables to the
 * session branch and would silently count zero for any other one. The branch
 * GUC is blank ONLY inside this function (restored in `finally`, the empresa
 * GUC is never touched), so the UPDATE and the audit insert run pinned to the
 * session branch again. Same idiom as the user move (`moverBajoSucursalAmpliada`).
 */
async function contarBloqueosBajoSucursalAmpliada(
  tx: PrismaTx,
  ctx: TenantCtx,
  sucursalId: number,
): Promise<ConteosBloqueoSucursal> {
  await liberarSucursalActivaEnTx(tx);
  try {
    return await contarBloqueosSucursalEnTx(tx, ctx, sucursalId);
  } finally {
    await activarSucursalEnTx(tx, ctx.sucursalId);
  }
}

export async function cambiarEstadoSucursal(
  tx: PrismaTx,
  ctx: TenantCtx,
  input: CambiarEstadoSucursalInput,
): Promise<ResultadoCambioEstadoSucursal> {
  const bloqueada = await bloquearSucursalEnTx(tx, ctx.empresaId, input.sucursalId);
  const actual = await leerSucursalGestionableEnTx(tx, ctx.empresaId, input.sucursalId);
  if (actual === null) return rechazo(TEN_SUCURSAL_NO_VALIDA);
  // The row exists but the admin-only policy hid it from the lock: not an admin.
  if (!bloqueada) return rechazo(TEN_OPS_NO_AUTORIZADO);
  if (actual.version !== input.versionEsperada) {
    return rechazo(TEN_CONCURRENCIA_CONFLICTO);
  }

  const desactivando = actual.activa && !input.activa;
  const conteos = desactivando
    ? await contarBloqueosBajoSucursalAmpliada(tx, ctx, actual.id)
    : SIN_CONTEOS;
  const sucursalesActivas = desactivando
    ? await contarSucursalesActivasEnTx(tx, ctx.empresaId)
    : 0;

  const decision = decidirCambioEstadoSucursal({
    sucursalId: actual.id,
    activaActual: actual.activa,
    activaSolicitada: input.activa,
    conteos,
    sucursalSesionId: ctx.sucursalId,
    sucursalesActivas,
  });
  if (decision.tipo === "SIN_CAMBIO") {
    return {
      ok: true,
      data: {
        sucursalId: actual.id,
        activa: actual.activa,
        version: actual.version,
        cambio: false,
      },
    };
  }
  if (decision.tipo === "RECHAZAR") {
    const codigos = decision.motivos.map((motivo) => CODIGO_DE_MOTIVO[motivo]);
    const code = codigos[0] ?? TEN_OPS_NO_AUTORIZADO;
    return {
      ok: false,
      code,
      message: messageFor(code),
      detalle: { ...conteos, codigos },
    };
  }

  const aplicado = await actualizarSucursalEnTx(
    tx,
    ctx.empresaId,
    actual.id,
    input.versionEsperada,
    { activa: input.activa },
  );
  if (aplicado.tipo === "DENEGADA") return rechazo(TEN_OPS_NO_AUTORIZADO);
  if (aplicado.tipo === "SIN_FILAS") {
    // 0 rows: a stale version, or RLS silently filtered the row out of the UPDATE
    // (non-admin). Re-read to tell them apart.
    const vigente = await leerSucursalGestionableEnTx(tx, ctx.empresaId, actual.id);
    return rechazo(
      vigente !== null && vigente.version === input.versionEsperada
        ? TEN_OPS_NO_AUTORIZADO
        : TEN_CONCURRENCIA_CONFLICTO,
    );
  }
  // `NOMBRE_DUPLICADO` cannot happen: this write never touches the name.
  if (aplicado.tipo !== "APLICADA") return rechazo(TEN_OPS_NO_AUTORIZADO);

  await registrarAuditSucursalActualizadaEnTx(
    tx,
    ctx,
    actual.id,
    { activa: actual.activa },
    { activa: input.activa },
  );
  return {
    ok: true,
    data: {
      sucursalId: actual.id,
      activa: input.activa,
      version: aplicado.version,
      cambio: true,
    },
  };
}
