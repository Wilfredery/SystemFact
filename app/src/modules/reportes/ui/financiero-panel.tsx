/**
 * Reportes UI — the slice-C financial result panel (CxC aging, CxP, comparativa).
 *
 * A pure SERVER presentational component (AGENTS.md "server components by default"), mirroring
 * `operacional-panel.tsx`: it renders the {@link Pagina} a consult action already returned — the
 * rows, the page-independent Decimal summary strip, simple link pagination, and the
 * role-authorized "Exportar CSV" affordance. It holds NO data, issues NO query and contains NO
 * authorization logic: the use case gated the read (the panel is only reached on a successful,
 * role-authorized result), and the export link points at `/reportes/exportar`, which re-enforces
 * the SAME gate server-side (EXP-4). The control renders ONLY alongside a permitted data panel —
 * list-before-export, gate-identical (EXP-5, decision 2.5.3).
 *
 * The discriminated {@link PanelFinancieroProps} union keeps every column access statically typed
 * (zero `any`). Money is a Decimal string formatted through the reused cobros display formatters.
 * For the comparativa the Total row shows the CURRENT period only (wireframe 2.5.1); the preceding
 * baseline and the variation render in the summary strip so a mixed-period total is never implied.
 */

import Link from "next/link";
import type { Pagina } from "../domain/reporte-resultado";
import { ETIQUETA_BUCKET_AGING, ORDEN_BUCKETS } from "../domain/aging";
import type { CxcAgingFila } from "../domain/aging";
import type { ComparativaFila, CxpFila } from "../domain/financiero";
import type { SeleccionReporte } from "./url";
import { construirHref, construirHrefExportar } from "./url";
import { formatearEntero } from "./format";
import { formatearMonto } from "@/shared/ui/format";

export type PanelFinancieroProps =
  | {
      readonly reporte: "cxc";
      readonly pagina: Pagina<CxcAgingFila>;
      readonly seleccion: SeleccionReporte;
    }
  | {
      readonly reporte: "cxp";
      readonly pagina: Pagina<CxpFila>;
      readonly seleccion: SeleccionReporte;
    }
  | {
      readonly reporte: "comparativa";
      readonly pagina: Pagina<ComparativaFila>;
      readonly seleccion: SeleccionReporte;
    };

const TH = "py-1 font-medium text-ink-muted";
const TH_R = `${TH} text-right`;
const TD = "py-1 text-ink";
const TD_R = `${TD} text-right`;
const BOTON =
  "inline-flex items-center rounded-md border border-line px-3 py-1.5 text-sm font-medium text-ink transition hover:bg-surface-muted disabled:opacity-40";
const CELDA = "border-t border-line";
const CLASE_KPI_TITULO = "text-sm font-medium text-ink-muted";
const CLASE_KPI_VALOR = "mt-1 text-2xl font-semibold text-ink";

/** One wireframe KPI tile (board 07b S39). */
function Kpi({
  titulo,
  valor,
  testid,
}: {
  readonly titulo: string;
  readonly valor: string;
  readonly testid: string;
}) {
  return (
    <div className="rounded-lg border border-line p-4">
      <p className={CLASE_KPI_TITULO}>{titulo}</p>
      <p data-testid={testid} className={CLASE_KPI_VALOR}>
        {valor}
      </p>
    </div>
  );
}

/** The shared panel chrome: title, summary strip, table (children), pagination + export control. */
function Marco({
  titulo,
  resumen,
  pagina,
  seleccion,
  children,
}: {
  readonly titulo: string;
  readonly resumen: React.ReactNode;
  readonly pagina: Pagina<unknown>;
  readonly seleccion: SeleccionReporte;
  readonly children: React.ReactNode;
}) {
  const haySiguiente = pagina.page < pagina.totalPages;
  const hayAnterior = pagina.page > 1;
  return (
    <section
      aria-label={titulo}
      className="rounded-lg border border-line bg-surface p-5"
    >
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold text-ink">{titulo}</h2>
          <div className="text-sm text-ink-muted">{resumen}</div>
        </div>
        <Link href={construirHrefExportar(seleccion)} className={BOTON}>
          Exportar CSV
        </Link>
      </div>

      {pagina.filas.length === 0 ? (
        <p className="text-sm text-ink-muted">Sin resultados para el filtro seleccionado.</p>
      ) : (
        <table className="w-full text-left text-sm">{children}</table>
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
          {formatearEntero(pagina.total)} resultados
        </span>
      </div>
    </section>
  );
}

/** The bucket-strip summary for the CxC aging panel (Σ saldo per bucket + grand total). */
function ResumenCxC({ pagina }: { readonly pagina: Pagina<CxcAgingFila> }) {
  const saldoTotal = pagina.resumen.saldoTotal ?? "0.00";
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
      <span>Total CxC: {formatearMonto(saldoTotal)}</span>
      {ORDEN_BUCKETS.map((b) => (
        <span key={b} className="text-xs">
          {ETIQUETA_BUCKET_AGING[b]}: {formatearMonto(pagina.resumen[b] ?? "0.00")}
        </span>
      ))}
    </div>
  );
}

export function PanelFinanciero(props: PanelFinancieroProps) {
  const { seleccion } = props;

  if (props.reporte === "cxc") {
    const { pagina } = props;
    return (
      <Marco
        titulo="Cuentas por cobrar (aging)"
        resumen={<ResumenCxC pagina={pagina} />}
        pagina={pagina}
        seleccion={seleccion}
      >
        <thead className={TH}>
          <tr>
            <th className={TH}>Factura</th>
            <th className={TH}>Cliente</th>
            <th className={TH}>Vence (SD)</th>
            <th className={TH_R}>Días</th>
            <th className={TH}>Rango</th>
            <th className={TH_R}>Saldo</th>
          </tr>
        </thead>
        <tbody>
          {pagina.filas.map((f) => (
            <tr key={f.facturaId} className={CELDA}>
              <td className={TD}>{f.facturaId}</td>
              <td className={TD}>{f.clienteId}</td>
              <td className={TD}>{f.vencimiento}</td>
              <td className={TD_R}>{formatearEntero(f.diasVencido)}</td>
              <td className={TD}>{ETIQUETA_BUCKET_AGING[f.bucket]}</td>
              <td className={TD_R}>{formatearMonto(f.saldoPendiente)}</td>
            </tr>
          ))}
        </tbody>
      </Marco>
    );
  }

  if (props.reporte === "cxp") {
    const { pagina } = props;
    return (
      <Marco
        titulo="Cuentas por pagar"
        resumen={`Saldo por pagar ${formatearMonto(
          pagina.resumen.saldoTotal ?? "0.00",
        )} · ${pagina.resumen.comprasAbiertas ?? "0"} compras abiertas`}
        pagina={pagina}
        seleccion={seleccion}
      >
        <thead className={TH}>
          <tr>
            <th className={TH}>Compra</th>
            <th className={TH}>Proveedor</th>
            <th className={TH}>Sucursal</th>
            <th className={TH}>Fecha (SD)</th>
            <th className={TH}>Estado</th>
            <th className={TH_R}>Total</th>
            <th className={TH_R}>Pagado</th>
            <th className={TH_R}>Saldo</th>
          </tr>
        </thead>
        <tbody>
          {pagina.filas.map((f) => (
            <tr key={f.compraId} className={CELDA}>
              <td className={TD}>{f.compraId}</td>
              <td className={TD}>{f.proveedorNombre}</td>
              <td className={TD}>{f.sucursalNombre}</td>
              <td className={TD}>{f.fechaSD}</td>
              <td className={TD}>{f.estado}</td>
              <td className={TD_R}>{formatearMonto(f.total)}</td>
              <td className={TD_R}>{formatearMonto(f.pagado)}</td>
              <td className={TD_R}>{formatearMonto(f.saldoPendiente)}</td>
            </tr>
          ))}
        </tbody>
      </Marco>
    );
  }

  // comparativa — board 07b (S38): the wireframe's PER-PERIOD rows with variación columns;
  // the per-day detail stays available through the CSV export (FIN-5 semantics unchanged).
  const { pagina } = props;
  const pct = pagina.resumen.variacionPorciento ?? "0.00";
  const signoPct = pct.startsWith("-") ? "" : "+";
  const varMonto = pagina.resumen.variacionMonto ?? "0.00";
  const signoMonto = varMonto.startsWith("-") ? "" : "+";
  return (
    <section aria-label="Analítico comparativo" className="rounded-lg border border-line bg-surface p-5">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold text-ink">Analítico comparativo</h2>
          {/* S39: the wireframe's four KPI tiles. */}
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi titulo="Ventas período actual" valor={formatearMonto(pagina.resumen.montoActual ?? "0.00")} testid="r07b-kpi-actual" />
            <Kpi titulo="Ventas período anterior" valor={formatearMonto(pagina.resumen.montoAnterior ?? "0.00")} testid="r07b-kpi-anterior" />
            <Kpi titulo="Variación" valor={`${signoMonto}${formatearMonto(varMonto)}`} testid="r07b-kpi-variacion" />
            <Kpi titulo="Variación %" valor={`${signoPct}${pct}%`} testid="r07b-kpi-variacion-pct" />
          </div>
        </div>
        <Link href={construirHrefExportar(seleccion)} className={BOTON}>
          Exportar CSV
        </Link>
      </div>

      <table className="w-full text-left text-sm">
        <thead className={TH}>
          <tr>
            <th scope="col" className={TH}>Período</th>
            <th scope="col" className={TH_R}>Ventas (RD$)</th>
            <th scope="col" className={TH_R}>Variación (RD$)</th>
            <th scope="col" className={TH_R}>Variación (%)</th>
          </tr>
        </thead>
        <tbody>
          <tr className={CELDA}>
            <td className={`${TD} font-medium`}>Período actual</td>
            <td className={TD_R}>{formatearMonto(pagina.resumen.montoActual ?? "0.00")}</td>
            <td className={TD_R}>{signoMonto}{formatearMonto(varMonto)}</td>
            <td className={TD_R}>{signoPct}{pct}%</td>
          </tr>
          <tr className={CELDA}>
            <td className={TD}>Período anterior</td>
            <td className={TD_R}>{formatearMonto(pagina.resumen.montoAnterior ?? "0.00")}</td>
            <td className={`${TD_R} text-ink-muted`}>—</td>
            <td className={`${TD_R} text-ink-muted`}>—</td>
          </tr>
          <tr className={`${CELDA} font-semibold`}>
            <td className={`${TD} font-semibold`}>Total</td>
            <td className={`${TD_R} font-semibold`}>
              {formatearMonto(pagina.resumen.montoActual ?? "0.00")}
            </td>
            <td className={`${TD_R} font-semibold`}>{signoMonto}{formatearMonto(varMonto)}</td>
            <td className={`${TD_R} font-semibold`}>{signoPct}{pct}%</td>
          </tr>
        </tbody>
      </table>

      <p className="mt-4 text-xs text-ink-muted">Filtrado por empresa y sucursal activa</p>
    </section>
  );
}
