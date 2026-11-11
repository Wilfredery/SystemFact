/**
 * `/caja` route (screens plan Step 8, `odd/tasks/caja.md` S7).
 *
 * Server component shell, cloned from the Compras/Administración pattern: it resolves the tenant
 * context from the Supabase session through `getCurrentTenantHeader` (the same identity read the
 * shell header uses, so the empresa/sucursal names render read-only) and redirects to `/login`
 * when there is none. It then reads BOTH boards in one round trip:
 *
 *   obtenerPermisosCajaAction()   → the named role group, never a literal role here
 *   consultarCierreCajaAction({}) → 06a (KPIs, método table, corte)
 *   consultarResumenDiaAction({}) → 06b (ventas, costo, margen), read SEPARATELY (S2)
 *
 * There is deliberately NO `searchParams`: the close is always TODAY in America/Santo_Domingo and
 * the scope is the session's empresa + sucursal, so a retroactive date or a branch override has no
 * way in (S1). The actions re-validate and re-gate on the server regardless.
 *
 * Role gate: only an explicit `puedeVer` opens the boards; anything else (a refusal, or a failed
 * permission call) renders the access message and NEVER the data — deny by default. Hiding the
 * route would not be the control; each read action re-checks its own gate.
 */

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { getCurrentTenantHeader } from "@/modules/tenant/infrastructure/tenant-runtime";
import {
  consultarCierreCajaAction,
  consultarResumenDiaAction,
  obtenerPermisosCajaAction,
} from "@/modules/caja/http/actions.lectura";
import { CajaScreen } from "@/modules/caja/ui/CajaScreen";

export default async function CajaPage() {
  const supabase = await createClient();
  const ctx = await getCurrentTenantHeader(supabase);
  if (ctx === null) {
    redirect("/login");
  }

  const [permisos, cierre, resumen] = await Promise.all([
    obtenerPermisosCajaAction().catch(() => null),
    consultarCierreCajaAction({}).catch(() => null),
    consultarResumenDiaAction({}).catch(() => null),
  ]);

  const puedeVer = permisos !== null && permisos.ok && permisos.data.puedeVer;
  // Only a permitted caller's successful pair reaches the island; every other shape renders a
  // plain message with NO board data.
  const datos =
    puedeVer && cierre !== null && cierre.ok && resumen !== null && resumen.ok
      ? { cierre: cierre.data, resumen: resumen.data }
      : null;

  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-10">
      <div className="mb-6 flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Caja</h1>
      </div>
      {datos !== null ? (
        <CajaScreen
          cierre={datos.cierre}
          resumen={datos.resumen}
          empresaNombre={ctx.empresaNombre}
          sucursalNombre={ctx.sucursalNombre}
        />
      ) : (
        <p
          role="alert"
          className="rounded-md bg-red-50 px-4 py-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-200"
        >
          {puedeVer && cierre !== null && !cierre.ok
            ? cierre.error.message
            : puedeVer && resumen !== null && !resumen.ok
              ? resumen.error.message
            : puedeVer
              ? "No se pudo cargar el cierre del día. Intenta de nuevo."
              : "No tiene permisos para ver la Caja."}
        </p>
      )}
    </main>
  );
}
