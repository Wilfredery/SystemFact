/**
 * Auditoria table — SERVER component (Slice D, task 4.2; AC-2 / AC-3 / AC-5).
 *
 * A pure server-rendered table over the `AuditoriaPagina` the read use case returns.
 * It has NO state and NO `"use client"`: it only projects the already-fetched DTO.
 * The rows arrive from `consultarAuditoriaEnTx` already ordered `fechaHora DESC,
 * id DESC` (newest-first), so the table renders them AS-IS and never re-sorts.
 *
 * Read-ONLY by construction (AC-5): every interactive affordance here is a NAVIGATION
 * `<Link>` to another server page — there is no button, form or handler that could
 * create/update/delete an audit row, which is the whole point of the guard test that
 * asserts "no mutation controls ever rendered". The date column renders the stored UTC
 * instant in Santo-Domingo wall-clock (AGENTS.md dates convention) via `./format`.
 *
 * Pagination is the cobros-style control (Anterior / Siguiente + "Página X de Y"):
 * the total matching the ACTIVE filter is always shown (AC-2) and a page past the last
 * simply renders an empty body rather than an error (AC-2).
 */

import Link from "next/link";
import type {
  AuditoriaPagina,
  AuditoriaFiltroEntrada,
} from "../domain/auditoria";
import {
  ETIQUETA_ACCION,
  detalleFila,
  formatearFechaHoraSD,
  tonoAccion,
} from "./format";
import { construirHref } from "./url";

const CABECERA = [
  "Fecha y hora",
  "Usuario",
  "Sucursal",
  "Acción",
  "Detalle",
] as const;

export function AuditTable({
  pagina,
  filtro,
}: {
  readonly pagina: AuditoriaPagina;
  readonly filtro: AuditoriaFiltroEntrada;
}) {
  const { filas, total, page, totalPages } = pagina;
  const hayPaginacion = totalPages > 1;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        <span data-testid="auditoria-total">{total}</span>{" "}
        {total === 1 ? "movimiento coincide" : "movimientos coinciden"}
      </p>

      {filas.length === 0 ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Sin movimientos que coincidan con los filtros.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800">
                {CABECERA.map((c) => (
                  <th key={c} className="px-3 py-2 font-medium">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => {
                const detalle = detalleFila(f);
                return (
                  <tr
                    key={f.id}
                    data-testid={`auditoria-fila-${f.id}`}
                    className="border-b border-zinc-100 last:border-0 align-top dark:border-zinc-800"
                  >
                    <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-zinc-700 dark:text-zinc-300">
                      {formatearFechaHoraSD(f.fechaHora)}
                    </td>
                    <td className="px-3 py-2 text-zinc-700 dark:text-zinc-300">
                      #{f.usuarioId}
                    </td>
                    <td className="px-3 py-2 text-zinc-700 dark:text-zinc-300">
                      {f.sucursalId === null ? (
                        <span className="text-zinc-400" title="Sin sucursal (evento a nivel empresa)">
                          Empresa
                        </span>
                      ) : (
                        <>#{f.sucursalId}</>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`rounded px-1.5 py-0.5 text-xs font-medium ${tonoAccion(f.accion)}`}
                      >
                        {ETIQUETA_ACCION[f.accion]}
                      </span>
                    </td>
                    <td
                      className="max-w-xs truncate px-3 py-2 text-zinc-600 dark:text-zinc-400"
                      title={detalle}
                    >
                      {detalle}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {hayPaginacion && (
        <nav
          aria-label="Paginación de auditoría"
          className="flex items-center justify-between gap-2 text-xs"
        >
          {page > 1 ? (
            <Link
              href={construirHref(filtro, page - 1)}
              aria-label="Página anterior"
              className="rounded border border-zinc-300 px-2 py-1 text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              Anterior
            </Link>
          ) : (
            <span
              aria-disabled="true"
              className="rounded border border-zinc-200 px-2 py-1 text-zinc-400 opacity-40 dark:border-zinc-800"
            >
              Anterior
            </span>
          )}
          <span className="text-zinc-500">
            Página {page} de {totalPages}
          </span>
          {page < totalPages ? (
            <Link
              href={construirHref(filtro, page + 1)}
              aria-label="Página siguiente"
              className="rounded border border-zinc-300 px-2 py-1 text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              Siguiente
            </Link>
          ) : (
            <span
              aria-disabled="true"
              className="rounded border border-zinc-200 px-2 py-1 text-zinc-400 opacity-40 dark:border-zinc-800"
            >
              Siguiente
            </span>
          )}
        </nav>
      )}
    </div>
  );
}
