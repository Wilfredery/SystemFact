/**
 * Clientes route (screens plan Step 3, `odd/tasks/clientes.md`).
 *
 * Server component shell: resolves the tenant context from the Supabase session
 * and redirects to `/login` when there is none, then reads the first page
 * through the same `listarClientesAction` the client island re-queries.
 *
 * Role gate (S3, owner L9): the Administrador manages (create/edit/deactivate)
 * and Operador/Despachador are view-only — they still see the list, because they
 * sell to and collect from these clients. The manage controls AND the credit
 * fields come from the permission seam, which reads the named role groups, so
 * this page never names a role. A failed permission call hides both (deny by
 * default) but never breaks the read-only list. Every write action re-checks on
 * the server.
 */

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { getCurrentTenantContext } from "@/modules/tenant/infrastructure/tenant-runtime";
import {
  listarClientesAction,
  obtenerPermisosClienteAction,
} from "@/modules/cliente/http/actions";
import {
  ClientesScreen,
  type ClientesInicial,
} from "@/modules/cliente/ui/ClientesScreen";
import {
  ESTADOS_CLIENTE,
  TAMANO_PAGINA,
  type FiltrosClientes,
} from "@/modules/cliente/ui/clientes-filtros";

type Param = string | string[] | undefined;

function primero(valor: Param): string {
  return (Array.isArray(valor) ? valor[0] : valor) ?? "";
}

function enteroPositivo(valor: Param): number | null {
  const n = Number.parseInt(primero(valor), 10);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export default async function ClientesPage({
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
  const filtros: FiltrosClientes = {
    busqueda: primero(params.busqueda).trim().slice(0, 100),
    estado:
      ESTADOS_CLIENTE.find((e) => e.valor === primero(params.estado))?.valor ?? "activos",
  };

  const [permisos, resultado] = await Promise.all([
    obtenerPermisosClienteAction().catch(() => null),
    listarClientesAction({
      page,
      limit: TAMANO_PAGINA,
      estado: filtros.estado,
      ...(filtros.busqueda === "" ? {} : { buscar: filtros.busqueda }),
    }),
  ]);

  const puedeGestionar = permisos !== null && permisos.ok && permisos.data.puedeGestionar;
  const puedeVerCredito = permisos !== null && permisos.ok && permisos.data.puedeVerCredito;
  const inicial: ClientesInicial = resultado.ok
    ? { ok: true, data: resultado.data }
    : { ok: false, message: resultado.error.message };

  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-10">
      <div className="mb-6 flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Clientes</h1>
      </div>
      <ClientesScreen
        inicial={inicial}
        filtrosIniciales={filtros}
        puedeGestionar={puedeGestionar}
        puedeVerCredito={puedeVerCredito}
      />
    </main>
  );
}
