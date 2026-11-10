/**
 * Productos route (plan Step 2 of the screens plan, `odd/tasks/productos.md`).
 *
 * Server component shell: resolves the tenant context from the Supabase session
 * and redirects to `/login` when there is none, then reads the first page
 * through the same `consultarProductosAction` the client island re-queries.
 *
 * Role gate (S3, L9): the Administrador manages (create/edit/deactivate) and
 * Operador/Despachador are view-only. The manage controls come from the
 * permission seam, which reads the manage role group — this page never names a
 * role. A failed permission call hides them (deny by default) but never breaks
 * the read-only list. Every write action re-checks on the server.
 */

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { getCurrentTenantContext } from "@/modules/tenant/infrastructure/tenant-runtime";
import {
  consultarProductosAction,
  obtenerPermisosProductoAction,
} from "@/modules/producto/http/actions";
import {
  ProductosScreen,
  type ProductosInicial,
} from "@/modules/producto/ui/ProductosScreen";
import {
  ESTADOS_PRODUCTO,
  TAMANO_PAGINA,
  type FiltrosProductos,
} from "@/modules/producto/ui/productos-filtros";

type Param = string | string[] | undefined;

function primero(valor: Param): string {
  return (Array.isArray(valor) ? valor[0] : valor) ?? "";
}

function enteroPositivo(valor: Param): number | null {
  const n = Number.parseInt(primero(valor), 10);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export default async function ProductosPage({
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
  const filtros: FiltrosProductos = {
    busqueda: primero(params.busqueda).trim().slice(0, 100),
    categoriaId: enteroPositivo(params.categoriaId),
    estado:
      ESTADOS_PRODUCTO.find((e) => e.valor === primero(params.estado))?.valor ?? "activos",
  };

  const [permisos, resultado] = await Promise.all([
    obtenerPermisosProductoAction().catch(() => null),
    consultarProductosAction({
      page,
      limit: TAMANO_PAGINA,
      estado: filtros.estado,
      ...(filtros.busqueda === "" ? {} : { busqueda: filtros.busqueda }),
      ...(filtros.categoriaId === null ? {} : { categoriaId: filtros.categoriaId }),
    }),
  ]);

  const puedeGestionar = permisos !== null && permisos.ok && permisos.data.puedeGestionar;
  const inicial: ProductosInicial = resultado.ok
    ? { ok: true, data: resultado.data }
    : { ok: false, message: resultado.error.message };

  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-10">
      <div className="mb-6 flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Productos</h1>
      </div>
      <ProductosScreen
        inicial={inicial}
        filtrosIniciales={filtros}
        puedeGestionar={puedeGestionar}
      />
    </main>
  );
}
