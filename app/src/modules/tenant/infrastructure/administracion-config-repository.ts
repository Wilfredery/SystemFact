/**
 * Tenant read adapter — the Configuración tab's data, COMPOSED from the already
 * existing tenant readers (screens plan Step 7, S4). No new query and no new
 * business rule: this file exists so `application/` and `http/` never import
 * another module's infrastructure directly and never touch Prisma themselves.
 *
 * What it can honestly expose today, and why:
 *   - Retentions: compra's `leerTasasRetencionEnTx` (the retention reader). That
 *     reader HARD-FAILS with `CONFIG_RETENCION_FALTANTE` when a required key is
 *     missing/expired/non-numeric, which is the right behaviour before a
 *     purchase but wrong for a read-only view — here the gap is translated to
 *     `null` ("no configurada"), never to an invented 0%.
 *   - NCF sequences: the ncf module's only read, `bloquearSecuenciaActivaEnTx`.
 *     It takes a `FOR UPDATE` row lock because a sale consumes the sequence
 *     under that lock; reusing it keeps ONE reading of `NCF_SECUENCIA` instead
 *     of a second copy of the query in this module. The lock lives only for the
 *     duration of this read-only transaction (released at commit).
 *   - ITBIS rates IN USE: ONE `groupBy` over the empresa's ACTIVE products by
 *     `tasaItbis` + validity window (`venta` validates the per-product rate the
 *     same way; there is no `TASA_ITBIS` config key). Pure SQL aggregation, no
 *     per-product loop; the rate stays a string (administracion-itbis S2/S3).
 */

import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { RetentionRates } from "@/modules/compra/domain/compra";
import { RETENCION_CLAVES } from "@/modules/compra/domain/calculators";
import {
  CONFIG_RETENCION_FALTANTE,
  CompraDomainError,
} from "@/modules/compra/domain/errors";
import { leerTasasRetencionEnTx } from "@/modules/compra/infrastructure/configuracion-repository";
import type { TasaItbisEnUsoLeida } from "@/modules/tenant/domain/itbis-en-uso";
import type { TipoNcf } from "@/modules/ncf/domain/ncf-rules";
import { bloquearSecuenciaActivaEnTx } from "@/modules/ncf/infrastructure/ncf-repository";

/**
 * The sequence types the Configuración tab shows (S2c: B01/B02/B04). The
 * element type is the ncf domain union, so a rename/add on that side breaks
 * this list at compile time; B03/B11 are simply not part of the wireframe.
 */
export const TIPOS_NCF_ADMINISTRACION = [
  "B01",
  "B02",
  "B04",
] as const satisfies readonly TipoNcf[];

/** Every retention key, in one place: the compra domain's own catalog. */
const CLAVES_RETENCION = Object.values(RETENCION_CLAVES);

/** One active NCF sequence row, exactly as the ncf reader returns it. */
export interface SecuenciaNcfLeida {
  readonly tipo: TipoNcf;
  readonly rangoInicio: bigint;
  readonly rangoFin: bigint;
  readonly secuenciaActual: bigint;
  readonly vigenciaFin: Date;
}

/** Raw read of the Configuración tab; formatting belongs to the use case. */
export interface ConfiguracionAdministracionLeida {
  readonly retenciones: RetentionRates | null;
  readonly secuenciasNcf: readonly SecuenciaNcfLeida[];
  readonly tasasItbis: readonly TasaItbisEnUsoLeida[];
}

/**
 * The distinct ITBIS rate + validity window groups of the empresa's ACTIVE
 * products with their product count. `empresaId` is pinned explicitly on top of
 * RLS; the Decimal is rendered with the stored `Decimal(12,2)` scale.
 */
export async function leerTasasItbisEnUsoEnTx(
  tx: PrismaTx,
  empresaId: number,
): Promise<TasaItbisEnUsoLeida[]> {
  const grupos = await tx.producto.groupBy({
    by: ["tasaItbis", "itbisVigenteDesde", "itbisVigenteHasta"],
    where: { empresaId, activo: true },
    _count: { _all: true },
  });
  return grupos.map((g) => ({
    tasaItbis: g.tasaItbis.toFixed(2),
    vigenteDesde: g.itbisVigenteDesde,
    vigenteHasta: g.itbisVigenteHasta,
    productos: g._count._all,
  }));
}

/**
 * The retention rates, or `null` when the tenant has not configured them (the
 * compra reader's stable `CONFIG_RETENCION_FALTANTE` signal). Any other error is
 * a defect and propagates untouched.
 */
async function leerRetenciones(
  tx: PrismaTx,
  empresaId: number,
): Promise<RetentionRates | null> {
  try {
    return await leerTasasRetencionEnTx(tx, empresaId, CLAVES_RETENCION);
  } catch (err) {
    if (err instanceof CompraDomainError && err.code === CONFIG_RETENCION_FALTANTE) {
      return null;
    }
    throw err;
  }
}

/**
 * Reads the whole Configuración view inside the caller's `withTenantTransaction`
 * (RLS in force; `empresaId` from the session context only). A type without an
 * ACTIVE sequence is simply absent from `secuenciasNcf` — the screen shows the
 * types that exist, never a fabricated range.
 */
export async function leerConfiguracionAdministracionEnTx(
  tx: PrismaTx,
  empresaId: number,
): Promise<ConfiguracionAdministracionLeida> {
  const retenciones = await leerRetenciones(tx, empresaId);

  const secuenciasNcf: SecuenciaNcfLeida[] = [];
  for (const tipo of TIPOS_NCF_ADMINISTRACION) {
    const fila = await bloquearSecuenciaActivaEnTx(tx, empresaId, tipo);
    if (fila === null) continue;
    secuenciasNcf.push({
      tipo,
      rangoInicio: fila.rangoInicio,
      rangoFin: fila.rangoFin,
      secuenciaActual: fila.secuenciaActual,
      vigenciaFin: fila.vigenciaFin,
    });
  }

  const tasasItbis = await leerTasasItbisEnUsoEnTx(tx, empresaId);

  return { retenciones, secuenciasNcf, tasasItbis };
}
