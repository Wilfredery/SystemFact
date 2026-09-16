/**
 * Auditoria UI — URL ↔ filter mapping (Slice D, task 4.1).
 *
 * The consultation is server-rendered: the App Router page reads `searchParams`,
 * maps them into the pure {@link AuditoriaFiltroEntrada} the use case consumes,
 * and the table builds navigation hrefs back out of the active filter. Keeping the
 * two directions here (rather than inline in the components) lets a page render, a
 * client filter form and the pagination links share ONE source of truth for the
 * querystring shape — no ad-hoc string building scattered across the UI.
 *
 * Pure module: no React, no Next.js runtime, no Prisma. The `searchParams` value it
 * accepts is the plain `string | string[] | undefined` shape Next hands to a server
 * component, so the mapping stays trivially unit-testable.
 */

import type { AuditoriaFiltroEntrada } from "../domain/auditoria";

/** The `searchParams` object shape Next 16 passes to a server page (already awaited). */
export type SearchParamsInput = Record<
  string,
  string | string[] | undefined
>;

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
 * Map URL search params onto the transport-shaped {@link AuditoriaFiltroEntrada} the
 * use case normalises. Absent/blank facets are omitted so `normalizarFiltro` treats
 * them as "no filter"; only a non-empty unknown `accion` or malformed date reaches
 * the domain validation and surfaces `AUDITORIA_VALIDACION`. `pageSize` is
 * intentionally NOT sourced from the URL — the consultation runs at the fixed
 * default (25/page), so the only mutable navigation dimension is `page`.
 */
export function filtroDesdeSearchParams(
  sp: SearchParamsInput,
): AuditoriaFiltroEntrada {
  // Mutable accumulator — the DTO is readonly, so we build a plain object and return
  // it typed as `AuditoriaFiltroEntrada`.
  const entrada: {
    accion?: string;
    usuarioId?: number;
    sucursalId?: number;
    desde?: string;
    hasta?: string;
    texto?: string;
    page?: number;
  } = {};

  const accion = primero(sp.accion);
  if (accion !== undefined && accion !== "") entrada.accion = accion;

  const usuarioId = enteroPositivo(primero(sp.usuarioId));
  if (usuarioId !== undefined) entrada.usuarioId = usuarioId;

  const sucursalId = enteroPositivo(primero(sp.sucursalId));
  if (sucursalId !== undefined) entrada.sucursalId = sucursalId;

  const desde = primero(sp.desde);
  if (desde !== undefined && desde !== "") entrada.desde = desde;

  const hasta = primero(sp.hasta);
  if (hasta !== undefined && hasta !== "") entrada.hasta = hasta;

  const texto = primero(sp.texto);
  if (texto !== undefined && texto !== "") entrada.texto = texto;

  const page = enteroPositivo(primero(sp.page));
  if (page !== undefined) entrada.page = page;

  return entrada;
}

/**
 * Build a `/auditoria` href that PRESERVES the active filters and overrides only the
 * page. Page 1 drops the `page` param (the default), so the base URL is clean; every
 * later page carries `page=N`. This is the server-side pagination primitive the table
 * links to (a page beyond the last simply renders an empty table — AC-2, not an error).
 */
export function construirHref(
  filtro: AuditoriaFiltroEntrada,
  page: number,
): string {
  const p = new URLSearchParams();
  const set = (clave: string, valor: string | number | null | undefined): void => {
    if (valor === undefined || valor === null || valor === "") return;
    p.set(clave, String(valor));
  };
  set("accion", filtro.accion);
  set("usuarioId", filtro.usuarioId);
  set("sucursalId", filtro.sucursalId);
  set("desde", filtro.desde);
  set("hasta", filtro.hasta);
  set("texto", filtro.texto);
  if (page > 1) p.set("page", String(page));

  const qs = p.toString();
  return qs === "" ? "/auditoria" : `/auditoria?${qs}`;
}
