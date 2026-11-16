/**
 * The Productos screen projection (plan Step 2, S1).
 *
 * One item shape shared by the filtered listing and the single-product read that
 * prefills the edit dialog. Money and dates cross to the screen as strings
 * (Decimal(12,2) kept exact, timestamps as ISO instants) so nothing is ever a
 * float and the client island only formats for display.
 */

import { Decimal } from "decimal.js";
import { esTasaEnLista } from "@/shared/domain/tasas-itbis";
import type { ProductoConsultaFila } from "../infrastructure/producto-repository";

export interface ProductoConsultaItem {
  readonly id: number;
  readonly codigo: string;
  readonly nombre: string;
  readonly descripcion: string | null;
  readonly categoriaId: number;
  readonly categoria: string;
  readonly unidadMedida: string;
  /** Decimal(12,2)-compatible string. */
  readonly precioVenta: string;
  readonly tasaItbis: string;
  /** False when the stored rate is no longer in the company's list (retired, S4). */
  readonly tasaVigente: boolean;
  readonly itbisVigenteDesde: string;
  readonly itbisVigenteHasta: string | null;
  readonly itbisAplicaRetencionITBIS: boolean;
  readonly activo: boolean;
  /** Row version for the optimistic lock of the edit dialog. */
  readonly version: number;
}

export function mapearProductoConsulta(
  fila: ProductoConsultaFila,
  tasasPermitidas: readonly string[],
): ProductoConsultaItem {
  // A stored rate outside the list is legacy data, never an error (S4).
  const tasa = new Decimal(fila.tasaItbis).toString();
  return {
    id: fila.id,
    codigo: fila.codigo,
    nombre: fila.nombre,
    descripcion: fila.descripcion,
    categoriaId: fila.categoriaId,
    categoria: fila.categoriaNombre,
    unidadMedida: fila.unidadMedida,
    precioVenta: fila.precioVenta.toFixed(2),
    tasaItbis: tasa,
    tasaVigente: esTasaEnLista(tasa, tasasPermitidas),
    itbisVigenteDesde: fila.itbisVigenteDesde.toISOString(),
    itbisVigenteHasta:
      fila.itbisVigenteHasta === null ? null : fila.itbisVigenteHasta.toISOString(),
    itbisAplicaRetencionITBIS: fila.itbisAplicaRetencionITBIS,
    activo: fila.activo,
    version: fila.version,
  };
}
