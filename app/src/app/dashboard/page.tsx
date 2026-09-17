/**
 * `/dashboard` route — the REAL KPI dashboard replacing the provisional placeholder
 * (AC docs/15 §8.9; DB-1, DB-2).
 *
 * Server component (AGENTS.md "server components by default"). It keeps the session header
 * (name / empresa / sucursal + logout) and replaces the empty panel body with the role-aware
 * KPI tiles, fetched through `consultarDashboardAction` — the single thin adapter that owns
 * the tenant transaction and the SERVER-side role gate (DB-2). The page itself queries NO
 * data: the use case decides (from the user's real DB roles) whether to widen company-wide
 * (Admin), pin to the assignment branch (Cobrador → CxC family only), or refuse
 * (`REPORTE_NO_AUTORIZADO`). The dashboard also doubles as the nav hub into `/reportes`
 * (decision: single selector page; proposal "Dashboard doubles as nav hub").
 *
 * A denied role is NOT redirected: the action returns the stable code and we render a plain
 * access message — the server gate is authoritative, hiding the route would not be (DB-2).
 */

import { redirect } from "next/navigation";
import { getCurrentUserContext } from "@/modules/auth/http/actions";
import { logoutAction } from "@/modules/auth/http/actions";
import { REPORTE_NO_AUTORIZADO } from "@/modules/reportes/domain/errors";
import { consultarDashboardAction } from "@/modules/reportes/http/actions";
import { DashboardKpis } from "@/modules/reportes/ui/dashboard-kpis";

export default async function DashboardPage() {
  const user = await getCurrentUserContext();

  if (user === null) {
    redirect("/login");
  }

  const resultado = await consultarDashboardAction();

  return (
    <div className="flex flex-1 flex-col">
      <header className="flex items-center justify-between border-b border-zinc-200 bg-white px-6 py-4 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-600 text-sm font-bold text-white">
            SF
          </div>
          <span className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
            SystemFact
          </span>
        </div>

        <form action={logoutAction}>
          <button
            type="submit"
            className="flex h-11 items-center justify-center rounded-lg border border-zinc-300 px-4 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            Cerrar sesión
          </button>
        </form>
      </header>

      <main className="flex flex-1 flex-col items-start gap-6 px-6 py-10">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
            Hola, {user.nombre}
          </h1>
          <p className="text-zinc-500 dark:text-zinc-400">
            {user.empresa?.nombreComercial ?? "Empresa"}
            {user.sucursal ? ` · ${user.sucursal.nombre}` : ""}
          </p>
        </div>

        {resultado.ok ? (
          <DashboardKpis vista={resultado.data} />
        ) : resultado.error.code === REPORTE_NO_AUTORIZADO ? (
          <p
            role="alert"
            className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-200"
          >
            Su rol no incluye paneles de reporte.
          </p>
        ) : (
          <p
            role="alert"
            className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-200"
          >
            {resultado.error.message}
          </p>
        )}
      </main>
    </div>
  );
}
