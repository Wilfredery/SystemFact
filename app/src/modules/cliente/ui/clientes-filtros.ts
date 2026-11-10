/**
 * Pure helpers of the Clientes screen (screens plan Step 3).
 *
 * Kept outside the "use client" island on purpose: a server component importing
 * a CONSTANT from a client module receives a client reference, not the value.
 */

/** Rows per page of the Clientes list (AGENTS.md: 25 default, 100 max). */
export const TAMANO_PAGINA = 25;

/** Debounce of the search box, shared with the Inventario/Productos screens. */
export const DEBOUNCE_BUSQUEDA_MS = 300;

export type EstadoCliente = "activos" | "inactivos" | "todos";

export interface FiltrosClientes {
  readonly busqueda: string;
  readonly estado: EstadoCliente;
}

export const ESTADOS_CLIENTE: readonly { valor: EstadoCliente; etiqueta: string }[] = [
  { valor: "activos", etiqueta: "Activos" },
  { valor: "inactivos", etiqueta: "Inactivos" },
  { valor: "todos", etiqueta: "Todos los estados" },
];

/** Fiscal classification, labelled for the screen (values are the frozen enum). */
export const TIPOS_CLIENTE: readonly { valor: string; etiqueta: string }[] = [
  { valor: "MINORISTA", etiqueta: "Minorista" },
  { valor: "MAYORISTA", etiqueta: "Mayorista" },
  { valor: "CREDITO", etiqueta: "Crédito" },
];

export function etiquetaTipoCliente(valor: string): string {
  return TIPOS_CLIENTE.find((t) => t.valor === valor)?.etiqueta ?? valor;
}

/** Money input pattern of Decimal(12,2): up to 10 integers and 2 decimals. */
export const MONTO_RE = /^\d{1,10}(\.\d{1,2})?$/;
export const MENSAJE_MONTO_INVALIDO =
  "Monto inválido (máx 10 enteros y 2 decimales). Use punto decimal.";

export function esMontoValido(texto: string): boolean {
  return MONTO_RE.test(texto.trim());
}

/** Credit term in days: a positive integer (the domain rejects 0). */
export function esPlazoValido(texto: string): boolean {
  const n = Number(texto.trim());
  return texto.trim() !== "" && Number.isInteger(n) && n >= 1;
}

/** The action query for one page, with only the filters actually chosen. */
export function construirQueryClientes(filtros: FiltrosClientes, page: number) {
  const busqueda = filtros.busqueda.trim();
  return {
    page,
    limit: TAMANO_PAGINA,
    estado: filtros.estado,
    ...(busqueda === "" ? {} : { buscar: busqueda }),
  };
}
