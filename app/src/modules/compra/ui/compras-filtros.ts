/**
 * Pure helpers of the Compras screen (screens plan Step 6, `odd/tasks/compras.md`
 * S4/S6).
 *
 * Kept outside the "use client" island on purpose: a server component importing
 * a CONSTANT from a client module receives a client reference, not the value.
 *
 * The filter option VALUES come from the frozen domain enums (`ESTADO_COMPRA`,
 * `TIPO_COMPRA`), so the screen can never drift from what the backend accepts;
 * only the display labels live here.
 */

import {
  ESTADO_COMPRA,
  TIPO_COMPRA,
  type EstadoCompraCore,
  type TipoCompra,
} from "../domain/compra";

/** Rows per page of the Compras list (AGENTS.md: 25 default, 100 max). */
export const TAMANO_PAGINA = 25;

/** Debounce of the supplier search box, shared with the other list screens. */
export const DEBOUNCE_BUSQUEDA_MS = 300;

/** The query the list action returns; decimals stay fixed-point STRINGS (S6). */
export interface CompraFila {
  readonly id: number;
  readonly correlativoInterno: string;
  readonly tipoCompra: string;
  readonly estado: string;
  readonly ncf: string | null;
  readonly total: string;
  readonly fecha: string;
  readonly proveedorNombre: string;
}

export interface ListadoCompras {
  readonly items: readonly CompraFila[];
  readonly total: number;
  readonly page: number;
}

/** `""` means "no filter": the action treats an empty value as undefined. */
export interface FiltrosCompras {
  readonly proveedorBusqueda: string;
  readonly estado: string;
  readonly tipoCompra: string;
}

const ETIQUETAS_ESTADO: Record<EstadoCompraCore, string> = {
  BORRADOR: "Borrador",
  PENDIENTE: "Pendiente",
  RECIBIDA: "Recibida",
  CANCELADA: "Cancelada",
};

const ETIQUETAS_TIPO: Record<TipoCompra, string> = {
  MERCANCIA: "Mercancía",
  SERVICIO_PROFESIONAL: "Servicio profesional",
  SERVICIO_TECNICO: "Servicio técnico",
  ALQUILER: "Alquiler",
};

const TODOS_ESTADOS = { valor: "", etiqueta: "Todos los estados" } as const;
const TODOS_TIPOS = { valor: "", etiqueta: "Todos los tipos" } as const;

export const ESTADOS_COMPRA_FILTRO: readonly { valor: string; etiqueta: string }[] = [
  TODOS_ESTADOS,
  ...Object.values(ESTADO_COMPRA).map((valor) => ({
    valor,
    etiqueta: ETIQUETAS_ESTADO[valor],
  })),
];

export const TIPOS_COMPRA_FILTRO: readonly { valor: string; etiqueta: string }[] = [
  TODOS_TIPOS,
  ...Object.values(TIPO_COMPRA).map((valor) => ({
    valor,
    etiqueta: ETIQUETAS_TIPO[valor],
  })),
];

export function etiquetaEstadoCompra(valor: string): string {
  return ETIQUETAS_ESTADO[valor as EstadoCompraCore] ?? valor;
}

export function etiquetaTipoCompra(valor: string): string {
  return ETIQUETAS_TIPO[valor as TipoCompra] ?? valor;
}

/** The action query for one page, with only the filters actually chosen. */
export function construirQueryCompras(filtros: FiltrosCompras, page: number) {
  const proveedorBusqueda = filtros.proveedorBusqueda.trim();
  return {
    page,
    limit: TAMANO_PAGINA,
    ...(filtros.estado === "" ? {} : { estado: filtros.estado }),
    ...(filtros.tipoCompra === "" ? {} : { tipoCompra: filtros.tipoCompra }),
    ...(proveedorBusqueda === "" ? {} : { proveedorBusqueda }),
  };
}
