/**
 * Administración route (screens plan Step 7, `odd/tasks/administracion.md`
 * S2/S6/S7).
 *
 * Server component shell: resolves the tenant context from the Supabase session
 * and redirects to `/login` when there is none, validates the URL contract
 * (`tab`/`page`/`busqueda`/`activo`) and reads the CURRENT tab through the tenant
 * read actions T1 exposed.
 *
 * Writes (Step 7b, `odd/tasks/administracion-writes.md` S11): the Usuarios tab
 * offers role assignment and activate/deactivate to the same Administrador the
 * gate below lets in (`ROLES_GESTION_USUARIOS` and `ROLES_VER_ADMINISTRACION` are
 * both Administrador today; if they ever diverge, give the screen its own probe).
 * The session user id lets the UI disable the actions on one's own row. Both are
 * UX only: every write action re-checks the role and RLS is the second wall.
 * There is still no user/branch creation, and no branch move.
 *
 * Role gate (S3/S6): the Administrador group (`ROLES_VER_ADMINISTRACION`, read
 * through `obtenerPermisosAdministracionAction`) is the only way in. Anything
 * but an explicit `puedeVer` renders the access message and NEVER the data —
 * deny by default, and every read action re-checks on the server regardless.
 *
 * The tab labels/values live in the PURE helper module, not in the client
 * island: a server component importing a constant from a `"use client"` module
 * would receive a client reference instead of the value.
 */

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { getCurrentTenantContext } from "@/modules/tenant/infrastructure/tenant-runtime";
import {
  consultarConfiguracionAction,
  listarSucursalesDeEmpresaAction,
  listarUsuariosAction,
  obtenerPermisosAdministracionAction,
} from "@/modules/tenant/http/actions.administracion";
import {
  AdministracionScreen,
  type ConfiguracionInicial,
  type SucursalesInicial,
  type UsuariosInicial,
} from "@/modules/tenant/ui/AdministracionScreen";
import {
  activoDesdeParam,
  construirQueryUsuarios,
  tabDesdeParam,
  type FiltrosUsuarios,
} from "@/modules/tenant/ui/administracion-tabs";

type Param = string | string[] | undefined;

function primero(valor: Param): string {
  return (Array.isArray(valor) ? valor[0] : valor) ?? "";
}

function enteroPositivo(valor: Param): number | null {
  const n = Number.parseInt(primero(valor), 10);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export default async function AdministracionPage({
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
  const tab = tabDesdeParam(primero(params.tab));
  const page = enteroPositivo(params.page) ?? 1;
  const filtros: FiltrosUsuarios = {
    busqueda: primero(params.busqueda).trim().slice(0, 100),
    activo: activoDesdeParam(primero(params.activo)),
  };

  const [permisos, lectura] = await Promise.all([
    obtenerPermisosAdministracionAction().catch(() => null),
    tab === "usuarios"
      ? listarUsuariosAction(construirQueryUsuarios(filtros, page))
      : tab === "sucursales"
        ? listarSucursalesDeEmpresaAction()
        : consultarConfiguracionAction(),
  ]);

  const puedeVer = permisos !== null && permisos.ok && permisos.data.puedeVer;

  // Each tab's payload is narrowed from the same `Promise.all` slot: only the
  // current tab's action ran, so exactly one of these is non-null.
  let usuarios: UsuariosInicial | null = null;
  let sucursales: SucursalesInicial | null = null;
  let configuracion: ConfiguracionInicial | null = null;

  if (tab === "usuarios") {
    const r = lectura as Awaited<ReturnType<typeof listarUsuariosAction>>;
    usuarios = r.ok ? { ok: true, data: r.data } : { ok: false, message: r.error.message };
  } else if (tab === "sucursales") {
    const r = lectura as Awaited<ReturnType<typeof listarSucursalesDeEmpresaAction>>;
    sucursales = r.ok ? { ok: true, data: r.data } : { ok: false, message: r.error.message };
  } else {
    const r = lectura as Awaited<ReturnType<typeof consultarConfiguracionAction>>;
    configuracion = r.ok ? { ok: true, data: r.data } : { ok: false, message: r.error.message };
  }

  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-10">
      <div className="mb-6 flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Administración</h1>
      </div>
      {puedeVer ? (
        <AdministracionScreen
          tab={tab}
          filtrosIniciales={filtros}
          usuarios={usuarios}
          sucursales={sucursales}
          configuracion={configuracion}
          puedeGestionar={puedeVer}
          sesionUsuarioId={ctx.usuarioId}
        />
      ) : (
        <p
          role="alert"
          className="rounded-md bg-red-50 px-4 py-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-200"
        >
          No tiene permisos para ver la Administración.
        </p>
      )}
    </main>
  );
}
