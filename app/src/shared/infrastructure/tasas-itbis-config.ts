/**
 * Reader of the per-empresa ITBIS rate list (`TASA_ITBIS`, feature
 * `itbis-tasas-config`). Uses the shared active-window seam; no caching.
 * Missing or malformed key fails loud (`TASA_ITBIS_CONFIG_FALTANTE`), never a
 * silent default.
 */

import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import {
  CLAVE_TASA_ITBIS,
  TasasItbisConfigError,
  parsearListaTasasItbis,
} from "@/shared/domain/tasas-itbis";
import { leerConfigActivaEnTx } from "@/shared/infrastructure/configuracion-empresa";

/**
 * @returns the allowed rates as canonical decimal strings, in config order.
 * @throws TasasItbisConfigError "ausente" when no active row covers `fecha`,
 *         "valor_invalido" when the stored value does not parse.
 */
export async function leerTasasItbisEnTx(
  tx: PrismaTx,
  empresaId: number,
  fecha: Date,
): Promise<readonly string[]> {
  const row = await leerConfigActivaEnTx(tx, empresaId, CLAVE_TASA_ITBIS, fecha);
  if (row === null) throw new TasasItbisConfigError("ausente");
  const parseo = parsearListaTasasItbis(row.valor);
  if (!parseo.ok) throw new TasasItbisConfigError("valor_invalido", parseo.motivo);
  return parseo.tasas;
}
