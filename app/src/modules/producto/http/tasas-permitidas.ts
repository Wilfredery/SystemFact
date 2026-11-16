import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import { TasasItbisConfigError } from "@/shared/domain/tasas-itbis";
import { leerTasasItbisEnTx } from "@/shared/infrastructure/tasas-itbis-config";

/**
 * Reads the per-empresa rate list inside the caller's tenant transaction.
 * A missing or malformed key is a typed failure (null), never a default and
 * never an internal error leaked to the client; any other error propagates.
 */
export async function leerTasasPermitidasEnTx(
  tx: PrismaTx,
  empresaId: number,
): Promise<readonly string[] | null> {
  try {
    return await leerTasasItbisEnTx(tx, empresaId, new Date());
  } catch (err) {
    if (err instanceof TasasItbisConfigError) return null;
    throw err;
  }
}
