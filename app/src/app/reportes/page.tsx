/**
 * `/reportes` route — the SELECTOR-FIRST server shell (EXP-5, decision 2.5.3; DB-5 deep links).
 *
 * Server by default (AGENTS.md "server components by default"). It resolves the tenant
 * context from the Supabase session (the SAME `getCurrentTenantContext` the actions use) and
 * redirects to `/login` when there is none — a not-signed-in visitor never reaches a read.
 * It then maps the awaited `searchParams` onto the stable deep-link selection
 * (`?reporte&desde&hasta&sucursalId&page&pageSize`, `ui/url.ts`) and renders:
 *   - the report selector (list-before-export / list-before-results, decision 2.5.3), and
 *   - the ACTIVE panel. For the DASHBOARD selection it fetches the FIRST render through
 *     `consultarDashboardAction` — the single thin adapter owning the tenant transaction and
 *     the SERVER-side role gate (DB-2), so the shell itself queries NOTHING. For a report
 *     whose panel lands in a later slice it renders an honest "próximamente" placeholder
 *     (no data, no query). The selector navigation re-pushes the URL, so any change re-runs
 *     THIS server fetch with fresh `searchParams` — the page and its figures always come from
 *     the canonical server read, never a client cache.
 *
 * The unauthorized case is NOT a redirect: the action returns the stable
 * `REPORTE_NO_AUTORIZADO` code and the shell renders a plain access message (the server gate
 * is authoritative; hiding the route would not be, per DB-2 "UI hiding is not the control").
 */

import { redirect } from "next/navigation";
import type { ReactElement } from "react";
import { createClient } from "@/lib/supabase/client";
import { getCurrentTenantContext } from "@/modules/tenant/infrastructure/tenant-runtime";
import { REPORTE_NO_AUTORIZADO } from "@/modules/reportes/domain/errors";
import { REPORTE_ID, type ReporteId } from "@/modules/reportes/domain/catalogo";
import type { ReporteFiltroEntrada } from "@/modules/reportes/domain/reporte-filtro";
import {
  type ActionResult,
  consultarDashboardAction,
  consultarEstadoFacturasAction,
  consultarInventarioValorizadoAction,
  consultarProductosVendidosAction,
  consultarVentasPorPeriodoAction,
  consultarComparativaAction,
  consultarCxcAgingAction,
  consultarCxPAction,
  consultarRentabilidadAction,
  consultarResumenITBISAction,
  consultarCasillasIT1Action,
} from "@/modules/reportes/http/actions";
import { DashboardKpis } from "@/modules/reportes/ui/dashboard-kpis";
import { PanelOperativo } from "@/modules/reportes/ui/operacional-panel";
import { PanelFinanciero } from "@/modules/reportes/ui/financiero-panel";
import { PanelRentabilidad } from "@/modules/reportes/ui/rentabilidad-panel";
import {
  PanelCasillasIT1,
  PanelDgiiTxt,
  PanelResumenITBIS,
} from "@/modules/reportes/ui/fiscal-panel";
import { ReportSelector } from "@/modules/reportes/ui/report-selector";
import {
  seleccionDesdeSearchParams,
  type SeleccionReporte,
  type SearchParamsInput,
} from "@/modules/reportes/ui/url";

/** Next 16 hands `searchParams` to a server page as a Promise. */
interface PageProps {
  readonly searchParams: Promise<SearchParamsInput>;
}

export default async function ReportesPage({ searchParams }: PageProps) {
  const supabase = await createClient();
  const ctx = await getCurrentTenantContext(supabase);
  if (ctx === null) {
    redirect("/login");
  }

  const seleccion = seleccionDesdeSearchParams(await searchParams);

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-10">
      <h1 className="mb-1 text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
        Reportes
      </h1>
      <p className="mb-6 text-sm text-zinc-500 dark:text-zinc-400">
        Seleccione un reporte para consultar sus resultados; la exportación está disponible
        desde cada panel de resultados.
      </p>

      <ReportSelector seleccionInicial={seleccion} />

      <div className="mt-8">
        <PanelReporte seleccion={seleccion} />
      </div>
    </main>
  );
}

/**
 * One registry row: the report's consult action (the SAME thin adapter + server-side DB-2
 * gate the previous conditionals called) and the panel to render on a typed success. The
 * page owns NO authorization — it only dispatches (R-QC-02).
 */
interface EntradaReporte {
  readonly consultar: (
    filtro: ReporteFiltroEntrada,
  ) => Promise<ActionResult<unknown>>;
  readonly render: (
    data: unknown,
    seleccion: SeleccionReporte,
  ) => ReactElement;
}

/**
 * Builds a type-safe registry row: the generic `T` (the action's success payload) is
 * correlated with the render parameter at the call site and erased ONCE for the
 * heterogeneous Record. Each panel keeps its own typed props, so the registry adds no casts
 * in the panel files and moves no logic out of the server actions.
 */
function entrada<T>(
  consultar: (
    filtro: ReporteFiltroEntrada,
  ) => Promise<ActionResult<T>>,
  render: (data: T, seleccion: SeleccionReporte) => ReactElement,
): EntradaReporte {
  return {
    consultar: consultar as EntradaReporte["consultar"],
    render: render as EntradaReporte["render"],
  };
}

/**
 * The `REPORTE_ID` → { consult action, panel } registry. The operational (slice B) and
 * financial (slice C) fleets share the {@link PanelOperativo}/{@link PanelFinanciero}
 * discriminant; rentabilidad (D) and the fiscal ITBIS/IT-1 summaries (E) keep their own
 * panels. DASHBOARD, the DGII 606/607/608 cards and the not-yet-wired fallback are handled
 * OUTSIDE this map as special cases (they carry no report-filter consult).
 */
const REGISTRO_REPORTES: Partial<Record<ReporteId, EntradaReporte>> = {
  [REPORTE_ID.VENTAS]: entrada(
    consultarVentasPorPeriodoAction,
    (pagina, seleccion) => (
      <PanelOperativo reporte="ventas" pagina={pagina} seleccion={seleccion} />
    ),
  ),
  [REPORTE_ID.PRODUCTOS]: entrada(
    consultarProductosVendidosAction,
    (pagina, seleccion) => (
      <PanelOperativo reporte="productos" pagina={pagina} seleccion={seleccion} />
    ),
  ),
  [REPORTE_ID.INVENTARIO]: entrada(
    consultarInventarioValorizadoAction,
    (pagina, seleccion) => (
      <PanelOperativo reporte="inventario" pagina={pagina} seleccion={seleccion} />
    ),
  ),
  [REPORTE_ID.FACTURAS]: entrada(
    consultarEstadoFacturasAction,
    (pagina, seleccion) => (
      <PanelOperativo reporte="facturas" pagina={pagina} seleccion={seleccion} />
    ),
  ),
  // Slice C — the financial fleet. A Cobrador reaching cxc is served their own-branch aging,
  // while cxp/comparativa deny SERVER-SIDE (FIN-3); the page renders whatever the gate returns.
  [REPORTE_ID.CXC]: entrada(
    consultarCxcAgingAction,
    (pagina, seleccion) => (
      <PanelFinanciero reporte="cxc" pagina={pagina} seleccion={seleccion} />
    ),
  ),
  [REPORTE_ID.CXP]: entrada(
    consultarCxPAction,
    (pagina, seleccion) => (
      <PanelFinanciero reporte="cxp" pagina={pagina} seleccion={seleccion} />
    ),
  ),
  [REPORTE_ID.COMPARATIVA]: entrada(
    consultarComparativaAction,
    (pagina, seleccion) => (
      <PanelFinanciero reporte="comparativa" pagina={pagina} seleccion={seleccion} />
    ),
  ),
  // Slice D — rentabilidad por producto (Administrador-only; the REN-3 disclaimer is in the panel).
  [REPORTE_ID.RENTABILIDAD]: entrada(
    consultarRentabilidadAction,
    (pagina, seleccion) => (
      <PanelRentabilidad pagina={pagina} seleccion={seleccion} />
    ),
  ),
  // Slice E — the fiscal summaries (Administrador-only). Both render a Decimal SUMMARY fetched
  // through the SAME gate; a non-admin is denied before any aggregate runs.
  [REPORTE_ID.ITBIS]: entrada(consultarResumenITBISAction, (resumen, seleccion) => (
    <PanelResumenITBIS resumen={resumen} seleccion={seleccion} />
  )),
  [REPORTE_ID.IT1]: entrada(consultarCasillasIT1Action, (casillas, seleccion) => (
    <PanelCasillasIT1 casillas={casillas} seleccion={seleccion} />
  )),
};

/**
 * Dispatches the active selection to its panel through {@link REGISTRO_REPORTES}. The
 * DASHBOARD renders its KPI tiles and the DGII 606/607/608 ids render their format card
 * (a TXT download that re-runs the identical server-side gate, EXP-4) — both are special
 * cases outside the registry. Every other report consults through its registered thin action
 * (the single server-side gate + tenant read) and renders its typed panel or, on a refusal,
 * a plain message. A not-yet-wired report renders an honest "próximamente" (no query). This
 * is a DISPATCH-ONLY selection: it performs no role/company/branch check (DB-2 lives in the
 * actions); the route is never hidden and no export control renders on a denial (EXP-4/EXP-5).
 */
async function PanelReporte({
  seleccion,
}: {
  readonly seleccion: SeleccionReporte;
}) {
  const { reporte } = seleccion;

  // DASHBOARD — the role-scoped KPI tile panel (no report filter, its own server gate).
  if (reporte === REPORTE_ID.DASHBOARD) {
    return <PanelDashboard />;
  }

  // DGII 606/607/608 — a format card, not a consultable dataset (the TXT export re-gates server-side).
  if (
    reporte === REPORTE_ID.DGII_606 ||
    reporte === REPORTE_ID.DGII_607 ||
    reporte === REPORTE_ID.DGII_608
  ) {
    return <PanelDgiiTxt reporte={reporte} seleccion={seleccion} />;
  }

  // Registry dispatch — call the row's consult action and render its typed success/error.
  const entradaReporte = REGISTRO_REPORTES[reporte];
  if (entradaReporte !== undefined) {
    const r = await entradaReporte.consultar(seleccion.filtro);
    return r.ok ? (
      entradaReporte.render(r.data, seleccion)
    ) : (
      <MensajeError code={r.error.code} message={r.error.message} />
    );
  }

  // Not-yet-wired report — honest placeholder, no query.
  return (
    <p className="rounded-lg border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
      Este reporte se habilita en una entrega posterior.
    </p>
  );
}

/**
 * The stable-code access/validation message. A refusal (`REPORTE_NO_AUTORIZADO`) shows the
 * permission copy; any other catalog code (e.g. `REPORTE_VALIDACION`) shows its message. The
 * route is NEVER hidden and no export control renders on a denial — the server gate is the
 * control (DB-2, EXP-4/EXP-5).
 */
function MensajeError({ code, message }: { readonly code: string; readonly message: string }) {
  return (
    <p
      role="alert"
      className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-200"
    >
      {code === REPORTE_NO_AUTORIZADO
        ? "No tiene permisos para consultar este reporte."
        : message}
    </p>
  );
}

/**
 * The dashboard panel for the `/reportes` hub. Fetches through the action inside its OWN
 * Server-Component boundary so the first paint runs the server-side gate + tenant read, and
 * renders the role-authorized tiles (or the stable access message on refusal).
 */
async function PanelDashboard() {
  const resultado = await consultarDashboardAction();

  if (resultado.ok) {
    return <DashboardKpis vista={resultado.data} />;
  }
  if (resultado.error.code === REPORTE_NO_AUTORIZADO) {
    return (
      <p
        role="alert"
        className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-200"
      >
        No tiene permisos para consultar este reporte.
      </p>
    );
  }
  return (
    <p
      role="alert"
      className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-200"
    >
      {resultado.error.message}
    </p>
  );
}
