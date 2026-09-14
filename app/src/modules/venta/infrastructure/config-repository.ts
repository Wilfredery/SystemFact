/**
 * Venta-config repository — the `DESC_MAX` / `PLAZO_DEVOLUCION` read paths
 * (capabilities `venta-config` R-C1 and returns R-D2).
 *
 * PLACEMENT DECISION (resolve of PR-1 flag #1). `DESC_MAX_FALTANTE` is a
 * venta-config concern, NOT a venta-domain business rule: the domain catalog
 * (`domain/errors.ts`, R-V13) is frozen at its 23 pinned codes and deliberately
 * omits this one. So the hard-fail code lives HERE, in the read path that owns
 * it, mirroring how `CONFIG_RETENCION_FALTANTE` lives in `compra`'s config
 * reader. `PLAZO_DEVOLUCION_FALTANTE` follows the same rule (R-D2): the return
 * window is a tenant parameter with a seeded default (task 1.9), never a
 * hardcoded domain constant. The application composes `{@link
 * VentaConfigErrorCode}` into the sale/returns contracts (see
 * `application/venta-guardado.ts` and `crear-devolucion.ts`) — the domain never
 * imports this module, preserving ADR-013 purity.
 *
 * Semantics (R-C1): read the ACTIVE `DESC_MAX` row for `empresaId` whose
 * validity window covers the sale date. The read is REQUIRED only when a
 * positive discount exists (zero-discount drafts never touch it — required-keys
 * parity). A missing or expired key throws {@link VentaConfigError} with the
 * stable `DESC_MAX_FALTANTE` code and ZERO writes (the enclosing save rolls
 * back); there is NO legal-default fallback and the cap is NEVER hardcoded.
 * Semantics (R-D2): the return window is read the same way for the devolucion
 * instant; a missing/expired key throws `PLAZO_DEVOLUCION_FALTANTE` before the
 * enclosing devolucion writes anything.
 *
 * Validity comparison mirrors the retention reader exactly: `VIGENCIA_INICIO` /
 * `VIGENCIA_FIN` are `timestamptz` instants, so "covers the sale date" is an
 * exact instant comparison against the draft `fecha`. Santo-Domingo
 * DAY-granularity would need a tz library that is not a project dependency
 * (19-directivas forbids manual hour arithmetic); the windows are long-dated and
 * the expired-window scenario sets `vigenciaFin` strictly before the relevant
 * instant, so instant comparison is unambiguous and dependency-free here.
 */

import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";

/**
 * The stable config error codes (venta-config capability, R-C1 / returns R-D2).
 * `DESC_MAX_FALTANTE`: missing/expired discount cap; `PLAZO_DEVOLUCION_FALTANTE`:
 * missing/expired return window. Both hard-fail BEFORE any write.
 */
export const DESC_MAX_FALTANTE = "DESC_MAX_FALTANTE";
export const PLAZO_DEVOLUCION_FALTANTE = "PLAZO_DEVOLUCION_FALTANTE";
export type VentaConfigErrorCode =
  | typeof DESC_MAX_FALTANTE
  | typeof PLAZO_DEVOLUCION_FALTANTE;

const MENSAJES: Record<VentaConfigErrorCode, string> = {
  [DESC_MAX_FALTANTE]:
    "Falta la configuración DESC_MAX requerida; no se puede aplicar el descuento",
  [PLAZO_DEVOLUCION_FALTANTE]:
    "Falta la configuración PLAZO_DEVOLUCION requerida; no se puede calcular el plazo de devolución",
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
    // R-V17 (CodeRabbit F5): overlapping validity windows resolve
    // DETERMINISTICALLY — the row with the NEWEST `vigenciaInicio` wins. Without
    // the order, `findFirst` is an arbitrary-row pick (no `ORDER BY` ⇒ Postgres
    // gives no row-order guarantee). The seed (`seed-venta-config`) asserts zero
    // overlap per key+empresa so this tie-break never hides corrupted config.
    orderBy: { vigenciaInicio: "desc" },
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

/** `ConfiguracionEmpresa.clave` identifier for the return window. */
const CLAVE_PLAZO_DEVOLUCION = "PLAZO_DEVOLUCION";

/**
 * Load the tenant return window (`PLAZO_DEVOLUCION`, in calendar days) for a
 * devolucion.
 *
 * THE DEFAULT IS THE SEED (task 1.9 = "15"), never a hardcoded fallback here:
 * a missing or expired key throws `VentaConfigError(PLAZO_DEVOLUCION_FALTANTE)`
 * BEFORE the enclosing devolucion transaction performs any write, mirroring the
 * `DESC_MAX_FALTANTE` discipline (required-keys parity).
 *
 * The validity window covers the RETURN instant `fecha`. Day-counting to the
 * identity of the window is left to the domain (`validarPlazoDevolucion`, which
 * counts Santo-Domingo calendar days); the long-dated canonical window makes the
 * instant comparison here unambiguous — same rationale as `leerConfigVentaEnTx`.
 *
 * @param fecha the return instant whose window coverage is checked.
 * @returns the window as a whole number of calendar days (> 0).
 * @throws VentaConfigError(PLAZO_DEVOLUCION_FALTANTE) when no active row covers
 *         `fecha` or the stored value is not a positive integer grammar.
 */
export async function leerPlazoDevolucionEnTx(
  tx: PrismaTx,
  empresaId: number,
  fecha: Date,
): Promise<number> {
  const row = await tx.configuracionEmpresa.findFirst({
    where: {
      empresaId,
      clave: CLAVE_PLAZO_DEVOLUCION,
      activa: true,
      vigenciaInicio: { lte: fecha },
      vigenciaFin: { gte: fecha },
    },
    // Same R-V17 deterministic tie-break as the DESC_MAX reader: overlapping
    // windows resolve to the NEWEST `vigenciaInicio`; the seed asserts zero
    // overlap so this never hides corrupted config.
    orderBy: { vigenciaInicio: "desc" },
    select: { valor: true },
  });

  if (row === null) {
    throw new VentaConfigError(PLAZO_DEVOLUCION_FALTANTE, {
      empresaId,
      clave: CLAVE_PLAZO_DEVOLUCION,
    });
  }

  const trimmed = row.valor.trim();
  // The window must parse as a strictly positive whole number of days
  // (parity with the DESC_MAX grammar; allows "15", "30", "90").
  if (!/^\d{1,3}$/.test(trimmed) || Number(trimmed) <= 0) {
    throw new VentaConfigError(PLAZO_DEVOLUCION_FALTANTE, {
      empresaId,
      clave: CLAVE_PLAZO_DEVOLUCION,
      motivo: "valor_no_entero_positivo",
    });
  }

  return Number(trimmed);
}
