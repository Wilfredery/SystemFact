/**
 * Pure helpers of the Administración screen (screens plan Step 7,
 * `odd/tasks/administracion.md` S2/S6).
 *
 * Kept outside the `"use client"` island on purpose: a server component
 * importing a CONSTANT from a client module receives a client reference, not
 * the value (the learned bug recorded in the Compras/Clientes filter modules).
 *
 * The tab values and the tri-state `activo` spelling are the URL contract the
 * server page validates; the action re-validates the same spelling in
 * `tenant/http/validations.ts` (it deliberately does NOT coerce "false" as a
 * boolean, which would silently mean `true`).
 */

/** Rows per page of the Usuarios list (AGENTS.md: 25 default, 100 max). */
export const TAMANO_PAGINA = 25;

/** Debounce of the user search box, shared with the other list screens. */
export const DEBOUNCE_BUSQUEDA_MS = 300;

export type TabAdministracion = "usuarios" | "sucursales" | "configuracion";

export const TAB_ADMINISTRACION_DEFAULT: TabAdministracion = "usuarios";

/** Wireframe 08 labels, in board order (S2). */
export const TABS_ADMINISTRACION: readonly {
  valor: TabAdministracion;
  etiqueta: string;
}[] = [
  { valor: "usuarios", etiqueta: "Usuarios" },
  { valor: "sucursales", etiqueta: "Sucursales" },
  { valor: "configuracion", etiqueta: "Configuración" },
];

/** Only a known tab may reach the read action: no free strings. */
export function tabDesdeParam(valor: string): TabAdministracion {
  return TABS_ADMINISTRACION.find((t) => t.valor === valor)?.valor ?? TAB_ADMINISTRACION_DEFAULT;
}

export type ActivoParam = "" | "true" | "false";

/** Tri-state `activo`: `""` = all users, otherwise the two URL spellings. */
export function activoDesdeParam(valor: string): ActivoParam {
  return valor === "true" || valor === "false" ? valor : "";
}

export interface FiltrosUsuarios {
  readonly busqueda: string;
  readonly activo: ActivoParam;
}

export const FILTROS_ACTIVO: readonly { valor: ActivoParam; etiqueta: string }[] = [
  { valor: "", etiqueta: "Todos" },
  { valor: "true", etiqueta: "Activos" },
  { valor: "false", etiqueta: "Inactivos" },
];

/**
 * The action query for one page, with only the filters actually chosen. The
 * tri-state stays explicit: `activo` is a real boolean (or absent), never a
 * string the transport might coerce truthily.
 */
export function construirQueryUsuarios(filtros: FiltrosUsuarios, page: number) {
  const buscar = filtros.busqueda.trim();
  return {
    page,
    pageSize: TAMANO_PAGINA,
    ...(buscar === "" ? {} : { buscar }),
    ...(filtros.activo === "" ? {} : { activo: filtros.activo === "true" }),
  };
}

/**
 * `/administracion` URL for a tab, keeping the filters the user had chosen and
 * dropping the defaults so the URL stays readable. Tab switching is a server
 * navigation: the island pushes this and never loads another tab's data itself.
 */
export function construirHrefAdministracion(
  tab: TabAdministracion,
  filtros: FiltrosUsuarios,
  page: number,
): string {
  const params = new URLSearchParams();
  params.set("tab", tab);
  const buscar = filtros.busqueda.trim();
  if (buscar !== "") params.set("busqueda", buscar);
  if (filtros.activo !== "") params.set("activo", filtros.activo);
  if (page > 1) params.set("page", String(page));
  return `/administracion?${params.toString()}`;
}
