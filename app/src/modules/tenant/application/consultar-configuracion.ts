/**
 * Application use case — `consultarConfiguracion` (screens plan Step 7, S2c/S4).
 *
 * A READ-ONLY view of the tenant parameters. It formats what the existing
 * readers already return and adds no value of its own:
 *   - retention rates pass through as the compra reader exposes them, or `null`
 *     when the tenant has them unconfigured (never a fabricated 0%);
 *   - each active NCF sequence is rendered with its range/pointer as decimal
 *     strings and `porcentajeUsado` from the pure domain rule.
 * `itbisEnUso` lists the ITBIS rates the ACTIVE products actually use (ordered
 * and flagged for today's SD business day by the pure domain); an empresa with
 * no active products gets an empty list, never an invented rate.
 */

import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { RetentionRates } from "@/modules/compra/domain/compra";
import { calcularPorcentajeUsado } from "../domain/administracion";
import { armarTasasItbisEnUso, type TasaItbisEnUso } from "../domain/itbis-en-uso";
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
  readonly itbisEnUso: readonly TasaItbisEnUso[];
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
  ahora: Date = new Date(),
): Promise<ConsultarConfiguracionResult> {
  const leida = await leerConfiguracionAdministracionEnTx(tx, empresaId);
  return {
    ok: true,
    data: {
      retenciones: leida.retenciones,
      ncf: leida.secuenciasNcf.map(toVista),
      itbisEnUso: armarTasasItbisEnUso(leida.tasasItbis, ahora),
    },
  };
}
