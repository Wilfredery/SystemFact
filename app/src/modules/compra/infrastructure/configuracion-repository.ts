/**
 * ConfiguracionEmpresa repository — the first-ever read path for tenant
 * retention configuration (design "Retention configuration").
 *
 * Reads the ACTIVE ConfiguracionEmpresa rows for the empresa whose validity
 * window covers the current instant, and returns the four retention rate
 * percentages consumed by the pure retention calculators. A key that is
 * APPLICABLE to a purchase (see `requiredRetentionKeys`) but absent or
 * non-numeric blocks confirmation with the stable `CONFIG_RETENCION_FALTANTE`
 * code — there is deliberately NO legal-default fallback (product decision 6).
 *
 * Validity comparison: `VIGENCIA_INICIO` / `VIGENCIA_FIN` are stored as
 * absolute `timestamptz` instants, so "is this row currently valid" is an
 * exact instant comparison against `new Date()`. Santo-Domingo DAY-granularity
 * (the "today" nuance from 19-directivas §Dates) would need a tz library that
 * is not a project dependency; adding manual hour arithmetic is forbidden, and
 * the retention windows are long-dated, so instant comparison is the correct,
 * dependency-free reading here.
 */

import { Prisma } from "@/generated/prisma/client";
import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import {
  CONFIG_RETENCION_FALTANTE,
  CompraDomainError,
} from "../domain/errors";
import type { RetentionRates } from "../domain/compra";
import type { RetencionClave } from "../domain/calculators";

/** Config key → the `RetentionRates` field it feeds. */
const CLAVE_A_CAMPO: Record<RetencionClave, keyof RetentionRates> = {
  RET_ISR_15: "isr15",
  RET_ISR_2: "isr2",
  RET_ITBIS_100: "itbis100",
  RET_ITBIS_30: "itbis30",
};

/**
 * Load the retention rates for an empresa, guaranteeing that every
 * `requiredClaves` key resolves to an active, in-validity, non-negative numeric
 * percentage.
 *
 * Non-required keys default to `"0"` so the returned object always satisfies
 * {@link RetentionRates}. A missing/invalid required key throws
 * `CompraDomainError(CONFIG_RETENCION_FALTANTE)` with the offending keys in
 * `details`, which the confirm use case converts into a typed result.
 *
 * @throws CompraDomainError(CONFIG_RETENCION_FALTANTE)
 */
export async function leerTasasRetencionEnTx(
  tx: PrismaTx,
  empresaId: number,
  requiredClaves: readonly RetencionClave[],
): Promise<RetentionRates> {
  const now = new Date();
  const rows = await tx.configuracionEmpresa.findMany({
    where: {
      empresaId,
      activa: true,
      vigenciaInicio: { lte: now },
      vigenciaFin: { gte: now },
      clave: { in: requiredClaves.map((c) => c) },
    },
    select: { clave: true, valor: true },
  });

  const byKey = new Map(rows.map((r) => [r.clave, r.valor]));

  const rates: Record<keyof RetentionRates, string> = {
    isr15: "0",
    isr2: "0",
    itbis100: "0",
    itbis30: "0",
  };

  const faltantes: RetencionClave[] = [];
  for (const clave of requiredClaves) {
    const raw = byKey.get(clave);
    if (raw === undefined) {
      faltantes.push(clave);
      continue;
    }
    const trimmed = raw.trim();
    // A retention percentage must parse as a non-negative decimal number.
    if (!/^\d{1,3}(\.\d+)?$/.test(trimmed) || Number.isNaN(Number(trimmed))) {
      faltantes.push(clave);
      continue;
    }
    rates[CLAVE_A_CAMPO[clave]] = trimmed;
  }

  if (faltantes.length > 0) {
    throw new CompraDomainError(CONFIG_RETENCION_FALTANTE, {
      empresaId,
      clavesFaltantes: faltantes,
    });
  }

  return rates;
}
