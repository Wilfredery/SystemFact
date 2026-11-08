/**
 * Inventario consulta route (wireframe `04-Inventario-Consulta`). Server component
 * shell: resolves the tenant context from the Supabase session and redirects to
 * `/login` when there is none, then reads the first page through the same
 * `consultarInventarioAction` the client island re-queries. Role gating lives in
 * the action, not here; a refusal is handed to the island as a visible message.
 */

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { getCurrentTenantContext } from "@/modules/tenant/infrastructure/tenant-runtime";
import { consultarInventarioAction } from "@/modules/inventario/http/actions";
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
      <h1 className="mb-6 text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Inventario</h1>
      <InventarioScreen inicial={inicial} filtrosIniciales={filtros} />
    </main>
  );
}
