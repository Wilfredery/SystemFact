/**
 * Sale-save contract — the composed result type for venta create/update.
 *
 * The venta DOMAIN catalog (`domain/errors.ts`, R-V13) is frozen at its 14 pinned
 * business codes and intentionally does NOT carry `DESC_MAX_FALTANTE`: that is a
 * venta-config concern owned by the config read path
 * (`infrastructure/config-repository.ts`, resolve of PR-1 flag #1). A SAVE,
 * however, can fail for either reason, so the sale-save surface composes the two
 * catalogs. Domain purity is preserved because only the application/HTTP layers
 * import the config error type — `domain/` never does.
 *
 * `messageForVentaGuardado` is the single source of truth for default copy across
 * the composed code, mirroring `messageFor` for the domain catalog.
 */

import {
  messageFor,
  type VentaErrorCode,
  type VentaResult,
  type StockWarning,
} from "../domain/errors";
import {
  DESC_MAX_FALTANTE,
  messageForVentaConfig,
  type VentaConfigErrorCode,
} from "../infrastructure/config-repository";

/** Union of the venta-domain and venta-config codes a save can return. */
export type VentaGuardadoErrorCode = VentaErrorCode | VentaConfigErrorCode;

export const ALL_GUARDADO_ERROR_CODES: readonly VentaGuardadoErrorCode[] = [
  // venta domain (R-V13)
  "VENTA_NO_ENCONTRADO",
  "VENTA_INMUTABLE",
  "CONCURRENCIA_CONFLICTO",
  "LINEAS_VACIAS",
  "LINEA_INVALIDA",
  "PRODUCTO_NO_ENCONTRADO",
  "PRODUCTO_INACTIVO",
  "TASA_ITBIS_VIGENCIA_FALTA",
  "DESCUENTO_EXCEDE_MAXIMO",
  "DESCUENTO_EXCEDE_BASE",
  "DESCUENTO_INVALIDO",
  "DESCUENTO_NO_AUTORIZADO",
  "CLIENTE_NO_ENCONTRADO",
  "CLIENTE_INACTIVO",
  // venta-config (R-C1)
  DESC_MAX_FALTANTE,
];

/** Default user copy for any composed save error code. */
export function messageForVentaGuardado(code: VentaGuardadoErrorCode): string {
  if (code === DESC_MAX_FALTANTE) return messageForVentaConfig(code);
  return messageFor(code);
}

/** A save result carrying the composed (domain ∪ config) error catalog. */
export type VentaGuardadoResult<T> =
  | { readonly ok: true; readonly data: T }
  | {
      readonly ok: false;
      readonly code: VentaGuardadoErrorCode;
      readonly message: string;
    };

/** A save result plus any non-blocking stock warnings (never flips `ok`). */
export type VentaGuardadoSaveResult<T> = VentaGuardadoResult<T> & {
  readonly warnings?: readonly StockWarning[];
};

/** Build a composed typed error from any save error code. */
export function ventaGuardadoError(code: VentaGuardadoErrorCode): {
  ok: false;
  code: VentaGuardadoErrorCode;
  message: string;
} {
  return { ok: false, code, message: messageForVentaGuardado(code) };
}

/** `VentaResult` narrowed to the domain-only catalog (lifecycle reads/cancel). */
export type { VentaResult };
