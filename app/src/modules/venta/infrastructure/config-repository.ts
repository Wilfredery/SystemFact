/**
 * Venta-config repository — the `DESC_MAX` read path (capability `venta-config`).
 *
 * PLACEMENT DECISION (resolve of PR-1 flag #1). `DESC_MAX_FALTANTE` is a
 * venta-config concern, NOT a venta-domain business rule: the domain catalog
 * (`domain/errors.ts`, R-V13) is frozen at its 14 pinned codes and deliberately
 * omits this one. So the hard-fail code lives HERE, in the read path that owns
 * it, mirroring how `CONFIG_RETENCION_FALTANTE` lives in `compra`'s config
 * reader. The application composes `{@link VentaConfigErrorCode}` into the
 * sale-save contract (see `application/venta-guardado.ts`) — the domain never
 * imports this module, preserving ADR-013 purity.
 *
 * Semantics (R-C1): read the ACTIVE `DESC_MAX` row for `empresaId` whose
 * validity window covers the sale date. The read is REQUIRED only when a
 * positive discount exists (zero-discount drafts never touch it — required-keys
 * parity). A missing or expired key throws {@link VentaConfigError} with the
 * stable `DESC_MAX_FALTANTE` code and ZERO writes (the enclosing save rolls
 * back); there is NO legal-default fallback and the cap is NEVER hardcoded.
 *
 * Validity comparison mirrors the retention reader exactly: `VIGENCIA_INICIO` /
 * `VIGENCIA_FIN` are `timestamptz` instants, so "covers the sale date" is an
 * exact instant comparison against the draft `fecha`. Santo-Domingo
 * DAY-granularity would need a tz library that is not a project dependency
 * (19-directivas forbids manual hour arithmetic); the windows are long-dated and
 * the expired-window scenario sets `vigenciaFin` strictly before the sale
 * instant, so instant comparison is unambiguous and dependency-free here.
 */

import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";

/** The stable config error code (venta-config capability, R-C1). */
export const DESC_MAX_FALTANTE = "DESC_MAX_FALTANTE";
export type VentaConfigErrorCode = typeof DESC_MAX_FALTANTE;

const MENSAJES: Record<VentaConfigErrorCode, string> = {
  [DESC_MAX_FALTANTE]:
    "Falta la configuración DESC_MAX requerida; no se puede aplicar el descuento",
};

export function messageForVentaConfig(code: VentaConfigErrorCode): string {
  return MENSAJES[code];
}

/**
 * Known config-violation raised by the read path. The application layer catches
 * it and converts it into a typed save result; anything that is NOT a
 * `VentaConfigError` is a defect and propagates.
 */
export class VentaConfigError extends Error {
  readonly code: VentaConfigErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(code: VentaConfigErrorCode, details?: Record<string, unknown>) {
    super(messageForVentaConfig(code));
    this.name = "VentaConfigError";
    this.code = code;
    this.details = details;
  }
}

/** `ConfiguracionEmpresa.clave` identifier for the discount cap. */
const CLAVE_DESC_MAX = "DESC_MAX";

/**
 * Load the tenant `DESC_MAX` percentage cap for a discounted draft.
 *
 * @param fecha the sale date whose instant the validity window must cover.
 * @returns the cap as a percent-form decimal string (e.g. "4.00").
 * @throws VentaConfigError(DESC_MAX_FALTANTE) when no active row covers `fecha`
 *         or the stored value is not a non-negative decimal percentage.
 */
export async function leerConfigVentaEnTx(
  tx: PrismaTx,
  empresaId: number,
  fecha: Date,
): Promise<string> {
  const row = await tx.configuracionEmpresa.findFirst({
    where: {
      empresaId,
      clave: CLAVE_DESC_MAX,
      activa: true,
      vigenciaInicio: { lte: fecha },
      vigenciaFin: { gte: fecha },
    },
    select: { valor: true },
  });

  if (row === null) {
    throw new VentaConfigError(DESC_MAX_FALTANTE, { empresaId, clave: CLAVE_DESC_MAX });
  }

  const trimmed = row.valor.trim();
  // The cap must parse as a non-negative decimal percentage (parity with the
  // retention reader's grammar; allows "4", "4.00", "25.5").
  if (!/^\d{1,3}(\.\d+)?$/.test(trimmed) || Number.isNaN(Number(trimmed))) {
    throw new VentaConfigError(DESC_MAX_FALTANTE, {
      empresaId,
      clave: CLAVE_DESC_MAX,
      motivo: "valor_no_numeric",
    });
  }

  return trimmed;
}
