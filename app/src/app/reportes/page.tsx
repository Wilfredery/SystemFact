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
import { createClient } from "@/lib/supabase/client";
import { getCurrentTenantContext } from "@/modules/tenant/infrastructure/tenant-runtime";
import { REPORTE_NO_AUTORIZADO } from "@/modules/reportes/domain/errors";
import { REPORTE_ID } from "@/modules/reportes/domain/catalogo";
import { consultarDashboardAction } from "@/modules/reportes/http/actions";
import { DashboardKpis } from "@/modules/reportes/ui/dashboard-kpis";
import { ReportSelector } from "@/modules/reportes/ui/report-selector";
import {
  seleccionDesdeSearchParams,
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
  const esPanelVivo = seleccion.reporte === REPORTE_ID.DASHBOARD;

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
        {esPanelVivo ? (
          <PanelDashboard />
        ) : (
          <p
            className="rounded-lg border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400"
          >
            Este reporte se habilita en una entrega posterior.
          </p>
        )}
      </div>
    </main>
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
