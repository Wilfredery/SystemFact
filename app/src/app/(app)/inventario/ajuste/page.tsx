/**
 * Inventario adjust route (wireframe `04-Inventario-Ajuste`). Server component
 * shell: resolves the tenant context from the Supabase session and redirects to
 * `/login` when there is none, then asks the permission seam whether the caller
 * may adjust stock. Deny by default: anything but an explicit yes renders only
 * an access message, never the form. `ajustarInventarioAction` re-checks the
 * role on every call regardless.
 */

import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { getCurrentTenantContext } from "@/modules/tenant/infrastructure/tenant-runtime";
import { obtenerPermisosInventarioAction } from "@/modules/inventario/http/actions";
import { AjusteInventarioForm } from "@/modules/inventario/ui/AjusteInventarioForm";

async function puedeAjustarInventario(): Promise<boolean> {
  try {
    const permisos = await obtenerPermisosInventarioAction();
    return permisos.ok && permisos.data.puedeAjustar;
  } catch {
    // A failed permission check is a refusal, not a reason to show the form.
    return false;
  }
}

export default async function InventarioAjustePage() {
  const supabase = await createClient();
  const ctx = await getCurrentTenantContext(supabase);
  if (ctx === null) {
    redirect("/login");
  }

  const puedeAjustar = await puedeAjustarInventario();

  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-10">
      {puedeAjustar ? (
        <AjusteInventarioForm />
      ) : (
        <div className="flex flex-col items-start gap-4">
          <p
            role="alert"
            className="rounded-md bg-red-50 px-4 py-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-200"
          >
            No tiene permisos para ajustar inventario.
          </p>
          <Link
            href="/inventario"
            className="inline-flex min-h-12 items-center rounded-md border border-zinc-300 px-5 text-sm font-medium text-zinc-700 dark:border-zinc-700 dark:text-zinc-300"
          >
            Volver a Inventario
          </Link>
        </div>
      )}
    </main>
  );
}
