/**
 * Inventario "Historial de movimientos" route (odd/tasks/inventario-historial.md S1/S2).
 * Read-only sub-route reached from the stock list, not a menu entry. Server
 * component shell: resolves the tenant context from the Supabase session and
 * redirects to `/login` when there is none, then asks the permission seam whether
 * the caller is in the manage group (Administrador). Deny by default: anything but
 * an explicit yes renders only an access message and never reads the history.
 * `listarMovimientosInventarioAction` re-checks the role on every call regardless.
 */

import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { getCurrentTenantContext } from "@/modules/tenant/infrastructure/tenant-runtime";
import {
  listarMovimientosInventarioAction,
  obtenerPermisosInventarioAction,
} from "@/modules/inventario/http/actions";
import { TIPOS_MOVIMIENTO } from "@/modules/inventario/domain/movimientos";
import {
  MovimientosScreen,
  type FiltrosMovimientos,
  type MovimientosInicial,
} from "@/modules/inventario/ui/MovimientosScreen";
import { TAMANO_PAGINA } from "@/modules/inventario/ui/paginacion";

type Param = string | string[] | undefined;

const FECHA_SD_RE = /^\d{4}-\d{2}-\d{2}$/;

function primero(valor: Param): string {
  return (Array.isArray(valor) ? valor[0] : valor) ?? "";
}

function enteroPositivo(valor: Param): number | null {
  const n = Number.parseInt(primero(valor), 10);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function fechaSD(valor: Param): string {
  const v = primero(valor);
  return FECHA_SD_RE.test(v) ? v : "";
}

async function puedeVerHistorial(): Promise<boolean> {
  try {
    const permisos = await obtenerPermisosInventarioAction();
    return permisos.ok && permisos.data.puedeAjustar;
  } catch {
    // A failed permission check is a refusal, not a reason to read the history.
    return false;
  }
}

export default async function InventarioMovimientosPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, Param>>;
}) {
  const supabase = await createClient();
  const ctx = await getCurrentTenantContext(supabase);
  if (ctx === null) {
    redirect("/login");
  }

  if (!(await puedeVerHistorial())) {
    return (
      <main className="mx-auto w-full max-w-6xl px-6 py-10">
        <div className="flex flex-col items-start gap-4">
          <p
            role="alert"
            className="rounded-md bg-red-50 px-4 py-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-200"
          >
            No tiene permisos para ver el historial de movimientos.
          </p>
          <Link
            href="/inventario"
            className="inline-flex min-h-12 items-center rounded-md border border-zinc-300 px-5 text-sm font-medium text-zinc-700 dark:border-zinc-700 dark:text-zinc-300"
          >
            Volver a Inventario
          </Link>
        </div>
      </main>
    );
  }

  const params = await searchParams;
  const page = enteroPositivo(params.page) ?? 1;
  const filtros: FiltrosMovimientos = {
    tipo: TIPOS_MOVIMIENTO.find((t) => t === primero(params.tipo)) ?? null,
    producto: primero(params.producto).trim().slice(0, 100),
    desde: fechaSD(params.desde),
    hasta: fechaSD(params.hasta),
  };

  const resultado = await listarMovimientosInventarioAction({
    page,
    limit: TAMANO_PAGINA,
    ...(filtros.tipo === null ? {} : { tipo: filtros.tipo }),
    ...(filtros.producto === "" ? {} : { producto: filtros.producto }),
    ...(filtros.desde === "" ? {} : { desde: filtros.desde }),
    ...(filtros.hasta === "" ? {} : { hasta: filtros.hasta }),
  });
  const inicial: MovimientosInicial = resultado.ok
    ? { ok: true, data: resultado.data }
    : { ok: false, message: resultado.error.message };

  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-10">
      <div className="mb-6 flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
          Historial de movimientos
        </h1>
        <Link
          href="/inventario"
          className="inline-flex min-h-12 items-center rounded-md border border-zinc-300 px-5 text-sm font-medium text-zinc-700 dark:border-zinc-700 dark:text-zinc-300"
        >
          Volver a Inventario
        </Link>
      </div>
      <MovimientosScreen inicial={inicial} filtrosIniciales={filtros} />
    </main>
  );
}
