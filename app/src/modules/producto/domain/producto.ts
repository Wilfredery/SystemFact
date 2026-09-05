import type { Decimal } from "decimal.js";
import { ProductoDomainError, VIGENCIA_INVALIDA } from "./errors";

/**
 * Tasas ITBIS reconocidas por la DGII.
 *
 * MAINTAINER-RATIFIED DEVIATION (2026-09-04, SystemFact phase 6 review):
 * the project rule "Parameters from DB, never hardcoded constants: ITBIS rate
 * (with validity)" is deliberately NOT applied to this closed enumeration.
 * Rationale: the allowed-rate set is a closed legal set validated at compile
 * time (TypeScript union), and DGII historically ADDS rates rather than
 * renumbering existing ones — the project already anticipates 18%. What
 * actually changes with a fiscal reform — which rate each product uses and
 * its validity window — is ALREADY DB-sourced per PRODUCTO row (tasaItbis +
 * itbisVigenteDesde/itbisVigenteHasta). Parametrizing the enumeration would
 * break domain purity (async DB read on every validation) and add a failure
 * surface (missing param row blocks product creation) to guard a decadal
 * event. A future rate requires: enum + TASAS_ITBIS_VALIDAS update,
 * Prisma migration, and PARAMETRO seed — tracked in the SDD change.
 */
export type TasaItbis = "0" | "16" | "18";

/**
 * Valor objeto con la tasa ITBIS aplicable a un producto y su ventana de vigencia.
 */
export interface ProductoItbis {
  readonly tasa: TasaItbis;
  readonly vigenteDesde: Date;
  readonly vigenteHasta: Date | null;
  readonly aplicaRetencionITBIS: boolean;
}

/**
 * Entidad Producto del dominio.
 *
 * Campos como codigoBarras, unidadMedida, etc. existen en el modelo de BD pero
 * no son relevantes para el cálculo fiscal; el repositorio los completa con
 * valores por defecto al crear un producto.
 */
export interface Producto {
  readonly id: number;
  readonly empresaId: number;
  readonly categoriaId: number;
  readonly codigo: string;
  readonly nombre: string;
  readonly descripcion: string | null;
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

/**
 * Lista ordenada de tasas válidas (útil para validaciones).
 */
export const TASAS_ITBIS_VALIDAS: readonly TasaItbis[] = ["0", "16", "18"];

/**
 * Verifica si un string es una tasa ITBIS válida.
 */
export function esTasaItbisValida(value: string): value is TasaItbis {
  return (TASAS_ITBIS_VALIDAS as readonly string[]).includes(value);
}
