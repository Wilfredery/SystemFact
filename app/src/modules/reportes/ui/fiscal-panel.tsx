/**
 * Reportes UI — the fiscal panel fleet (FIS-1..FIS-6; slice E).
 *
 * A pure SERVER presentational component (AGENTS.md "server components by default"), mirroring the
 * slice-B/C/D panel chrome. It holds NO data, issues NO query and contains NO authorization logic:
 * it only ever renders an ALREADY role-authorized result (the use case gated the read), and its
 * export links point at the `/reportes/exportar` (CSV) and `/reportes/exportar-txt` (DGII TXT)
 * routes, each of which re-runs the SAME server-side gate (EXP-4). The control renders ONLY beside a
 * permitted panel (EXP-5).
 *
 * FIS-2 — the IT-1 panel is a CASILLA WORKSHEET (never an "IT-1 TXT"); it says so and surfaces the
 * Σ606 self-check warning verbatim when a manual casilla disagrees. The B11 no-credit note and the
 * day-20 guidance are the SAME frozen strings the CSV carries (no drift).
 *
 * U1–U5 (FIS-6) — every DGII 606/607/608 panel renders a pending-tool-validation NOTICE: the exact
 * byte layout, encoding, the Tipo-Ingreso code table, the Cancelada→608 scope and the 606 cap are
 * research-UNVERIFIED and must be confirmed against the DGII Herramienta de Pre-Validación before a
 * file is relied on. The notice is honest about that (a generated file is "pre-validación pendiente"),
 * and the config seams (widths/encoding/tables) mean a tool finding never requires a logic change.
 */

import Link from "next/link";
import type { ReporteId } from "../domain/catalogo";
import type { CasillasIT1, ResumenITBIS } from "../domain/fiscal";
import {
  NOTA_B11_SIN_CREDITO_FISCAL,
  NOTA_VENCIMIENTO_IT1,
} from "../domain/fiscal";
import type { SeleccionReporte } from "./url";
import { construirHrefExportar, construirHrefExportarTxt } from "./url";
import { formatearMontoDO } from "./format";

const BOTON =
  "inline-flex items-center rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800";

/** A frozen, honest notice that a generated DGII TXT still needs the official pre-validation tool. */
function AvisoPrevalidacion() {
  return (
    <p
      role="note"
      className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200"
    >
      Aviso (U1–U5): el archivo DGII se genera con el diseño de columnas e idioma UTF-8/ASCII
      especificados, pero el ancho exacto de bytes, la codificación, la tabla de “Tipo de Ingreso”,
      el alcance del 608 y el tope del 606 DEBEN validarse con la Herramienta de Pre-Validación de la
      DGII antes de confiar en el envío. Si la herramienta reporta una diferencia, se corrige por
      configuración (anchos/codificación/tablas) sin cambiar la lógica.
    </p>
  );
}

/** A two-column money row for the summary tables. */
function FilaMonto({ etiqueta, monto }: { readonly etiqueta: string; readonly monto: string }) {
  return (
    <div className="flex items-center justify-between gap-4 border-t border-zinc-100 py-1.5 text-sm dark:border-zinc-800">
      <span className="text-zinc-600 dark:text-zinc-300">{etiqueta}</span>
      <span className="font-mono text-zinc-900 dark:text-zinc-50">{formatearMontoDO(monto)}</span>
    </div>
  );
}

/** FIS-1 — the ITBIS summary panel (a data rollup + its CSV export). */
export function PanelResumenITBIS({
  resumen,
  seleccion,
}: {
  readonly resumen: ResumenITBIS;
  readonly seleccion: SeleccionReporte;
}) {
  return (
    <section
      aria-label="Resumen ITBIS"
      className="rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900"
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Resumen ITBIS del período</h2>
        <Link href={construirHrefExportar(seleccion)} className={BOTON}>
          Exportar CSV
        </Link>
      </div>
      <FilaMonto etiqueta="Débito fiscal (Σ ITBIS ventas, neto NC/ND)" monto={resumen.debitoFiscal} />
      <FilaMonto etiqueta="Crédito fiscal / ITBIS por adelantar (Σ606)" monto={resumen.creditoFiscal} />
      <FilaMonto etiqueta="ITBIS retenido (Σ606)" monto={resumen.itbisRetenido} />
      <FilaMonto etiqueta="ISR retenido (Σ606)" monto={resumen.isrRetenido} />
      <p className="mt-4 text-xs text-zinc-500 dark:text-zinc-400">{NOTA_B11_SIN_CREDITO_FISCAL}</p>
    </section>
  );
}

/** FIS-2 — the IT-1 casilla worksheet panel (a summary, NOT a TXT; with the self-check warning). */
export function PanelCasillasIT1({
  casillas,
  seleccion,
}: {
  readonly casillas: CasillasIT1;
  readonly seleccion: SeleccionReporte;
}) {
  return (
    <section
      aria-label="IT-1 casillas"
      className="rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900"
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">IT-1 — casillas (resumen)</h2>
        <Link href={construirHrefExportar(seleccion)} className={BOTON}>
          Exportar CSV
        </Link>
      </div>
      <FilaMonto etiqueta="Débito fiscal" monto={casillas.debitoFiscal} />
      <FilaMonto etiqueta="Crédito / adelantos" monto={casillas.creditoAdelantos} />
      <FilaMonto etiqueta="ITBIS retenido (casilla 60 = Σ606)" monto={casillas.itbisRetenido} />
      <FilaMonto etiqueta="ISR retenido" monto={casillas.isrRetenido} />
      <FilaMonto etiqueta="Neto a pagar (débito − crédito)" monto={casillas.netoAPagar} />

      {casillas.avisoValidacion !== null ? (
        <p
          role="alert"
          className="mt-4 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200"
        >
          {casillas.avisoValidacion}
        </p>
      ) : (
        <p className="mt-4 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:border-emerald-700 dark:bg-emerald-950 dark:text-emerald-200">
          Cuadre: el ITBIS retenido (casilla 60) coincide con la Σ del 606.
        </p>
      )}

      <p className="mt-4 text-xs text-zinc-500 dark:text-zinc-400">{NOTA_VENCIMIENTO_IT1}</p>
      <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
        IT-1 se declara en la Oficina Virtual (formulario interactivo). La DGII <strong>no</strong>{" "}
        acepta un archivo TXT del IT-1: esta pantalla es un resumen de casillas.
      </p>
    </section>
  );
}

/** The DGII format descriptions (selector-first list-before-export, EXP-5). */
const DESCRIPCION_DGII: Record<"dgii-606" | "dgii-607" | "dgii-608", { titulo: string; detalle: string }> = {
  "dgii-607": {
    titulo: "Formato 607 — Ventas e ingresos",
    detalle:
      "Comprobantes VIGENTE B01/B03/B04 y B02 ≥ al umbral configurable. Encabezado de 5 campos + detalle de 23 columnas; las formas de pago D17–D23 cuadran al total bruto.",
  },
  "dgii-606": {
    titulo: "Formato 606 — Compras e ingresos",
    detalle:
      "Compras en estado RECIBIDA o PAGADA. Las compras B11 (informales) llevan el ITBIS al costo (sin crédito). Detalle de ~23 columnas.",
  },
  "dgii-608": {
    titulo: "Formato 608 — Comprobantes anulados",
    detalle:
      "Solo facturas en estado ANULADA (las CANCELADA no aparecen ni en el 607 ni en el 608). 3 columnas: NCF, fecha de emisión y tipo de anulación (1–10).",
  },
};

/** FIS-3/4/5/6 — a DGII TXT export panel (format card + pending-validation notice + download). */
export function PanelDgiiTxt({
  reporte,
  seleccion,
}: {
  readonly reporte: ReporteId;
  readonly seleccion: SeleccionReporte;
}) {
  const info =
    reporte === "dgii-606" || reporte === "dgii-607" || reporte === "dgii-608"
      ? DESCRIPCION_DGII[reporte]
      : null;
  if (info === null) return null;
  return (
    <section
      aria-label={info.titulo}
      className="rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900"
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">{info.titulo}</h2>
        <Link href={construirHrefExportarTxt(seleccion)} className={BOTON}>
          Descargar TXT DGII
        </Link>
      </div>
      <p className="mb-4 text-sm text-zinc-600 dark:text-zinc-300">{info.detalle}</p>
      <AvisoPrevalidacion />
      <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
        Si el período supera el tope de registros por archivo, la exportación produce varios TXT
        determinísticos (cada uno dentro del tope); descargue cada parte desde aquí.
      </p>
    </section>
  );
}
