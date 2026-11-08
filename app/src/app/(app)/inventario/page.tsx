/**
 * Inventario consulta route (wireframe `04-Inventario-Consulta`). Server component
 * shell: resolves the tenant context from the Supabase session and redirects to
 * `/login` when there is none, then reads the first page through the same
 * `consultarInventarioAction` the client island re-queries. Role gating lives in
 * the action, not here; a refusal is handed to the island as a visible message.
 */

import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { getCurrentTenantContext } from "@/modules/tenant/infrastructure/tenant-runtime";
import {
  consultarInventarioAction,
  obtenerPermisosInventarioAction,
} from "@/modules/inventario/http/actions";
import {
  InventarioScreen,
  type FiltrosInventario,
  type InventarioInicial,
} from "@/modules/inventario/ui/InventarioScreen";
import { TAMANO_PAGINA } from "@/modules/inventario/ui/paginacion";

type Param = string | string[] | undefined;

const ESTADOS = ["normal", "bajo_stock", "agotado"] as const;

function primero(valor: Param): string {
  return (Array.isArray(valor) ? valor[0] : valor) ?? "";
}

function enteroPositivo(valor: Param): number | null {
  const n = Number.parseInt(primero(valor), 10);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export default async function InventarioPage({
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
  const filtros: FiltrosInventario = {
    busqueda: primero(params.busqueda).trim().slice(0, 100),
    categoriaId: enteroPositivo(params.categoriaId),
    estado: ESTADOS.find((e) => e === primero(params.estado)) ?? null,
  };

  // Only the manage group sees the adjust link; hiding it is a courtesy, the
  // adjust page and the action both re-check on the server.
  const permisos = await obtenerPermisosInventarioAction();
  const puedeAjustar = permisos.ok && permisos.data.puedeAjustar;

  const resultado = await consultarInventarioAction({
    page,
    limit: TAMANO_PAGINA,
    ...(filtros.busqueda === "" ? {} : { busqueda: filtros.busqueda }),
    ...(filtros.categoriaId === null ? {} : { categoriaId: filtros.categoriaId }),
    ...(filtros.estado === null ? {} : { estado: filtros.estado }),
  });
  const inicial: InventarioInicial = resultado.ok
    ? { ok: true, data: resultado.data }
    : { ok: false, message: resultado.error.message };

  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-10">
      <div className="mb-6 flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Inventario</h1>
        {puedeAjustar && (
          <Link
            href="/inventario/ajuste"
            className="inline-flex min-h-12 items-center rounded-md bg-zinc-900 px-5 text-sm font-medium text-white dark:bg-zinc-50 dark:text-zinc-900"
          >
            + Ajustar
          </Link>
        )}
      </div>
      <InventarioScreen inicial={inicial} filtrosIniciales={filtros} />
    </main>
  );
}
