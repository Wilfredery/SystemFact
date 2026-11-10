/**
 * Pure helpers of the Proveedores screen (screens plan Step 4).
 *
 * Kept outside the "use client" island on purpose: a server component importing
 * a CONSTANT from a client module receives a client reference, not the value.
 */

/** Rows per page of the Proveedores list (AGENTS.md: 25 default, 100 max). */
export const TAMANO_PAGINA = 25;

/** Debounce of the search box, shared with the other list screens. */
export const DEBOUNCE_BUSQUEDA_MS = 300;

/**
 * The list action offers active-only (default) or active+inactive, so the filter
 * exposes exactly what the backend supports: no "inactive only" option is drawn
 * that the query cannot answer.
 */
export type EstadoProveedor = "activos" | "todos";

export interface FiltrosProveedores {
  readonly busqueda: string;
  readonly estado: EstadoProveedor;
}

export const ESTADOS_PROVEEDOR: readonly { valor: EstadoProveedor; etiqueta: string }[] = [
  { valor: "activos", etiqueta: "Activos" },
  { valor: "todos", etiqueta: "Todos los estados" },
];

/** Fiscal classification, labelled for the screen (values are the frozen enum). */
export const TIPOS_PROVEEDOR: readonly { valor: string; etiqueta: string }[] = [
  { valor: "FORMAL", etiqueta: "Formal" },
  { valor: "INFORMAL", etiqueta: "Informal" },
];

export const TIPOS_PERSONA: readonly { valor: string; etiqueta: string }[] = [
  { valor: "FISICA", etiqueta: "Física" },
  { valor: "JURIDICA", etiqueta: "Jurídica" },
];

export function etiquetaTipoProveedor(valor: string): string {
  return TIPOS_PROVEEDOR.find((t) => t.valor === valor)?.etiqueta ?? valor;
}

export function etiquetaTipoPersona(valor: string): string {
  return TIPOS_PERSONA.find((t) => t.valor === valor)?.etiqueta ?? valor;
}

/**
 * The RNC rule the DOMAIN owns (`normalizeRnc`): separators are stripped and
 * what remains must be 9–11 digits. A blank value is legitimate (informal
 * supplier, stored as null). The form stops exactly what the server would
 * refuse, no stricter and no looser.
 */
export function esRncValido(texto: string): boolean {
  const digitos = texto.trim().replace(/[\s.-]/g, "");
  return /^\d+$/.test(digitos) && digitos.length >= 9 && digitos.length <= 11;
}

/** The action query for one page, with only the filters actually chosen. */
export function construirQueryProveedores(
  filtros: FiltrosProveedores,
  page: number,
) {
  const busqueda = filtros.busqueda.trim();
  return {
    page,
    limit: TAMANO_PAGINA,
    incluirInactivos: filtros.estado === "todos",
    ...(busqueda === "" ? {} : { buscar: busqueda }),
  };
}
