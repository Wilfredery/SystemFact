/**
 * Compras UI — the read-only CxP (cuentas por pagar) panel (odd/tasks/compras.md,
 * T4: S8; FIN-4).
 *
 * A pure SERVER presentational component mirroring the reportes financial panel:
 * it renders the `Pagina<CxpFila>` that `consultarCxPAction` already returned —
 * rows, the page-independent Decimal summary strip, the empty state and LINK
 * pagination. It holds no data, issues no query and contains NO authorization
 * logic: the route only reaches it after the Administrador gate and the report's
 * own server-side role check (FIN-3), and the view is READ-ONLY by construction —
 * there is no payment-creation surface here (S8, YAGNI).
 *
 * The row type is DERIVED from the action's return contract, so this screen can
 * never drift from the shape the report module publishes (no hand-copied model).
 *
 * S6: every monetary figure is the fixed-point STRING the action returned and is
 * only formatted for display (`formatearMonto`); `fechaSD` is already a bare SD
 * calendar date and goes through the shared bare-date path.
 */

import type { consultarCxPAction } from "@/modules/reportes/http/actions.lectura";
import { formatearMonto } from "@/shared/ui/format/money";
import { formatearFechaSD } from "@/shared/ui/format/date";
import { etiquetaEstadoCompra } from "./compras-filtros";

/** The page of open payables the report action returns. */
type PaginaCxP = Extract<
  Awaited<ReturnType<typeof consultarCxPAction>>,
  { ok: true }
>["data"];

const TH = "px-4 py-2 text-xs uppercase";
const TH_R = `${TH} text-right`;
const TD = "px-4 py-2";
const TD_R = `${TD} tabular-nums`;
const ENLACE =
  "inline-flex items-center rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 dark:border-zinc-700 dark:text-zinc-300";

export function CxpPanel({
  pagina,
  hrefPagina,
}: {
  readonly pagina: PaginaCxP;
  /** The route builds the link so this panel stays free of URL knowledge. */
  readonly hrefPagina: (page: number) => string;
}) {
  const saldoTotal = pagina.resumen.saldoTotal ?? "0.00";
  const comprasAbiertas = pagina.resumen.comprasAbiertas ?? String(pagina.total);
  const totalPaginas = Math.max(1, pagina.totalPages);

  return (
    <section
      aria-label="Cuentas por pagar"
      className="mt-10 rounded-lg border border-zinc-200 p-5 dark:border-zinc-800"
    >
      <div className="mb-3">
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
          Cuentas por pagar
        </h2>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Saldo pendiente total: {formatearMonto(saldoTotal)} · {comprasAbiertas} compras abiertas
        </p>
      </div>

      {pagina.filas.length === 0 ? (
        <p className="rounded-md border border-zinc-200 px-4 py-6 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
          No hay cuentas por pagar pendientes.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-zinc-50 text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
              <tr>
                <th scope="col" className={TH}>Documento</th>
                <th scope="col" className={TH}>Proveedor</th>
                <th scope="col" className={TH}>Fecha</th>
                <th scope="col" className={TH}>Sucursal</th>
                <th scope="col" className={TH_R}>Total</th>
                <th scope="col" className={TH_R}>Pagos</th>
                <th scope="col" className={TH_R}>Saldo pendiente</th>
                <th scope="col" className={TH}>Estado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {pagina.filas.map((f) => (
                <tr key={f.compraId} data-testid={`cxp-fila-${f.compraId}`}>
                  <td className={`${TD} font-mono text-xs`}>{f.compraId}</td>
                  <td className={`${TD} font-medium text-zinc-900 dark:text-zinc-50`}>
                    {f.proveedorNombre}
                  </td>
                  <td className={TD}>{formatearFechaSD(f.fechaSD)}</td>
                  <td className={TD}>{f.sucursalNombre}</td>
                  <td className={TD_R}>{formatearMonto(f.total)}</td>
                  <td className={TD_R}>{formatearMonto(f.pagado)}</td>
                  <td className={`${TD_R} font-medium`}>{formatearMonto(f.saldoPendiente)}</td>
                  <td className={TD}>{etiquetaEstadoCompra(f.estado)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <nav
        aria-label="Paginación cuentas por pagar"
        className="mt-4 flex items-center gap-3 text-sm"
      >
        {pagina.page > 1 && (
          <a href={hrefPagina(pagina.page - 1)} className={ENLACE}>
            Anterior
          </a>
        )}
        {pagina.page < totalPaginas && (
          <a href={hrefPagina(pagina.page + 1)} className={ENLACE}>
            Siguiente
          </a>
        )}
        <span className="text-zinc-500 dark:text-zinc-400">
          Página {pagina.page} de {totalPaginas} · {pagina.total} resultados
        </span>
      </nav>
    </section>
  );
}
