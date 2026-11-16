/**
 * Application use case — save the empresa's allowed ITBIS rate list
 * (feature itbis-tasas-edit, S2/S3).
 *
 * History-preserving save: the CURRENT active `TASA_ITBIS` row's window is
 * CLOSED at the change instant and a NEW row opens from that instant
 * (`vigenciaFin` far-future). Nothing retroactive: documents frozen before the
 * change keep their stored rates, and past windows remain readable.
 * Idempotent: saving the same set again is a no-op (no new row, no audit).
 *
 * Concurrency: the close is a version-checked `updateMany` (optimistic
 * locking); a lost race returns `TEN_CONCURRENCIA_CONFLICTO` so the UI reloads
 * and the user retries explicitly. The new row's `vigenciaInicio` steps
 * forward 1 ms past any existing row with the same instant (two edits in the
 * same millisecond), so the compound unique `(empresaId, clave,
 * vigenciaInicio)` never fires for this path.
 *
 * Authorization: Administrador only, enforced by the HTTP action (role check
 * inside the tenant transaction) and independently by the RLS policy
 * `configempresa_insert/update` (migration
 * 20261116100000_configempresa_writes_admin_only).
 */

import { Decimal } from "decimal.js";
import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "../domain/tenant";
import {
  TEN_CONCURRENCIA_CONFLICTO,
  TEN_OPS_NO_AUTORIZADO,
  TEN_TASA_ITBIS_INVALIDA,
  messageFor,
  type TenantErrorCode,
} from "../domain/errors";
import { registrarEventoAuditoriaEnTx } from "@/modules/auditoria/application/auditoria-write-port";
import {
  ACCION_AUDITORIA,
} from "@/modules/auditoria/domain/auditoria";
import {
  CLAVE_TASA_ITBIS,
  parsearListaTasasItbis,
} from "@/shared/domain/tasas-itbis";
import {
  leerTasaItbisConfigEnTx,
  type FilaTasaItbisConfig,
} from "../infrastructure/administracion-config-repository";

/** Far-future end the seed uses; the new row is open-ended in practice. */
const VIGENCIA_FIN_LEJANO = new Date("2099-12-31T23:59:59.000Z");

export interface TasaItbisGuardada {
  readonly valor: string;
  readonly vigenciaInicio: string;
  readonly cambioAplicado: boolean;
}

export type GuardarTasasItbisResultado =
  | { readonly ok: true; readonly data: TasaItbisGuardada }
  | { readonly ok: false; readonly code: TenantErrorCode; readonly message: string };

/**
 * Pick a free `vigenciaInicio`: the first instant >= `deseado` that no row of
 * this (empresaId, clave) already occupies (two saves in the same millisecond
 * must not violate the compound unique).
 */
async function vigenciaInicioLibre(
  tx: PrismaTx,
  empresaId: number,
  deseado: Date,
): Promise<Date> {
  let candidato = deseado;
  for (let i = 0; i < 10; i++) {
    const ocupado = await tx.configuracionEmpresa.findFirst({
      where: {
        empresaId,
        clave: CLAVE_TASA_ITBIS,
        vigenciaInicio: candidato,
      },
      select: { id: true },
    });
    if (ocupado === null) return candidato;
    candidato = new Date(candidato.getTime() + 1);
  }
  return candidato;
}

/**
 * Save the submitted rate list for the session empresa. `valor` is the RAW
 * comma string (the UI sends what the accountant confirmed); it must parse
 * through the SHARED parser (`parsearListaTasasItbis`) — the same grammar the
 * validators consume — and it is stored in the parser's canonical spelling.
 */
export async function guardarTasasItbis(
  tx: PrismaTx,
  ctx: TenantCtx,
  valor: string,
  ahora: Date = new Date(),
): Promise<GuardarTasasItbisResultado> {
  const parseo = parsearListaTasasItbis(valor);
  if (!parseo.ok) {
    return {
      ok: false,
      code: TEN_TASA_ITBIS_INVALIDA,
      message: messageFor(TEN_TASA_ITBIS_INVALIDA),
    };
  }
  const valorNuevo = parseo.tasas.join(",");

  const actual: FilaTasaItbisConfig | null = await leerTasaItbisConfigEnTx(
    tx,
    ctx.empresaId,
    ahora,
  );

  // Idempotent no-op: the same SET is already active (order-insensitive —
  // the stored order is display/config order; membership is what matters).
  const claveDe = (tasas: readonly string[]) =>
    [...tasas].sort((a, b) => new Decimal(a).comparedTo(new Decimal(b))).join(",");
  if (actual !== null) {
    const parseoActual = parsearListaTasasItbis(actual.valor);
    if (parseoActual.ok && claveDe(parseoActual.tasas) === claveDe(parseo.tasas)) {
      return {
        ok: true,
        data: {
          valor: valorNuevo,
          vigenciaInicio: actual.vigenciaInicio.toISOString(),
          cambioAplicado: false,
        },
      };
    }
  }

  // 1. Close the current row's window at the change instant (optimistic lock).
  if (actual !== null) {
    const cerrado = await tx.configuracionEmpresa.updateMany({
      where: {
        id: actual.id,
        empresaId: ctx.empresaId,
        version: actual.version,
      },
      data: { vigenciaFin: ahora, version: { increment: 1 } },
    });
    if (cerrado.count === 0) {
      // Distinguish a lost optimistic-lock race (someone else changed the row)
      // from an authorization denial (RLS hid the row from a non-admin that
      // reached the use case bypassing the action role gate): if the row is
      // still there UNCHANGED, nobody raced - it is a permission refusal.
      const aun = await tx.configuracionEmpresa.findUnique({
        where: { id: actual.id },
        select: { version: true },
      });
      if (aun !== null && aun.version === actual.version) {
        return {
          ok: false,
          code: TEN_OPS_NO_AUTORIZADO,
          message: messageFor(TEN_OPS_NO_AUTORIZADO),
        };
      }
      return {
        ok: false,
        code: TEN_CONCURRENCIA_CONFLICTO,
        message: messageFor(TEN_CONCURRENCIA_CONFLICTO),
      };
    }
  }

  // 2. Open the new row from the change instant (never collides with history).
  const vigenciaInicio = await vigenciaInicioLibre(tx, ctx.empresaId, ahora);
  let creada: { id: number };
  try {
    creada = await tx.configuracionEmpresa.create({
      data: {
        empresaId: ctx.empresaId,
        clave: CLAVE_TASA_ITBIS,
        valor: valorNuevo,
        vigenciaInicio,
        vigenciaFin: VIGENCIA_FIN_LEJANO,
        activa: true,
      },
      select: { id: true },
    });
  } catch (err) {
    // Defensive: the +1 ms stepping makes a collision practically
    // impossible, but a raw P2002 must never reach the client as an
    // internal Prisma error.
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code?: string }).code === "P2002"
    ) {
      return {
        ok: false,
        code: TEN_CONCURRENCIA_CONFLICTO,
        message: messageFor(TEN_CONCURRENCIA_CONFLICTO),
      };
    }
    throw err;
  }

  // 3. One audit row for the change (company-wide, per the Sucursal pattern).
  await registrarEventoAuditoriaEnTx(tx, ctx, {
    accion: ACCION_AUDITORIA.ACTUALIZAR,
    entidad: "ConfiguracionEmpresa",
    idEntidad: String(creada.id),
    sucursalId: null,
    valorAnterior: actual === null ? null : actual.valor,
    valorNuevo: valorNuevo,
  });

  return {
    ok: true,
    data: {
      valor: valorNuevo,
      vigenciaInicio: vigenciaInicio.toISOString(),
      cambioAplicado: true,
    },
  };
}
