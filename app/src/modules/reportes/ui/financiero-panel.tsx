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
import { formatearEntero, formatearMontoDO } from "./format";

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

const TH = "py-1 font-medium text-zinc-500 dark:text-zinc-400";
const TH_R = `${TH} text-right`;
const TD = "py-1 text-zinc-900 dark:text-zinc-50";
const TD_R = `${TD} text-right`;
const BOTON =
  "inline-flex items-center rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800";
const CELDA = "border-t border-zinc-100 dark:border-zinc-800";

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
      className="rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900"
    >
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">{titulo}</h2>
          <div className="text-sm text-zinc-500 dark:text-zinc-400">{resumen}</div>
        </div>
        <Link href={construirHrefExportar(seleccion)} className={BOTON}>
          Exportar CSV
        </Link>
      </div>

      {pagina.filas.length === 0 ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Sin resultados para el filtro seleccionado.
        </p>
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
        <span className="text-zinc-500 dark:text-zinc-400">
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
      <span>Total CxC: {formatearMontoDO(saldoTotal)}</span>
      {ORDEN_BUCKETS.map((b) => (
        <span key={b} className="text-xs">
          {ETIQUETA_BUCKET_AGING[b]}: {formatearMontoDO(pagina.resumen[b] ?? "0.00")}
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
              <td className={TD_R}>{formatearMontoDO(f.saldoPendiente)}</td>
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
        resumen={`Saldo por pagar ${formatearMontoDO(
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
              <td className={TD_R}>{formatearMontoDO(f.total)}</td>
              <td className={TD_R}>{formatearMontoDO(f.pagado)}</td>
              <td className={TD_R}>{formatearMontoDO(f.saldoPendiente)}</td>
            </tr>
          ))}
        </tbody>
      </Marco>
    );
  }

  // comparativa — current period per-day rows; Total row = CURRENT only (baseline in the strip).
  const { pagina } = props;
  const pct = pagina.resumen.variacionPorciento ?? "0.00";
  const signo = pct.startsWith("-") ? "" : "+";
  return (
    <Marco
      titulo="Comparativa de períodos"
      resumen={
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span>Actual: {formatearMontoDO(pagina.resumen.montoActual ?? "0.00")}</span>
          <span>Anterior: {formatearMontoDO(pagina.resumen.montoAnterior ?? "0.00")}</span>
          <span>
            Variación: {formatearMontoDO(pagina.resumen.variacionMonto ?? "0.00")} (
            {signo}
            {pct}%)
          </span>
        </div>
      }
      pagina={pagina}
      seleccion={seleccion}
    >
      <thead className={TH}>
        <tr>
          <th className={TH}>Fecha (SD)</th>
          <th className={TH_R}>Monto</th>
        </tr>
      </thead>
      <tbody>
        {pagina.filas.map((f) => (
          <tr key={f.fechaSD} className={CELDA}>
            <td className={TD}>{f.fechaSD}</td>
            <td className={TD_R}>{formatearMontoDO(f.monto)}</td>
          </tr>
        ))}
        <tr className={CELDA}>
          <td className={`${TD} font-semibold`}>TOTAL (período actual)</td>
          <td className={`${TD_R} font-semibold`}>
            {formatearMontoDO(pagina.resumen.montoActual ?? "0.00")}
          </td>
        </tr>
      </tbody>
    </Marco>
  );
}
