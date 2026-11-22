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
      <header className="flex items-center justify-between border-b border-line bg-surface px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent text-sm font-bold text-accent-fg">
            SF
          </div>
          <span className="text-lg font-semibold text-ink">
            SystemFact
          </span>
        </div>

        <form action={logoutAction}>
          <button
            type="submit"
            className="flex h-11 items-center justify-center rounded-lg border border-line px-4 text-sm font-medium text-ink transition hover:bg-surface-muted"
          >
            Cerrar sesión
          </button>
        </form>
      </header>

      <main className="flex flex-1 flex-col items-start gap-6 px-6 py-10">
        <div>
          <h1 className="text-2xl font-semibold text-ink">
            Hola, {user.nombre}
          </h1>
          <p className="text-ink-muted">
            {user.empresa?.nombreComercial ?? "Empresa"}
            {user.sucursal ? ` · ${user.sucursal.nombre}` : ""}
          </p>
        </div>

        {resultado.ok ? (
          <DashboardKpis vista={resultado.data} />
        ) : resultado.error.code === REPORTE_NO_AUTORIZADO ? (
          <p
            role="alert"
            className="rounded-md bg-warn-bg px-3 py-2 text-sm text-warn"
          >
            Su rol no incluye paneles de reporte.
          </p>
        ) : (
          <p
            role="alert"
            className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger"
          >
            {resultado.error.message}
          </p>
        )}
      </main>
    </div>
  );
}
