"use client";

/**
 * `/caja` client island (S7): wireframe 06a "Cierre diario de caja" + 06b "Resumen del día".
 *
 * A THIN projection of the two DTOs the server page hands it. It computes NOTHING: the use cases
 * own the SD day, the aggregates and the decimal math, the actions own the role gate, and the
 * helpers in `caja-formato` own the display. That is why there is no date control anywhere — the
 * close is always TODAY in America/Santo_Domingo (S1), the date arrives already resolved.
 *
 * The two boards are rendered as SEPARATE sections (S2: never mixed), with "Ver cierre de caja →"
 * anchoring the summary back to the close.
 *
 * Deliberate non-affordances from the owner's decisions:
 *  - "Cerrar caja" is DISABLED with a visible "Próximamente" hint (S3). The ERD eliminated
 *    CIERRE_CAJA: the close is a derived report and the physical count stays external, so there is
 *    no persistence to build here.
 *  - "Exportar PDF" is a plain LINK to the route handler (S4). A link degrades honestly until that
 *    route ships, and it stays keyboard-navigable and server-authoritative.
 */

import Link from "next/link";
import type { CierreDiarioDto, ResumenDiaDto } from "../http/shared";
import {
  ANCLA_CIERRE,
  CAJA_TESTID,
  FORMULA_CORTE,
  HINT_PROXIMAMENTE,
  RUTA_CIERRE_PDF,
  TEXTO_NOTA_CIERRE,
  esMontoNegativo,
  etiquetaMetodo,
  formatearMargen,
  formatearMontoConSigno,
  testIdMetodo,
} from "./caja-formato";
import { formatearFechaSD, formatearMonto } from "@/shared/ui/format";

const CLASE_SECCION = "rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900";
const CLASE_TITULO = "text-lg font-semibold text-zinc-900 dark:text-zinc-50";
const CLASE_SUBTITULO = "text-sm text-zinc-500 dark:text-zinc-400";
const CLASE_KPI_TITULO = "text-sm font-medium text-zinc-500 dark:text-zinc-400";
const CLASE_KPI_VALOR = "mt-1 text-2xl font-semibold text-zinc-900 dark:text-zinc-50";
const CLASE_CELDA = "py-1 pr-4";
const CLASE_CELDA_NUM = "py-1 pr-4 text-right tabular-nums";

/** One KPI card. */
function Kpi({
  titulo,
  valor,
  testid,
  claseValor,
}: {
  readonly titulo: string;
  readonly valor: string;
  readonly testid: string;
  readonly claseValor?: string;
}) {
  return (
    <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <p className={CLASE_KPI_TITULO}>{titulo}</p>
      <p data-testid={testid} className={claseValor ?? CLASE_KPI_VALOR}>
        {valor}
      </p>
    </div>
  );
}

/** One formula term in the corte panel (label + Decimal figure). */
function TerminoCorte({
  etiqueta,
  valor,
  testid,
}: {
  readonly etiqueta: string;
  readonly valor: string;
  readonly testid: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-zinc-100 py-1 last:border-b-0 dark:border-zinc-800">
      <span className="text-sm text-zinc-600 dark:text-zinc-400">{etiqueta}</span>
      <span
        data-testid={testid}
        className="text-sm font-medium tabular-nums text-zinc-900 dark:text-zinc-50"
      >
        {valor}
      </span>
    </div>
  );
}

export function CajaScreen({
  cierre,
  resumen,
  alcanceNombre,
}: {
  readonly cierre: CierreDiarioDto;
  readonly resumen: ResumenDiaDto;
  /** The read-only scope the figures cover, already resolved by the page (branch or company-wide). */
  readonly alcanceNombre: string;
}) {
  const diferencia = formatearMontoConSigno(cierre.diferencia);
  const claseDiferencia = esMontoNegativo(cierre.diferencia)
    ? `${CLASE_KPI_VALOR} text-red-600 dark:text-red-400`
    : CLASE_KPI_VALOR;
  // The money COUNTED this day: the use case's `totalCobrado`, never a figure re-derived here.
  const cobrosTotal = formatearMonto(cierre.totalCobrado);

  return (
    <div className="flex flex-col gap-8">
      {/* 06a — Cierre diario de caja (S1) */}
      <section
        id={ANCLA_CIERRE}
        data-testid={CAJA_TESTID.cierre}
        aria-labelledby="caja-cierre-titulo"
        className={CLASE_SECCION}
      >
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h2 id="caja-cierre-titulo" className={CLASE_TITULO}>
              Cierre diario de caja
            </h2>
            <p className={CLASE_SUBTITULO}>
              <span data-testid={CAJA_TESTID.fecha}>
                {formatearFechaSD(cierre.fechaSD)}
              </span>{" "}
              (America/Santo_Domingo)
            </p>
          </div>
          {/* Read-only tenant scope: the day is the session's empresa + sucursal, never a filter. */}
          <p data-testid={CAJA_TESTID.tenant} className={CLASE_SUBTITULO}>
            {alcanceNombre}
          </p>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Kpi
            titulo="Total facturado"
            valor={formatearMonto(cierre.totalFacturado)}
            testid={CAJA_TESTID.kpiTotalFacturado}
          />
          <Kpi
            titulo="Total cobrado"
            valor={formatearMonto(cierre.totalCobrado)}
            testid={CAJA_TESTID.kpiTotalCobrado}
          />
          <Kpi
            titulo="Efectivo esperado"
            valor={formatearMontoConSigno(cierre.efectivoEsperado)}
            testid={CAJA_TESTID.kpiEfectivoEsperado}
          />
          <Kpi
            titulo="Diferencia"
            valor={diferencia}
            testid={CAJA_TESTID.kpiDiferencia}
            claseValor={claseDiferencia}
          />
        </div>

        <p className="mt-4 text-xs text-zinc-500 dark:text-zinc-400">{TEXTO_NOTA_CIERRE}</p>

        <table
          data-testid={CAJA_TESTID.tablaMetodos}
          className="mt-6 w-full text-left text-sm"
        >
          <thead className="text-zinc-500 dark:text-zinc-400">
            <tr>
              <th className={CLASE_CELDA}>Método</th>
              <th className={`${CLASE_CELDA} text-right`}>Ventas</th>
              <th className={`${CLASE_CELDA} text-right`}>Cobros</th>
              <th className={`${CLASE_CELDA} text-right`}>Total</th>
            </tr>
          </thead>
          <tbody>
            {cierre.metodos.map((fila) => (
              <tr
                key={fila.metodo}
                data-testid={testIdMetodo(fila.metodo)}
                className="border-t border-zinc-100 dark:border-zinc-800"
              >
                <td className={CLASE_CELDA}>{etiquetaMetodo(fila.metodo)}</td>
                {/* No per-method sales source in the schema (S6): the column stays honest. */}
                <td className={CLASE_CELDA_NUM}>—</td>
                <td className={CLASE_CELDA_NUM}>{formatearMonto(fila.cobros)}</td>
                <td className={CLASE_CELDA_NUM}>{formatearMonto(fila.cobros)}</td>
              </tr>
            ))}
            <tr
              data-testid={CAJA_TESTID.totalFila}
              className="border-t border-zinc-200 font-medium dark:border-zinc-700"
            >
              <td className={CLASE_CELDA}>Total</td>
              <td className={CLASE_CELDA_NUM}>{formatearMonto(cierre.totalFacturado)}</td>
              <td className={CLASE_CELDA_NUM}>{cobrosTotal}</td>
              <td className={CLASE_CELDA_NUM}>{cobrosTotal}</td>
            </tr>
          </tbody>
        </table>

        <div
          data-testid={CAJA_TESTID.corte}
          className="mt-6 rounded-lg bg-zinc-50 p-4 dark:bg-zinc-950"
        >
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
            Corte de caja
          </h3>
          <p className="mb-3 mt-1 text-xs text-zinc-500 dark:text-zinc-400">{FORMULA_CORTE}</p>
          <TerminoCorte
            etiqueta="Cobros"
            valor={formatearMonto(cierre.corte.cobros)}
            testid={CAJA_TESTID.corteCobros}
          />
          <TerminoCorte
            etiqueta="Devoluciones"
            valor={formatearMonto(cierre.corte.devoluciones)}
            testid={CAJA_TESTID.corteDevoluciones}
          />
          <TerminoCorte
            etiqueta="Esperado"
            valor={formatearMontoConSigno(cierre.efectivoEsperado)}
            testid={CAJA_TESTID.corteEsperado}
          />
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          {/* S3: disabled on purpose — the close is a derived report, not a stored state. */}
          <button
            type="button"
            disabled
            className="rounded-md bg-zinc-200 px-4 py-2 text-sm font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
          >
            Cerrar caja
          </button>
          <span
            data-testid={CAJA_TESTID.cerrarHint}
            className="text-xs text-zinc-500 dark:text-zinc-400"
          >
            {HINT_PROXIMAMENTE}
          </span>
          <Link
            href={RUTA_CIERRE_PDF}
            className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-900 dark:border-zinc-700 dark:text-zinc-50"
          >
            Exportar PDF
          </Link>
        </div>
      </section>

      {/* 06b — Resumen del día (S2), kept separate from the close */}
      <section
        data-testid={CAJA_TESTID.resumen}
        aria-labelledby="caja-resumen-titulo"
        className={CLASE_SECCION}
      >
        <h2 id="caja-resumen-titulo" className={CLASE_TITULO}>
          Resumen del día — Ventas, costo y margen bruto
        </h2>
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Kpi
            titulo="Ventas del día"
            valor={formatearMonto(resumen.ventas)}
            testid={CAJA_TESTID.resumenVentas}
          />
          <Kpi
            titulo="Costo de lo vendido"
            valor={formatearMonto(resumen.costoVendido)}
            testid={CAJA_TESTID.resumenCosto}
          />
          <Kpi
            titulo="Margen bruto"
            valor={formatearMontoConSigno(resumen.margenBruto)}
            testid={CAJA_TESTID.resumenMargen}
          />
          <Kpi
            titulo="Margen %"
            valor={formatearMargen(resumen.margenPorcentaje)}
            testid={CAJA_TESTID.resumenMargenPct}
          />
        </div>
        <p className="mt-4">
          <Link href={`#${ANCLA_CIERRE}`} className="text-sm font-medium text-sky-700 dark:text-sky-400">
            Ver cierre de caja →
          </Link>
        </p>
      </section>
    </div>
  );
}
