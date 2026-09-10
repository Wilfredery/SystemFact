/**
 * NCF application — the consume port (Phase 1 / pr5c1).
 *
 * `consumirNcfEnTx` is the single-NCF consumption use case other fases
 * (`confirmarVenta`, later nota/B11 flows) call INSIDE their own tenant
 * transaction. It never opens a transaction itself and never touches HTTP/UI.
 *
 * Contract (design "Data Flow" + R-N1..R-N5):
 *   lock the active `empresaId + tipoNcf` row (FOR UPDATE) → reject missing /
 *   exhausted / expired (throwing typed errors that abort the caller's tx, so
 *   the counter, and every post-consume effect, roll back together) → advance
 *   the last-used pointer (D7) → compose `B<tipo><%08d>` → return, attaching a
 *   non-blocking `NCF_UMBRAL_90` warning out-of-band when the range is ≥ 90%
 *   used. Only ever ONE NCF per call: a retried/aborted transaction burns
 *   nothing.
 *
 * Errors are the frozen NCF codes; `venta` maps them into its catalog in a
 * later fase. This module does NOT touch the frozen venta error catalog.
 */

import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import {
  componerNcf,
  calcularUmbral90,
  esRangoVencidoSD,
  siguienteSecuencia,
  type NcfWarning,
  type TipoNcf,
} from "../domain/ncf-rules";
import { avanzarSecuenciaEnTx, bloquearSecuenciaActivaEnTx } from "../infrastructure/ncf-repository";

/** Stable error codes for a consume that hard-fails (never a warning). */
export type NcfConsumoErrorCode =
  | "NCF_SEC_INEXISTENTE"
  | "NCF_AGOTADA"
  | "NCF_VENCIDA";

/**
 * Typed, throw-on-reject domain error. Carries a stable code and a human
 * message; it never embeds Prisma internals or stack traces (AGENTS.md Errors).
 */
export class NcfConsumoError extends Error {
  readonly code: NcfConsumoErrorCode;
  constructor(code: NcfConsumoErrorCode, message: string) {
    super(message);
    this.name = "NcfConsumoError";
    this.code = code;
  }
}

/** Successful consume result. `warning` is present only when the range ≥ 90%. */
export interface ConsumirNcfResultado {
  readonly ncf: string;
  readonly tipo: TipoNcf;
  readonly secuencial: number;
  readonly warning?: NcfWarning;
}

export interface ConsumirNcfOpciones {
  /** Injected clock for the SD expiry check; defaults to `new Date()`. */
  readonly now?: Date;
}

/**
 * Consume exactly one NCF of `tipo` for the acting company, advancing the
 * locked sequence. Throws {@link NcfConsumoError} when the range is missing,
 * exhausted or expired so the caller's transaction aborts and burns nothing.
 */
export async function consumirNcfEnTx(
  tx: PrismaTx,
  ctx: TenantCtx,
  tipo: TipoNcf,
  opts: ConsumirNcfOpciones = {},
): Promise<ConsumirNcfResultado> {
  const now = opts.now ?? new Date();

  const fila = await bloquearSecuenciaActivaEnTx(tx, ctx.empresaId, tipo);
  if (fila === null) {
    throw new NcfConsumoError(
      "NCF_SEC_INEXISTENTE",
      `No hay secuencia NCF activa para la empresa ${String(ctx.empresaId)} tipo ${tipo}.`,
    );
  }

  const next = siguienteSecuencia(fila.secuenciaActual);

  // Exhausted: the next value would pass the authorized upper bound (D7) —
  // advance nothing.
  if (next > fila.rangoFin) {
    throw new NcfConsumoError(
      "NCF_AGOTADA",
      `Rango NCF ${tipo} agotado (rangoFin ${String(fila.rangoFin)} alcanzado).`,
    );
  }

  // Expired on the Santo Domingo calendar day (never a raw UTC compare).
  if (esRangoVencidoSD({ now, vigenciaFin: fila.vigenciaFin })) {
    throw new NcfConsumoError(
      "NCF_VENCIDA",
      `Rango NCF ${tipo} vencido (vigenciaFin ${fila.vigenciaFin.toISOString()}).`,
    );
  }

  const afectados = await avanzarSecuenciaEnTx(tx, ctx.empresaId, fila.id, next);
  if (afectados !== 1) {
    // Row vanished under the lock: treat as missing rather than burn twice.
    throw new NcfConsumoError(
      "NCF_SEC_INEXISTENTE",
      `La secuencia NCF ${tipo} desapareció al avanzar.`,
    );
  }

  const warning = calcularUmbral90({
    rangoInicio: fila.rangoInicio,
    rangoFin: fila.rangoFin,
    secuenciaActual: next,
  });

  const resultado: ConsumirNcfResultado = {
    ncf: componerNcf(tipo, next),
    tipo,
    secuencial: next,
  };
  // Attach the out-of-band warning only when present, so `warning` stays
  // undefined (not null) otherwise and never looks like an error.
  return warning === null ? resultado : { ...resultado, warning };
}
