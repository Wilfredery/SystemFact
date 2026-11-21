/**
 * Reportes UI — the SELECTOR-FIRST shell control (EXP-5, decision 2.5.3).
 *
 * The `/reportes` screen MUST list the available reports BEFORE offering any export, so this
 * client island is a navigation-only affordance: choosing a report (and optionally a preset
 * period / branch) pushes the new selection onto the URL, which re-runs the SERVER page's
 * deep-link fetch with fresh `searchParams`. It holds NO data and issues NO query — the
 * single source of truth stays on the server (the same shape `./url` reads back), mirroring
 * `auditoria/ui/AuditFilters`. The submit control is disabled while a navigation transition
 * is in flight (the "disabled while busy" rule). Every panel is role-gated SERVER-SIDE in
 * the action; this selector renders the catalog only.
 */

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  CATALOGO_REPORTES,
  esReporteImplementado,
  type FamiliaReporte,
  type ReporteId,
} from "../domain/catalogo";
import { PRESETS_PERIODICO, type PresetPeriodico } from "../domain/reporte-filtro";
import { ETIQUETA_FAMILIA } from "./format";
import { construirHref, type SeleccionReporte } from "./url";

/** Group the catalog by family, preserving catalog order, for the sectioned selector. */
function porFamilias(): { familia: FamiliaReporte; ids: ReporteId[] }[] {
  const orden: FamiliaReporte[] = [
    "DASHBOARD",
    "OPERACIONAL",
    "FINANCIERO",
    "COMPARATIVO",
    "RENTABILIDAD",
    "FISCAL",
  ];
  return orden
    .map((familia) => ({
      familia,
      ids: CATALOGO_REPORTES.filter((e) => e.familia === familia).map((e) => e.id),
    }))
    .filter((g) => g.ids.length > 0);
}

const ETIQUETA_PRESET: Record<PresetPeriodico, string> = {
  HOY: "Hoy",
  SEMANA: "Esta semana",
  MES: "Este mes",
  ANIO: "Este año",
};

/** A report is "próximamente" (panel lands in a later slice) unless it's wired (A dashboard, B operational). */
function esDisponible(id: ReporteId): boolean {
  return esReporteImplementado(id);
}

export function ReportSelector({
  seleccionInicial,
}: {
  readonly seleccionInicial: SeleccionReporte;
}) {
  const router = useRouter();
  const [pendiente, iniciar] = useTransition();
  const [reporte, setReporte] = useState<ReporteId>(seleccionInicial.reporte);
  const [preset, setPreset] = useState<string>(seleccionInicial.filtro.preset ?? "");

  const grupos = porFamilias();
  const actual = CATALOGO_REPORTES.find((e) => e.id === reporte);

  function navegar(nuevoReporte: ReporteId, nuevoPreset: string): void {
    const seleccion: SeleccionReporte = {
      reporte: nuevoReporte,
      filtro: {
        ...(nuevoPreset !== "" ? { preset: nuevoPreset } : {}),
      },
    };
    iniciar(async () => {
      await router.push(construirHref(seleccion));
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Reportes disponibles">
        {grupos.map((g) =>
          g.ids.map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={id === reporte}
              disabled={pendiente}
              onClick={() => {
                setReporte(id);
                navegar(id, id === reporte ? preset : "");
              }}
              className={
                id === reporte
                  ? "rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg disabled:opacity-40"
                  : "rounded-md border border-line px-3 py-1.5 text-sm font-medium text-ink hover:bg-surface-muted disabled:opacity-40"
              }
            >
              {CATALOGO_REPORTES.find((e) => e.id === id)?.etiqueta ?? id}
              {!esDisponible(id) && (
                <span className="ml-1 text-xs opacity-60">·</span>
              )}
            </button>
          )),
        )}
      </div>

      {actual !== undefined && (
        <div className="rounded-lg border border-line bg-surface p-4">
          <p className="text-sm text-ink-muted">
            {ETIQUETA_FAMILIA[actual.familia]} · {actual.etiqueta}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <label htmlFor="rep-preset" className="text-sm font-medium text-ink">
              Período
            </label>
            <select
              id="rep-preset"
              aria-label="Período"
              value={preset}
              disabled={pendiente}
              onChange={(e) => {
                setPreset(e.target.value);
                navegar(reporte, e.target.value);
              }}
              className="rounded border border-line px-2 py-1 text-sm text-ink"
            >
              <option value="">Rango libre</option>
              {PRESETS_PERIODICO.map((pp) => (
                <option key={pp} value={pp}>
                  {ETIQUETA_PRESET[pp]}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}
    </div>
  );
}
