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
 * The Sucursales tab reads ALL the branches (`listarSucursalesAdministracionAction`,
 * active and inactive) and gets the session branch id from the same tenant context,
 * so "Desactivar" is disabled on one's own branch (UX only; the server re-checks).
 * The "Mover de sucursal" dialog keeps its own active-only read.
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
import { getCurrentTenantHeader } from "@/modules/tenant/infrastructure/tenant-runtime";
import {
  consultarConfiguracionAction,
  listarRolesAdministracionAction,
  listarSucursalesAdministracionAction,
  listarUsuariosAction,
  obtenerPermisosAdministracionAction,
} from "@/modules/tenant/http/actions.administracion";
import {
  AdministracionScreen,
  type ConfiguracionInicial,
  type RolesInicial,
  type SucursalesInicial,
  type UsuariosInicial,
} from "@/modules/tenant/ui/AdministracionScreen";
import {
  activoDesdeParam,
  construirQueryUsuarios,
  resolverTabAdministracion,
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
  const ctx = await getCurrentTenantHeader(supabase);
  if (ctx === null) {
    redirect("/login");
  }

  const params = await searchParams;
  const tieneParamsDeUsuarios =
    primero(params.busqueda) !== "" || primero(params.activo) !== "" || primero(params.page) !== "";
  const tab = resolverTabAdministracion(primero(params.tab), tieneParamsDeUsuarios);
  const page = enteroPositivo(params.page) ?? 1;
  const filtros: FiltrosUsuarios = {
    busqueda: primero(params.busqueda).trim().slice(0, 100),
    activo: activoDesdeParam(primero(params.activo)),
  };

  const [permisos, lectura] = await Promise.all([
    obtenerPermisosAdministracionAction().catch(() => null),
    tab === "usuarios"
      ? listarUsuariosAction(construirQueryUsuarios(filtros, page))
      : tab === "empresas" || tab === "sucursales"
        ? listarSucursalesAdministracionAction()
        : tab === "roles"
          ? listarRolesAdministracionAction()
          : consultarConfiguracionAction(),
  ]);

  const puedeVer = permisos !== null && permisos.ok && permisos.data.puedeVer;

  // Each tab's payload is narrowed from the same `Promise.all` slot: only the
  // current tab's action ran, so exactly one of these is non-null.
  let usuarios: UsuariosInicial | null = null;
  let sucursales: SucursalesInicial | null = null;
  let configuracion: ConfiguracionInicial | null = null;
  let roles: RolesInicial | null = null;

  if (tab === "usuarios") {
    const r = lectura as Awaited<ReturnType<typeof listarUsuariosAction>>;
    usuarios = r.ok ? { ok: true, data: r.data } : { ok: false, message: r.error.message };
  } else if (tab === "empresas" || tab === "sucursales") {
    const r = lectura as Awaited<ReturnType<typeof listarSucursalesAdministracionAction>>;
    sucursales = r.ok ? { ok: true, data: r.data } : { ok: false, message: r.error.message };
  } else if (tab === "roles") {
    const r = lectura as Awaited<ReturnType<typeof listarRolesAdministracionAction>>;
    roles = r.ok ? { ok: true, data: r.data } : { ok: false, message: r.error.message };
  } else {
    const r = lectura as Awaited<ReturnType<typeof consultarConfiguracionAction>>;
    configuracion = r.ok ? { ok: true, data: r.data } : { ok: false, message: r.error.message };
  }

  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-10">
      <div className="mb-6 flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold text-ink">Administración</h1>
      </div>
      {puedeVer ? (
        <AdministracionScreen
          // Remount per tab: the island seeds its list state from props once, and a tab
          // switch is a navigation to the SAME route, so without a key the Usuarios
          // rows of a fresh server read would be ignored (caught by the e2e suite).
          key={tab}
          tab={tab}
          filtrosIniciales={filtros}
          usuarios={usuarios}
          sucursales={sucursales}
          configuracion={configuracion}
          roles={roles}
          empresaNombre={ctx.empresaNombre}
          puedeGestionar={puedeVer}
          sesionUsuarioId={ctx.usuarioId}
          sesionSucursalId={ctx.sucursalId}
        />
      ) : (
        <p
          role="alert"
          className="rounded-md bg-danger/10 px-4 py-2 text-sm text-danger"
        >
          No tiene permisos para ver la Administración.
        </p>
      )}
    </main>
  );
}
