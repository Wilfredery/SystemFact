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

type Param = string | string[] | undefined;

export default async function InventarioAjustePage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, Param>>;
}) {
  const supabase = await createClient();
  const ctx = await getCurrentTenantContext(supabase);
  if (ctx === null) {
    redirect("/login");
  }

  const params = await searchParams;
  const productoParam = (Array.isArray(params.producto) ? params.producto[0] : params.producto) ?? "";
  // Row-menu prefill (board-04 S19): the product's code. Sanitized like every
  // free-text query; the form resolves it through the same search action.
  const productoPreseleccionado = productoParam.trim().slice(0, 100);

  const puedeAjustar = await puedeAjustarInventario();

  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-10">
      {puedeAjustar ? (
        <AjusteInventarioForm productoPreseleccionado={productoPreseleccionado} />
      ) : (
        <div className="flex flex-col items-start gap-4">
          <p role="alert" className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
            No tiene permisos para ajustar inventario.
          </p>
          <Link
            href="/inventario"
            className={"inline-flex h-12 items-center justify-center gap-2 rounded-lg border border-line bg-surface px-4 text-sm font-medium whitespace-nowrap transition-colors outline-none hover:bg-surface-muted hover:text-ink select-none"}
          >
            Volver a Inventario
          </Link>
        </div>
      )}
    </main>
  );
}
