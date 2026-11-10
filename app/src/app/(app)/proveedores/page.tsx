/**
 * Proveedores route (screens plan Step 4, `odd/tasks/proveedores.md`).
 *
 * Server component shell: resolves the tenant context from the Supabase session
 * and redirects to `/login` when there is none, then reads the first page
 * through the same `listarProveedoresAction` the client island re-queries.
 *
 * Role gate (S3, owner L9): the Administrador manages (create/edit/deactivate)
 * and Operador/Despachador are view-only — they still see the list, because they
 * receive purchases. The manage controls come from the permission seam, which
 * reads the named role groups, so this page never names a role. A failed
 * permission call hides them (deny by default) but never breaks the read-only
 * list. Every write action re-checks on the server.
 */

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { getCurrentTenantContext } from "@/modules/tenant/infrastructure/tenant-runtime";
import {
  listarProveedoresAction,
  obtenerPermisosProveedorAction,
} from "@/modules/proveedor/http/actions";
import {
  ProveedoresScreen,
  type ProveedoresInicial,
} from "@/modules/proveedor/ui/ProveedoresScreen";
import {
  ESTADOS_PROVEEDOR,
  construirQueryProveedores,
  type FiltrosProveedores,
} from "@/modules/proveedor/ui/proveedores-filtros";

type Param = string | string[] | undefined;

function primero(valor: Param): string {
  return (Array.isArray(valor) ? valor[0] : valor) ?? "";
}

function enteroPositivo(valor: Param): number | null {
  const n = Number.parseInt(primero(valor), 10);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export default async function ProveedoresPage({
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
  const page = enteroPositivo(params.page) ?? 1;
  const filtros: FiltrosProveedores = {
    busqueda: primero(params.busqueda).trim().slice(0, 100),
    estado:
      ESTADOS_PROVEEDOR.find((e) => e.valor === primero(params.estado))?.valor ?? "activos",
  };

  const [permisos, resultado] = await Promise.all([
    obtenerPermisosProveedorAction().catch(() => null),
    // One query builder for the server first load and the island re-queries.
    listarProveedoresAction(construirQueryProveedores(filtros, page)),
  ]);

  const puedeGestionar = permisos !== null && permisos.ok && permisos.data.puedeGestionar;
  const inicial: ProveedoresInicial = resultado.ok
    ? { ok: true, data: resultado.data }
    : { ok: false, message: resultado.error.message };

  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-10">
      <div className="mb-6 flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Proveedores</h1>
      </div>
      <ProveedoresScreen
        inicial={inicial}
        filtrosIniciales={filtros}
        puedeGestionar={puedeGestionar}
      />
    </main>
  );
}
