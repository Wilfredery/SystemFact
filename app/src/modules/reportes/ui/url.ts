/**
 * Reportes UI — URL ↔ filter mapping (the stable deep-link contract, DB-5 / EXP-5).
 *
 * `/reportes?reporte=<catalog>&desde=YYYY-MM-DD&hasta=YYYY-MM-DD&sucursalId=<id>&page=<n>&pageSize=<n>`
 * is the frozen URL contract (design "stable URL contract"). The `/reportes` server page
 * reads `searchParams`, maps them here onto the transport-shaped {@link ReporteFiltroEntrada}
 * the use case normalises, and the selector builds navigation hrefs back out of the active
 * selection — ONE source of truth for the querystring shape, no ad-hoc string building.
 *
 * Pure module: no React, no Next runtime, no Prisma. `searchParams` is the plain
 * `string | string[] | undefined` shape Next hands a server component, so the mapping is
 * trivially unit-testable. An unknown `?reporte=` is dropped (via {@link esReporteId}) so a
 * typo never reaches an action.
 */

import type { ReporteFiltroEntrada } from "../domain/reporte-filtro";
import { esReporteId, REPORTE_ID, type ReporteId } from "../domain/catalogo";

/** The `searchParams` object shape Next 16 passes to a server page (already awaited). */
export type SearchParamsInput = Record<string, string | string[] | undefined>;

/** The full deep-link selection: the transport filter PLUS the active report id. */
export interface SeleccionReporte {
  readonly reporte: ReporteId;
  readonly filtro: ReporteFiltroEntrada;
}

/** Collapse a possibly-multi-valued param to its first entry (`undefined` when absent). */
function primero(valor: string | string[] | undefined): string | undefined {
  if (Array.isArray(valor)) return valor[0];
  return valor;
}

/** Positive-integer parser for a locator/page param; anything else → `undefined`. */
function enteroPositivo(valor: string | undefined): number | undefined {
  if (valor === undefined || valor === "") return undefined;
  const n = Number(valor);
  return Number.isInteger(n) && n >= 1 ? n : undefined;
}

/**
 * Map URL search params onto the transport-shaped selection the use case normalises. An
 * absent/invalid `reporte` falls back to the DASHBOARD (the home tile); absent/blank filter
 * facets are omitted so `normalizarFiltro` treats them as "no filter". `pageSize` IS sourced
 * from the URL here (the reportes shell exposes it for deep links), and is clamped
 * downstream to 100 by the domain, never rejected.
 */
export function seleccionDesdeSearchParams(sp: SearchParamsInput): SeleccionReporte {
  const rawReporte = primero(sp.reporte);
  const reporte: ReporteId = esReporteId(rawReporte) ? rawReporte : REPORTE_ID.DASHBOARD;

  const filtro: {
    desde?: string;
    hasta?: string;
    preset?: string;
    sucursalId?: number;
    page?: number;
    pageSize?: number;
  } = {};

  const desde = primero(sp.desde);
  if (desde !== undefined && desde !== "") filtro.desde = desde;

  const hasta = primero(sp.hasta);
  if (hasta !== undefined && hasta !== "") filtro.hasta = hasta;

  const preset = primero(sp.preset);
  if (preset !== undefined && preset !== "") filtro.preset = preset;

  const sucursalId = enteroPositivo(primero(sp.sucursalId));
  if (sucursalId !== undefined) filtro.sucursalId = sucursalId;

  const page = enteroPositivo(primero(sp.page));
  if (page !== undefined) filtro.page = page;

  const pageSize = enteroPositivo(primero(sp.pageSize));
  if (pageSize !== undefined) filtro.pageSize = pageSize;

  return { reporte, filtro };
}

/**
 * Build a `/reportes` href that PRESERVES the active report + filters and overrides only the
 * given page (page 1 drops `page`, so the base URL stays clean). This is the navigation
 * primitive the pagination links use; it is the exact inverse of
 * {@link seleccionDesdeSearchParams} for the filter dimensions, so a deep-link round-trips.
 */
export function construirHref(
  seleccion: SeleccionReporte,
  overrides: { readonly page?: number } = {},
): string {
  const p = new URLSearchParams();
  const poner = (clave: string, valor: string | number | null | undefined): void => {
    if (valor === undefined || valor === null || valor === "") return;
    p.set(clave, String(valor));
  };
  poner("reporte", seleccion.reporte);
  poner("desde", seleccion.filtro.desde);
  poner("hasta", seleccion.filtro.hasta);
  poner("preset", seleccion.filtro.preset);
  poner("sucursalId", seleccion.filtro.sucursalId);
  poner("pageSize", seleccion.filtro.pageSize);
  // `page` defaults to 1 (the base URL stays clean); page 1 drops the param.
  const page = overrides.page ?? seleccion.filtro.page ?? 1;
  if (page > 1) p.set("page", String(page));

  const qs = p.toString();
  return qs === "" ? "/reportes" : `/reportes?${qs}`;
}
