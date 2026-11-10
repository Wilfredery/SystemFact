/**
 * Pure helpers of the Productos screen (plan Step 2).
 *
 * Kept outside the "use client" island on purpose: a server component importing
 * a CONSTANT from a client module receives a client reference, not the value.
 */

/** Rows per page of the Productos list (AGENTS.md: 25 default, 100 max). */
export const TAMANO_PAGINA = 25;

/** Debounce of the search box, shared with the shipped Inventario screen. */
export const DEBOUNCE_BUSQUEDA_MS = 300;

export type EstadoProducto = "activos" | "inactivos" | "todos";

export interface FiltrosProductos {
  readonly busqueda: string;
  readonly categoriaId: number | null;
  readonly estado: EstadoProducto;
}

export const ESTADOS_PRODUCTO: readonly { valor: EstadoProducto; etiqueta: string }[] = [
  { valor: "activos", etiqueta: "Activos" },
  { valor: "inactivos", etiqueta: "Inactivos" },
  { valor: "todos", etiqueta: "Todos los estados" },
];

/** Money input pattern of Decimal(12,2): up to 10 integers and 2 decimals. */
export const PRECIO_RE = /^\d{1,10}(\.\d{1,2})?$/;
export const MENSAJE_PRECIO_INVALIDO =
  "Monto inválido (máx 10 enteros y 2 decimales). Use punto decimal.";

export function esPrecioValido(texto: string): boolean {
  return PRECIO_RE.test(texto.trim());
}

/** The action query for one page, with only the filters actually chosen. */
export function construirQueryProductos(filtros: FiltrosProductos, page: number) {
  const busqueda = filtros.busqueda.trim();
  return {
    page,
    limit: TAMANO_PAGINA,
    estado: filtros.estado,
    ...(busqueda === "" ? {} : { busqueda }),
    ...(filtros.categoriaId === null ? {} : { categoriaId: filtros.categoriaId }),
  };
}
