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
 *
 * Names (Board 09 slice B): the Usuario cell shows `nombreUsuario` with the person's full
 * `nombre` in `title`; the Sucursal cell shows the branch `nombre` (`Empresa` stays for a
 * NULL branch). A name that could not be resolved falls back to `#<id>`, never blank.
 */

import Link from "next/link";
import type {
  AuditoriaPagina,
  AuditoriaFiltroEntrada,
} from "../domain/auditoria";
import { formatearFechaHoraSD } from "@/shared/ui/format";
import { ETIQUETA_ACCION, detalleFila, tonoAccion } from "./format";
import { construirHref } from "./url";

const CABECERA = [
  "Fecha-Hora",
  "Usuario",
  "Acción",
  "Entidad",
  "Sucursal",
  "Detalle",
] as const;

const NOTA_PIE = "Registro de auditoría — Solo lectura · Inmutable (append-only)";

const CLASE_PAGINA_ACTIVA =
  "inline-flex min-h-11 items-center rounded-md border border-line px-3 text-ink";
const CLASE_PAGINA_INACTIVA =
  "inline-flex min-h-11 items-center rounded-md border border-line px-3 text-ink-muted opacity-40";

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
      <p className="text-sm text-ink-muted">
        <span data-testid="auditoria-total">{total}</span>{" "}
        {total === 1 ? "movimiento coincide" : "movimientos coinciden"}
      </p>

      {filas.length === 0 ? (
        <p className="text-sm text-ink-muted">
          Sin movimientos que coincidan con los filtros.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-line bg-surface-muted text-xs uppercase tracking-wide text-ink-muted">
                {CABECERA.map((c) => (
                  <th key={c} scope="col" className="px-3 py-2 font-medium">
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
                    className="border-b border-line last:border-0 align-top"
                  >
                    <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-ink">
                      {formatearFechaHoraSD(f.fechaHora)}
                    </td>
                    <td className="px-3 py-2 text-ink">
                      {f.usuario === null ? (
                        <>#{f.usuarioId}</>
                      ) : (
                        <span title={f.usuario.nombre}>{f.usuario.nombreUsuario}</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`rounded px-1.5 py-0.5 text-xs font-medium ${tonoAccion(f.accion)}`}
                      >
                        {ETIQUETA_ACCION[f.accion]}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-ink">{f.entidad}</td>
                    <td className="px-3 py-2 text-ink">
                      {f.sucursalId === null ? (
                        <span className="text-ink-muted" title="Sin sucursal (evento a nivel empresa)">
                          Empresa
                        </span>
                      ) : f.sucursal === null ? (
                        <>#{f.sucursalId}</>
                      ) : (
                        <>{f.sucursal.nombre}</>
                      )}
                    </td>
                    <td
                      className="max-w-xs truncate px-3 py-2 text-ink-muted"
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
              className={CLASE_PAGINA_ACTIVA}
            >
              Anterior
            </Link>
          ) : (
            <span
              aria-disabled="true"
              className={CLASE_PAGINA_INACTIVA}
            >
              Anterior
            </span>
          )}
          <span className="text-ink-muted">
            Página {page} de {totalPages}
          </span>
          {page < totalPages ? (
            <Link
              href={construirHref(filtro, page + 1)}
              aria-label="Página siguiente"
              className={CLASE_PAGINA_ACTIVA}
            >
              Siguiente
            </Link>
          ) : (
            <span
              aria-disabled="true"
              className={CLASE_PAGINA_INACTIVA}
            >
              Siguiente
            </span>
          )}
        </nav>
      )}

      <p className="text-xs text-ink-muted">{NOTA_PIE}</p>
    </div>
  );
}
