/**
 * Reportes UI — the rentabilidad por producto result panel (REN-1..REN-3; slice D).
 *
 * A pure SERVER presentational component (AGENTS.md "server components by default") mirroring the
 * slice-B operational panel chrome: rows, the page-independent Decimal summary strip, link-based
 * pagination and the role-authorized "Exportar CSV" affordance. It holds NO data, issues NO query
 * and contains NO authorization logic — it only ever renders a successful, role-authorized result
 * (the use case gated the read), and the export link points at `/reportes/exportar`, which re-runs
 * the SAME gate server-side (EXP-4). The control renders ONLY beside a permitted panel (EXP-5).
 *
 * REN-3 — the cost-basis limitation is rendered as a VISIBLE in-panel disclaimer using the SAME
 * frozen string ({@link NOTA_LIMITACION_RENTABILIDAD}) the CSV footer writes, so a consumer who
 * only ever looks at the screen still learns the margins are current-cost, not historical — and the
 * panel can never word it differently from the file.
 *
 * Money/quantities are Decimal strings formatted via the shared display formatters (never a float);
 * the margin % is a Decimal-string ratio rendered with a literal `%`. No `any` (AGENTS.md "zero any").
 */

import Link from "next/link";
import type { Pagina } from "../domain/reporte-resultado";
import type { RentabilidadFila } from "../domain/margen";
import { NOTA_LIMITACION_RENTABILIDAD } from "../domain/margen";
import type { SeleccionReporte } from "./url";
import { construirHref, construirHrefExportar } from "./url";
import { formatearCantidad, formatearEntero, formatearMontoDO } from "./format";

const TH = "py-1 font-medium text-zinc-500 dark:text-zinc-400";
const TH_R = `${TH} text-right`;
const TD = "py-1 text-zinc-900 dark:text-zinc-50";
const TD_R = `${TD} text-right`;
const BOTON =
  "inline-flex items-center rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800";

/** REN-3 — the visible, non-dismissible in-panel cost-basis disclaimer (same string as the CSV note). */
function AvisoLimitacion() {
  return (
    <p
      role="note"
      className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200"
    >
      {NOTA_LIMITACION_RENTABILIDAD}
    </p>
  );
}

export function PanelRentabilidad({
  pagina,
  seleccion,
}: {
  readonly pagina: Pagina<RentabilidadFila>;
  readonly seleccion: SeleccionReporte;
}) {
  const haySiguiente = pagina.page < pagina.totalPages;
  const hayAnterior = pagina.page > 1;
  const r = pagina.resumen;

  return (
    <section
      aria-label="Rentabilidad por producto"
      className="rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900"
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
            Rentabilidad por producto
          </h2>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Ventas {formatearMontoDO(r.ventas ?? "0.00")} · Margen {formatearMontoDO(r.margen ?? "0.00")} (
            {r.margenPorciento ?? "0.00"}%) · Inversión {formatearMontoDO(r.inversion ?? "0.00")} · Capital{" "}
            {formatearMontoDO(r.capital ?? "0.00")}
          </p>
        </div>
        <Link href={construirHrefExportar(seleccion)} className={BOTON}>
          Exportar CSV
        </Link>
      </div>

      {/* REN-3 — the limitation the CSV also carries. */}
      <AvisoLimitacion />

      {pagina.filas.length === 0 ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Sin resultados para el filtro seleccionado.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className={TH}>
              <tr>
                <th className={TH}>Producto</th>
                <th className={TH_R}>Precio costo</th>
                <th className={TH_R}>Precio salida</th>
                <th className={TH_R}>Vendidas</th>
                <th className={TH_R}>Compradas</th>
                <th className={TH_R}>Inversión</th>
                <th className={TH_R}>Capital</th>
                <th className={TH_R}>Margen</th>
                <th className={TH_R}>Margen %</th>
              </tr>
            </thead>
            <tbody>
              {pagina.filas.map((f) => (
                <tr key={f.productoId} className="border-t border-zinc-100 dark:border-zinc-800">
                  <td className={TD}>{f.nombre}</td>
                  <td className={TD_R}>{formatearMontoDO(f.precioCosto)}</td>
                  <td className={TD_R}>{formatearMontoDO(f.precioSalida)}</td>
                  <td className={TD_R}>{formatearCantidad(f.unidadesVendidas)}</td>
                  <td className={TD_R}>{formatearCantidad(f.unidadesCompradas)}</td>
                  <td className={TD_R}>{formatearMontoDO(f.inversion)}</td>
                  <td className={TD_R}>{formatearMontoDO(f.capital)}</td>
                  <td className={TD_R}>{formatearMontoDO(f.margen)}</td>
                  <td className={TD_R}>{f.margenPorciento}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-4 flex items-center gap-3 text-sm">
        {hayAnterior && (
          <Link href={construirHref(seleccion, { page: pagina.page - 1 })} className={BOTON}>
            ← Anterior
          </Link>
        )}
        {haySiguiente && (
          <Link href={construirHref(seleccion, { page: pagina.page + 1 })} className={BOTON}>
            Siguiente →
          </Link>
        )}
        <span className="text-zinc-500 dark:text-zinc-400">
          Página {formatearEntero(pagina.page)} de {formatearEntero(Math.max(1, pagina.totalPages))} ·{" "}
          {formatearEntero(pagina.total)} productos
        </span>
      </div>
    </section>
  );
}
