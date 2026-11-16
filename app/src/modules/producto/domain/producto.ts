import type { Decimal } from "decimal.js";
import { ProductoDomainError, VIGENCIA_INVALIDA } from "./errors";

/**
 * ITBIS rate history note (feature itbis-tasas-config): the old closed
 * enumeration (0/16/18) and its validators that used to live here were
 * DELETED in slice 3g. The allowed set is DATA per empresa
 * (CONFIGURACION_EMPRESA key TASA_ITBIS) and validation happens through the
 * shared `esTasaEnLista` against that list; a rate change is a reviewed
 * config/migration change, not a code change.
 */

/**
 * Valor objeto con la tasa ITBIS aplicable a un producto y su ventana de vigencia.
 */
export interface ProductoItbis {
  /** Canonical decimal string; may be a retired rate no longer in the allowed list (S4). */
  readonly tasa: string;
  readonly vigenteDesde: Date;
  readonly vigenteHasta: Date | null;
  readonly aplicaRetencionITBIS: boolean;
}

/**
 * Entidad Producto del dominio.
 *
 * Campos como codigoBarras o unidadEmpaque existen en el modelo de BD pero no
 * son relevantes para el cálculo fiscal; el repositorio los completa con
 * valores por defecto al crear un producto. `unidadMedida` sí forma parte de la
 * entidad (se edita y se audita desde la pantalla de Productos).
 */
export interface Producto {
  readonly id: number;
  readonly empresaId: number;
  readonly categoriaId: number;
  readonly codigo: string;
  readonly nombre: string;
  readonly descripcion: string | null;
  /** Presentation unit stored on the row (Libra, Unidad, Caja...); "" if unset. */
  readonly unidadMedida: string;
  readonly precioVenta: Decimal;
  readonly itbis: ProductoItbis;
  readonly exento: boolean;
  readonly activo: boolean;
}

/**
 * Construye un ProductoItbis validando la ventana de vigencia.
 *
 * @throws {ProductoDomainError} con code VIGENCIA_INVALIDA cuando
 *   vigenteHasta < vigenteDesde (código único del catálogo domain/errors).
 */
export function buildProductoItbis(itbis: ProductoItbis): ProductoItbis {
  if (
    itbis.vigenteHasta !== null &&
    itbis.vigenteHasta.getTime() < itbis.vigenteDesde.getTime()
  ) {
    throw new ProductoDomainError(VIGENCIA_INVALIDA);
  }
  return itbis;
}

/**
 * Indica si el producto está exento de ITBIS.
 */
export function esProductoExento(itbis: ProductoItbis): boolean {
  return itbis.tasa === "0";
}
