/**
 * Application use case — `consultarConfiguracion` (screens plan Step 7, S2c/S4).
 *
 * A READ-ONLY view of the tenant parameters. It formats what the existing
 * readers already return and adds no value of its own:
 *   - retention rates pass through as the compra reader exposes them, or `null`
 *     when the tenant has them unconfigured (never a fabricated 0%);
 *   - each active NCF sequence is rendered with its range/pointer as decimal
 *     strings and `porcentajeUsado` from the pure domain rule.
 * ITBIS rates are NOT part of the output: no existing tenant reader exposes
 * them (see `infrastructure/administracion-config-repository.ts`), and this
 * layer must not invent data. The gap is tracked in odd/tasks/administracion.md.
 */

import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { RetentionRates } from "@/modules/compra/domain/compra";
import { calcularPorcentajeUsado } from "../domain/administracion";
import {
  leerConfiguracionAdministracionEnTx,
  type SecuenciaNcfLeida,
} from "../infrastructure/administracion-config-repository";

/** One NCF sequence row as the screen consumes it (BIGINT as decimal string). */
export interface SecuenciaNcfAdministracion {
  readonly tipo: string;
  readonly rangoInicio: string;
  readonly rangoFin: string;
  readonly secuenciaActual: string;
  readonly vigenciaFin: string;
  readonly porcentajeUsado: number;
}

export interface ConfiguracionAdministracion {
  readonly retenciones: RetentionRates | null;
  readonly ncf: readonly SecuenciaNcfAdministracion[];
}

export type ConsultarConfiguracionResult = {
  ok: true;
  data: ConfiguracionAdministracion;
};

function toVista(fila: SecuenciaNcfLeida): SecuenciaNcfAdministracion {
  return {
    tipo: fila.tipo,
    rangoInicio: fila.rangoInicio.toString(),
    rangoFin: fila.rangoFin.toString(),
    secuenciaActual: fila.secuenciaActual.toString(),
    vigenciaFin: fila.vigenciaFin.toISOString(),
    porcentajeUsado: calcularPorcentajeUsado(fila),
  };
}

/**
 * Reads the Configuración view for the SESSION empresa. Scope is the caller's
 * `empresaId` only — this surface accepts no empresa/sucursal parameter.
 */
export async function consultarConfiguracion(
  tx: PrismaTx,
  empresaId: number,
): Promise<ConsultarConfiguracionResult> {
  const leida = await leerConfiguracionAdministracionEnTx(tx, empresaId);
  return {
    ok: true,
    data: {
      retenciones: leida.retenciones,
      ncf: leida.secuenciasNcf.map(toVista),
    },
  };
}
