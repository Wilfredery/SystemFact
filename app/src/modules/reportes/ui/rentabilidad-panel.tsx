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
import { formatearCantidad, formatearEntero } from "./format";
import { formatearMonto } from "@/shared/ui/format";

const TH = "py-1 font-medium text-ink-muted";
const TH_R = `${TH} text-right`;
const TD = "py-1 text-ink";
const TD_R = `${TD} text-right`;
const BOTON =
  "inline-flex items-center rounded-md border border-line px-3 py-1.5 text-sm font-medium text-ink transition hover:bg-surface-muted disabled:opacity-40";
const CLASE_KPI_TITULO = "text-sm font-medium text-ink-muted";
const CLASE_KPI_VALOR = "mt-1 text-2xl font-semibold text-ink";

/** REN-3 — the visible, non-dismissible in-panel cost-basis disclaimer (same string as the CSV note). */
function AvisoLimitacion() {
  return (
    <p
      role="note"
      className="mb-4 rounded-md border border-warn bg-warn-bg px-3 py-2 text-sm text-ink"
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
      className="rounded-lg border border-line bg-surface p-5"
    >
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold text-ink">Rentabilidad por producto</h2>
          {/* Board 07a (S37): the wireframe's five KPI tiles, all page-independent
              totals from the SAME summary the CSV shares (EXP-2). */}
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Kpi titulo="Inversión" valor={formatearMonto(r.inversion ?? "0.00")} testid="r07a-kpi-inversion" />
            <Kpi titulo="Entrada (unid.)" valor={formatearCantidad(r.unidadesCompradas ?? "0")} testid="r07a-kpi-entrada" />
            <Kpi titulo="Salida (unid.)" valor={formatearCantidad(r.unidadesVendidas ?? "0")} testid="r07a-kpi-salida" />
            <Kpi titulo="Capital en mercancía" valor={formatearMonto(r.capital ?? "0.00")} testid="r07a-kpi-capital" />
            <Kpi
              titulo="Margen de ganancia"
              valor={formatearMonto(r.margen ?? "0.00")}
              subvalor={`${r.margenPorciento ?? "0.00"}%`}
              testid="r07a-kpi-margen"
            />
          </div>
        </div>
        <Link href={construirHrefExportar(seleccion)} className={BOTON}>
          Exportar CSV
        </Link>
      </div>

      {/* REN-3 — the limitation the CSV also carries. */}
      <AvisoLimitacion />

      {pagina.filas.length === 0 ? (
        <p className="text-sm text-ink-muted">Sin resultados para el filtro seleccionado.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className={TH}>
              <tr>
                <th scope="col" className={TH}>Producto</th>
                <th scope="col" className={TH_R}>P. costo</th>
                <th scope="col" className={TH_R}>P. salida</th>
                <th scope="col" className={TH_R}>Cant. vendida</th>
                <th scope="col" className={TH_R}>Cant. comprada</th>
                <th scope="col" className={TH_R}>Ventas</th>
                <th scope="col" className={TH_R}>Costo</th>
                <th scope="col" className={TH_R}>Margen</th>
                <th scope="col" className={TH_R}>Margen %</th>
              </tr>
            </thead>
            <tbody>
              {pagina.filas.map((f) => (
                <tr key={f.productoId} className="border-t border-line">
                  <td className={TD}>{f.nombre}</td>
                  <td className={TD_R}>{formatearMonto(f.precioCosto)}</td>
                  <td className={TD_R}>{formatearMonto(f.precioSalida)}</td>
                  <td className={TD_R}>{formatearCantidad(f.unidadesVendidas)}</td>
                  <td className={TD_R}>{formatearCantidad(f.unidadesCompradas)}</td>
                  <td className={TD_R}>{formatearMonto(f.ventas)}</td>
                  <td className={TD_R}>{formatearMonto(f.costo)}</td>
                  <td className={TD_R}>{formatearMonto(f.margen)}</td>
                  <td className={TD_R}>{f.margenPorciento}%</td>
                </tr>
              ))}
            </tbody>
            {/* Board 07a (S36, JD round 1): the wireframe's TOTAL row from the SAME
                page-independent summary the CSV footer carries (EXP-2). */}
            <tfoot>
              <tr className="border-t border-line font-semibold">
                <td className={TD}>TOTAL</td>
                <td className={`${TD_R} text-ink-muted`}>—</td>
                <td className={`${TD_R} text-ink-muted`}>—</td>
                <td className={TD_R}>{formatearCantidad(r.unidadesVendidas)}</td>
                <td className={TD_R}>{formatearCantidad(r.unidadesCompradas)}</td>
                <td className={TD_R}>{formatearMonto(r.ventas)}</td>
                <td className={TD_R}>{formatearMonto(r.costo)}</td>
                <td className={TD_R}>{formatearMonto(r.margen)}</td>
                <td className={TD_R}>{r.margenPorciento}%</td>
              </tr>
            </tfoot>
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
        <span className="text-ink-muted">
          Página {formatearEntero(pagina.page)} de {formatearEntero(Math.max(1, pagina.totalPages))} ·{" "}
          {formatearEntero(pagina.total)} productos
        </span>
      </div>
      <p className="mt-4 text-xs text-ink-muted">Filtrado por período y sucursal</p>
    </section>
  );
}

/** One wireframe KPI tile (board 07a S37): title + Decimal-string value + optional sub-value. */
function Kpi({
  titulo,
  valor,
  subvalor,
  testid,
}: {
  readonly titulo: string;
  readonly valor: string;
  readonly subvalor?: string;
  readonly testid: string;
}) {
  return (
    <div className="rounded-lg border border-line p-4">
      <p className={CLASE_KPI_TITULO}>{titulo}</p>
      <p data-testid={testid} className={CLASE_KPI_VALOR}>
        {valor}
      </p>
      {subvalor !== undefined && <p className="text-sm text-ink-muted">{subvalor}</p>}
    </div>
  );
}
