"use client";

/**
 * Administración screen (screens plan Step 7, `odd/tasks/administracion.md`
 * S2/S6): the wireframe's three tabs. Sucursales and Configuración are read-only;
 * the Usuarios tab gains the Step 7b writes (`odd/tasks/administracion-writes.md`
 * S11) — role assignment and activate/deactivate — ONLY when the page says the
 * caller may manage (`puedeGestionar`). That prop is UX: the actions re-check the
 * role and RLS is the second wall. A write shows its result only after the server
 * answered ok (no optimistic state) and then re-reads the page's rows, so the
 * next write carries the fresh `version`.
 *
 * Client island for the interactivity only. The server page hands over the first
 * load of the CURRENT tab (already read through the tenant read actions) and
 * every filter/page change re-queries `listarUsuariosAction`. Tab switching is a
 * URL navigation, not a client fetch: the server page owns which tab's action
 * runs, so this island never names a role or issues a read for another tab.
 *
 * S6: 300 ms debounced search, tri-state `activo` filter, 25/page and
 * "Página X de Y". A slow earlier answer can never overwrite a newer filter's
 * rows (the `ultimaSolicitud` stale guard, same rule as Compras).
 */

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { listarUsuariosAction } from "@/modules/tenant/http/actions.administracion";
import {
  cambiarEstadoUsuarioAction,
  cambiarRolesUsuarioAction,
} from "@/modules/tenant/http/actions.usuarios";
import type {
  ConfiguracionAdministracionDto,
  ListarUsuariosAdministracion,
  SucursalAdministracionDto,
  UsuarioAdministracionDto,
} from "@/modules/tenant/http/shared";
import { TEN_CONCURRENCIA_CONFLICTO } from "@/modules/tenant/domain/errors";
import { formatearFechaSD } from "@/shared/ui/format/date";
import {
  DEBOUNCE_BUSQUEDA_MS,
  FILTROS_ACTIVO,
  MENSAJE_FALLO_ACCION,
  TABS_ADMINISTRACION,
  construirHrefAdministracion,
  construirQueryUsuarios,
  mensajeErrorGestion,
  type FiltrosUsuarios,
  type TabAdministracion,
} from "./administracion-tabs";
import { CambiarRolesDialog, ConfirmarEstadoUsuarioDialog } from "./GestionUsuarioDialogs";

/** What the open dialog is doing; the user is looked up in the CURRENT rows. */
type AccionUsuario =
  | { readonly tipo: "roles"; readonly usuarioId: number }
  | { readonly tipo: "estado"; readonly usuarioId: number };

const TITULO_PROPIO_USUARIO =
  "No puede modificar su propio usuario: pídalo a otro Administrador.";

export type UsuariosInicial =
  | { readonly ok: true; readonly data: ListarUsuariosAdministracion }
  | { readonly ok: false; readonly message: string };

export type SucursalesInicial =
  | { readonly ok: true; readonly data: readonly SucursalAdministracionDto[] }
  | { readonly ok: false; readonly message: string };

export type ConfiguracionInicial =
  | { readonly ok: true; readonly data: ConfiguracionAdministracionDto }
  | { readonly ok: false; readonly message: string };

const MENSAJE_FALLO_CARGA = "No se pudo cargar la lista de usuarios. Intente de nuevo.";

const CLASE_CONTROL =
  "min-h-11 rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50";
const CLASE_BOTON =
  "min-h-11 rounded-md border border-zinc-300 px-4 text-sm font-medium text-zinc-700 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300";
const CLASE_TABLA =
  "overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800";
const CLASE_CABECERA =
  "bg-zinc-50 text-xs uppercase text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400";
const CLASE_ALERTA =
  "rounded-md bg-red-50 px-4 py-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-200";

/** Retention parameters of the Configuración tab, labelled per wireframe 08c. */
const RETENCIONES: readonly { clave: "isr15" | "isr2" | "itbis100" | "itbis30"; etiqueta: string }[] =
  [
    { clave: "isr15", etiqueta: "Ret. ISR servicios profesionales" },
    { clave: "isr2", etiqueta: "Ret. ISR servicios técnicos" },
    { clave: "itbis100", etiqueta: "Ret. ITBIS compra informal (100%)" },
    { clave: "itbis30", etiqueta: "Ret. ITBIS compra informal (30%)" },
  ];

export function AdministracionScreen({
  tab,
  filtrosIniciales,
  usuarios: usuariosInicial,
  sucursales: sucursalesInicial,
  configuracion: configuracionInicial,
  puedeGestionar,
  sesionUsuarioId,
}: {
  readonly tab: TabAdministracion;
  readonly filtrosIniciales: FiltrosUsuarios;
  readonly usuarios: UsuariosInicial | null;
  readonly sucursales: SucursalesInicial | null;
  readonly configuracion: ConfiguracionInicial | null;
  /** The server said the caller is an Administrador (UX only; actions re-check). */
  readonly puedeGestionar: boolean;
  /** Session user id, to disable the actions on one's own row (UX only). */
  readonly sesionUsuarioId: number;
}) {
  const router = useRouter();
  const [navegando, iniciarNavegacion] = useTransition();
  const [data, setData] = useState<ListarUsuariosAdministracion | null>(
    usuariosInicial !== null && usuariosInicial.ok ? usuariosInicial.data : null,
  );
  const [error, setError] = useState<string | null>(
    usuariosInicial !== null && !usuariosInicial.ok ? usuariosInicial.message : null,
  );
  const [filtros, setFiltros] = useState<FiltrosUsuarios>(filtrosIniciales);
  const [texto, setTexto] = useState(filtrosIniciales.busqueda);
  const [cargando, setCargando] = useState(false);
  const ultimaSolicitud = useRef(0);
  const [accion, setAccion] = useState<AccionUsuario | null>(null);
  const [enviando, setEnviando] = useState(false);
  const enviandoRef = useRef(false);
  const [errorAccion, setErrorAccion] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);

  // Only the latest request may settle state: a slow earlier answer must not
  // overwrite a newer filter's rows.
  const consultar = useCallback(async (next: FiltrosUsuarios, page: number) => {
    const solicitud = ++ultimaSolicitud.current;
    setFiltros(next);
    setCargando(true);
    try {
      const r = await listarUsuariosAction(construirQueryUsuarios(next, page));
      if (solicitud !== ultimaSolicitud.current) return;
      if (r.ok) {
        setData(r.data);
        setError(null);
      } else {
        setError(r.error.message);
      }
    } catch {
      if (solicitud !== ultimaSolicitud.current) return;
      setError(MENSAJE_FALLO_CARGA);
    }
    setCargando(false);
  }, []);

  // Search is debounced; the estado filter applies immediately (below).
  useEffect(() => {
    if (texto === filtros.busqueda) return;
    const timer = setTimeout(() => {
      void consultar({ ...filtros, busqueda: texto }, 1);
    }, DEBOUNCE_BUSQUEDA_MS);
    return () => clearTimeout(timer);
  }, [texto, filtros, consultar]);

  function abrirAccion(siguiente: AccionUsuario): void {
    setMensaje(null);
    setErrorAccion(null);
    setAccion(siguiente);
  }

  function cerrarAccion(): void {
    setAccion(null);
    setErrorAccion(null);
  }

  /**
   * One write: the pending flag blocks a second submit (the ref closes the gap
   * before React re-renders), the dialog stays open on any refusal with the
   * catalog message, and the new state is shown only after an ok answer plus a
   * re-read. A conflict re-reads too but NEVER retries: the person retries.
   */
  async function ejecutarEscritura(
    escribir: () => ReturnType<typeof cambiarRolesUsuarioAction>,
    mensajeOk: string,
  ): Promise<void> {
    if (enviandoRef.current) return;
    enviandoRef.current = true;
    setEnviando(true);
    setErrorAccion(null);
    try {
      const r = await escribir();
      if (!r.ok) {
        setErrorAccion(mensajeErrorGestion(r.error.code, r.error.message));
        if (r.error.code === TEN_CONCURRENCIA_CONFLICTO) {
          await consultar(filtros, data?.page ?? 1);
        }
        return;
      }
      setAccion(null);
      setMensaje(r.data.cambio ? mensajeOk : "No había cambios que guardar.");
      await consultar(filtros, data?.page ?? 1);
    } catch {
      setErrorAccion(MENSAJE_FALLO_ACCION);
    } finally {
      enviandoRef.current = false;
      setEnviando(false);
    }
  }

  function cambiarTab(destino: TabAdministracion): void {
    if (destino === tab) return;
    iniciarNavegacion(async () => {
      await router.push(construirHrefAdministracion(destino, filtros, 1));
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <div role="tablist" aria-label="Secciones de Administración" className="flex flex-wrap gap-2">
        {TABS_ADMINISTRACION.map((t) => (
          <button
            key={t.valor}
            type="button"
            role="tab"
            aria-selected={t.valor === tab}
            disabled={navegando}
            onClick={() => cambiarTab(t.valor)}
            className={
              t.valor === tab
                ? "min-h-11 rounded-md bg-zinc-900 px-4 text-sm font-medium text-white disabled:opacity-40 dark:bg-zinc-50 dark:text-zinc-900"
                : "min-h-11 rounded-md border border-zinc-300 px-4 text-sm font-medium text-zinc-700 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300"
            }
          >
            {t.etiqueta}
          </button>
        ))}
      </div>

      {tab === "usuarios" && (
        <TablaUsuarios
          data={data}
          error={error}
          cargando={cargando}
          texto={texto}
          filtros={filtros}
          onTexto={setTexto}
          onFiltrar={(next) => void consultar(next, 1)}
          onPagina={(page) => void consultar(filtros, page)}
          puedeGestionar={puedeGestionar}
          sesionUsuarioId={sesionUsuarioId}
          enviando={enviando}
          mensaje={mensaje}
          onAccion={abrirAccion}
        />
      )}
      {puedeGestionar && accion !== null && data !== null && (
        <DialogoAccion
          accion={accion}
          data={data}
          enviando={enviando}
          error={errorAccion}
          onCerrar={cerrarAccion}
          onGuardarRoles={(usuario, rolIds) =>
            void ejecutarEscritura(
              () =>
                cambiarRolesUsuarioAction({
                  usuarioId: usuario.id,
                  rolIds,
                  versionEsperada: usuario.version,
                }),
              "Roles actualizados.",
            )
          }
          onConfirmarEstado={(usuario, activar) =>
            void ejecutarEscritura(
              () =>
                cambiarEstadoUsuarioAction({
                  usuarioId: usuario.id,
                  activo: activar,
                  versionEsperada: usuario.version,
                }),
              activar ? "Usuario activado." : "Usuario desactivado.",
            )
          }
        />
      )}
      {tab === "sucursales" && <TablaSucursales inicial={sucursalesInicial} />}
      {tab === "configuracion" && <PanelConfiguracion inicial={configuracionInicial} />}
    </div>
  );
}

function DialogoAccion({
  accion,
  data,
  enviando,
  error,
  onCerrar,
  onGuardarRoles,
  onConfirmarEstado,
}: {
  readonly accion: AccionUsuario;
  readonly data: ListarUsuariosAdministracion;
  readonly enviando: boolean;
  readonly error: string | null;
  readonly onCerrar: () => void;
  readonly onGuardarRoles: (usuario: UsuarioAdministracionDto, rolIds: number[]) => void;
  readonly onConfirmarEstado: (usuario: UsuarioAdministracionDto, activar: boolean) => void;
}) {
  // Always the row from the LATEST read, so a retry after a conflict carries the
  // reloaded `version`. A row that left the page's rows closes nothing visible.
  const usuario = data.items.find((u) => u.id === accion.usuarioId);
  if (usuario === undefined) return null;

  if (accion.tipo === "roles") {
    return (
      <CambiarRolesDialog
        usuario={usuario}
        catalogo={data.rolesCatalogo}
        enviando={enviando}
        error={error}
        onGuardar={(rolIds) => onGuardarRoles(usuario, rolIds)}
        onCerrar={onCerrar}
      />
    );
  }
  return (
    <ConfirmarEstadoUsuarioDialog
      usuario={usuario}
      activar={!usuario.activo}
      enviando={enviando}
      error={error}
      onConfirmar={() => onConfirmarEstado(usuario, !usuario.activo)}
      onCerrar={onCerrar}
    />
  );
}

function TablaUsuarios({
  data,
  error,
  cargando,
  texto,
  filtros,
  onTexto,
  onFiltrar,
  onPagina,
  puedeGestionar,
  sesionUsuarioId,
  enviando,
  mensaje,
  onAccion,
}: {
  readonly data: ListarUsuariosAdministracion | null;
  readonly error: string | null;
  readonly cargando: boolean;
  readonly texto: string;
  readonly filtros: FiltrosUsuarios;
  readonly onTexto: (valor: string) => void;
  readonly onFiltrar: (filtros: FiltrosUsuarios) => void;
  readonly onPagina: (page: number) => void;
  readonly puedeGestionar: boolean;
  readonly sesionUsuarioId: number;
  readonly enviando: boolean;
  readonly mensaje: string | null;
  readonly onAccion: (accion: AccionUsuario) => void;
}) {
  if (data === null) {
    return (
      <p role="alert" className={CLASE_ALERTA}>
        {error ?? "No hay datos de usuarios."}
      </p>
    );
  }

  const totalPaginas = Math.max(1, Math.ceil(data.total / data.pageSize));
  const busquedaPendiente = texto !== filtros.busqueda;

  return (
    <div className="flex flex-col gap-4">
      {error !== null && (
        <p role="alert" className={CLASE_ALERTA}>
          {error}
        </p>
      )}
      {mensaje !== null && (
        <p
          role="status"
          className="rounded-md bg-emerald-50 px-4 py-2 text-sm text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"
        >
          {mensaje}
        </p>
      )}

      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          type="search"
          value={texto}
          onChange={(e) => onTexto(e.target.value)}
          placeholder="Buscar usuario..."
          aria-label="Buscar usuario"
          className={`${CLASE_CONTROL} sm:flex-1`}
        />
        <select
          value={filtros.activo}
          onChange={(e) =>
            onFiltrar({ ...filtros, busqueda: texto, activo: e.target.value as FiltrosUsuarios["activo"] })
          }
          aria-label="Filtrar por estado"
          className={CLASE_CONTROL}
        >
          {FILTROS_ACTIVO.map((o) => (
            <option key={o.valor} value={o.valor}>
              {o.etiqueta}
            </option>
          ))}
        </select>
      </div>

      {data.items.length === 0 ? (
        <p className="rounded-md border border-zinc-200 px-4 py-6 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
          No hay usuarios que coincidan con los filtros.
        </p>
      ) : (
        <div className={CLASE_TABLA} aria-busy={cargando}>
          <table className="w-full text-left text-sm">
            <thead className={CLASE_CABECERA}>
              <tr>
                <th scope="col" className="px-4 py-2">Usuario</th>
                <th scope="col" className="px-4 py-2">Nombre</th>
                <th scope="col" className="px-4 py-2">Rol</th>
                <th scope="col" className="px-4 py-2">Empresa/Sucursal</th>
                <th scope="col" className="px-4 py-2">Estado</th>
                {puedeGestionar && <th scope="col" className="px-4 py-2">Acciones</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {data.items.map((u) => (
                <tr key={u.id} data-testid={`usuario-fila-${u.id}`}>
                  <td className="px-4 py-2 font-mono text-xs">{u.nombreUsuario}</td>
                  <td className="px-4 py-2 font-medium text-zinc-900 dark:text-zinc-50">{u.nombre}</td>
                  <td className="px-4 py-2">{u.roles.join(", ")}</td>
                  <td className="px-4 py-2">{`${u.empresaNombre} / ${u.sucursalNombre}`}</td>
                  <td className="px-4 py-2">
                    <span
                      className={`rounded px-2 py-1 text-xs font-medium ${
                        u.activo
                          ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                          : "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                      }`}
                    >
                      {u.activo ? "Activo" : "Inactivo"}
                    </span>
                  </td>
                  {puedeGestionar && (
                    <td className="px-4 py-2">
                      <AccionesUsuario
                        usuario={u}
                        propio={u.id === sesionUsuarioId}
                        deshabilitado={enviando}
                        onAccion={onAccion}
                      />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <nav aria-label="Paginación usuarios" className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => onPagina(data.page - 1)}
          disabled={cargando || busquedaPendiente || data.page <= 1}
          aria-label="Anterior"
          className={CLASE_BOTON}
        >
          Anterior
        </button>
        <span className="text-sm text-zinc-500">
          Página {data.page} de {totalPaginas}
        </span>
        <button
          type="button"
          onClick={() => onPagina(data.page + 1)}
          disabled={cargando || busquedaPendiente || data.page >= totalPaginas}
          aria-label="Siguiente"
          className={CLASE_BOTON}
        >
          Siguiente
        </button>
      </nav>
    </div>
  );
}

function AccionesUsuario({
  usuario,
  propio,
  deshabilitado,
  onAccion,
}: {
  readonly usuario: UsuarioAdministracionDto;
  /** The session user's own row: the server refuses it (TEN_AUTO_PROTECCION). */
  readonly propio: boolean;
  readonly deshabilitado: boolean;
  readonly onAccion: (accion: AccionUsuario) => void;
}) {
  const bloqueado = propio || deshabilitado;
  const titulo = propio ? TITULO_PROPIO_USUARIO : undefined;
  return (
    <div className="flex flex-wrap gap-2">
      <button
        type="button"
        disabled={bloqueado}
        title={titulo}
        onClick={() => onAccion({ tipo: "roles", usuarioId: usuario.id })}
        className={CLASE_BOTON}
      >
        Cambiar roles
      </button>
      <button
        type="button"
        disabled={bloqueado}
        title={titulo}
        onClick={() => onAccion({ tipo: "estado", usuarioId: usuario.id })}
        className={CLASE_BOTON}
      >
        {usuario.activo ? "Desactivar" : "Activar"}
      </button>
    </div>
  );
}

function TablaSucursales({ inicial }: { readonly inicial: SucursalesInicial | null }) {
  if (inicial === null) {
    return <p className={CLASE_ALERTA} role="alert">No hay datos de sucursales.</p>;
  }
  if (!inicial.ok) {
    return <p className={CLASE_ALERTA} role="alert">{inicial.message}</p>;
  }

  return (
    <div className={CLASE_TABLA}>
      <table className="w-full text-left text-sm">
        <thead className={CLASE_CABECERA}>
          <tr>
            <th scope="col" className="px-4 py-2">Sucursal</th>
            <th scope="col" className="px-4 py-2">Estado</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {inicial.data.map((s) => (
            <tr key={s.id} data-testid={`sucursal-fila-${s.id}`}>
              <td className="px-4 py-2 font-medium text-zinc-900 dark:text-zinc-50">{s.nombre}</td>
              <td className="px-4 py-2">
                {/* The existing use case returns active branches only (S4 gap). */}
                <span className="rounded bg-emerald-100 px-2 py-1 text-xs font-medium text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                  Activa
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PanelConfiguracion({ inicial }: { readonly inicial: ConfiguracionInicial | null }) {
  if (inicial === null) {
    return <p className={CLASE_ALERTA} role="alert">No hay datos de configuración.</p>;
  }
  if (!inicial.ok) {
    return <p className={CLASE_ALERTA} role="alert">{inicial.message}</p>;
  }

  const { retenciones, ncf, itbisEnUso } = inicial.data;

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Retenciones</h2>
        {retenciones === null ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Retenciones no configuradas para esta empresa.
          </p>
        ) : (
          <div className={CLASE_TABLA}>
            <table className="w-full text-left text-sm">
              <thead className={CLASE_CABECERA}>
                <tr>
                  <th scope="col" className="px-4 py-2">Parámetro</th>
                  <th scope="col" className="px-4 py-2">Tasa</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {RETENCIONES.map((r) => (
                  <tr key={r.clave} data-testid={`retencion-${r.clave}`}>
                    <td className="px-4 py-2">{r.etiqueta}</td>
                    <td className="px-4 py-2 tabular-nums">{retenciones[r.clave]}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">ITBIS</h2>
        {itbisEnUso.length === 0 ? (
          <p className="rounded-md border border-zinc-200 px-4 py-6 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
            Sin productos activos: no hay tasas de ITBIS en uso.
          </p>
        ) : (
          <div className={CLASE_TABLA}>
            <table className="w-full text-left text-sm">
              <thead className={CLASE_CABECERA}>
                <tr>
                  <th scope="col" className="px-4 py-2">Tasa (%)</th>
                  <th scope="col" className="px-4 py-2">Vigente desde</th>
                  <th scope="col" className="px-4 py-2">Vigente hasta</th>
                  <th scope="col" className="px-4 py-2">Productos</th>
                  <th scope="col" className="px-4 py-2">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {itbisEnUso.map((t) => (
                  <tr
                    key={`${t.tasaItbis}|${t.vigenteDesde}|${t.vigenteHasta ?? ""}`}
                    data-testid={`itbis-fila-${t.tasaItbis}`}
                  >
                    <td className="px-4 py-2 tabular-nums">{t.tasaItbis}%</td>
                    <td className="px-4 py-2">{formatearFechaSD(t.vigenteDesde)}</td>
                    <td className="px-4 py-2">
                      {t.vigenteHasta === null ? "Sin fin" : formatearFechaSD(t.vigenteHasta)}
                    </td>
                    <td className="px-4 py-2 tabular-nums">{t.productos}</td>
                    <td className="px-4 py-2">{t.vigenteHoy ? "Vigente" : "No vigente"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Solo lectura: el conjunto de tasas permitidas está fijado por las reglas de producto.
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Secuencias NCF</h2>
        {ncf.length === 0 ? (
          <p className="rounded-md border border-zinc-200 px-4 py-6 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
            No hay secuencias NCF activas.
          </p>
        ) : (
          <div className={CLASE_TABLA}>
            <table className="w-full text-left text-sm">
              <thead className={CLASE_CABECERA}>
                <tr>
                  <th scope="col" className="px-4 py-2">Tipo</th>
                  <th scope="col" className="px-4 py-2">Rango</th>
                  <th scope="col" className="px-4 py-2">Secuencia actual</th>
                  <th scope="col" className="px-4 py-2">Vigencia fin</th>
                  <th scope="col" className="px-4 py-2">% usado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {ncf.map((n) => (
                  <tr key={n.tipo} data-testid={`ncf-fila-${n.tipo}`}>
                    <td className="px-4 py-2 font-mono text-xs">{n.tipo}</td>
                    <td className="px-4 py-2 tabular-nums">{`${n.rangoInicio} – ${n.rangoFin}`}</td>
                    <td className="px-4 py-2 tabular-nums">{n.secuenciaActual}</td>
                    <td className="px-4 py-2">{formatearFechaSD(n.vigenciaFin)}</td>
                    <td className="px-4 py-2 tabular-nums">{n.porcentajeUsado}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
