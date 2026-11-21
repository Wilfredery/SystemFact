"use client";

/**
 * Administración screen (screens plan Step 7, `odd/tasks/administracion.md`
 * S2/S6): the wireframe's three tabs. Configuración is read-only; Sucursales gains
 * "Nueva sucursal" and "Editar" (`odd/tasks/administracion-sucursales-crear-editar.md`
 * S9) under the same `puedeGestionar` flag and the same rules as the user writes;
 * the Usuarios tab gains the Step 7b writes (`odd/tasks/administracion-writes.md`
 * S11) — role assignment and activate/deactivate — plus "Mover de sucursal"
 * (`odd/tasks/administracion-mover-usuario.md` S10) ONLY when the page says the
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
import {
  listarSucursalesAdministracionAction,
  listarSucursalesDeEmpresaAction,
  listarUsuariosAction,
} from "@/modules/tenant/http/actions.administracion";
import {
  activarSucursalAction,
  crearSucursalAction,
  desactivarSucursalAction,
  editarSucursalAction,
} from "@/modules/tenant/http/actions.sucursal";
import {
  cambiarEstadoUsuarioAction,
  cambiarRolesUsuarioAction,
  moverUsuarioDeSucursalAction,
} from "@/modules/tenant/http/actions.usuarios";
import type {
  ConfiguracionAdministracionDto,
  ListarUsuariosAdministracion,
  RolCatalogoDto,
  SucursalGestionDto,
  UsuarioAdministracionDto,
} from "@/modules/tenant/http/shared";
import { TEN_CONCURRENCIA_CONFLICTO } from "@/modules/tenant/domain/errors";
import { formatearFechaSD } from "@/shared/ui/format/date";
import { EditarTasasItbisCard } from "./EditarTasasItbisCard";
import {
  DEBOUNCE_BUSQUEDA_MS,
  FILTROS_ACTIVO,
  MENSAJE_FALLO_ACCION,
  TABS_ADMINISTRACION,
  construirHrefAdministracion,
  construirQueryUsuarios,
  mensajeErrorCambioEstadoSucursal,
  mensajeErrorGestion,
  mensajeErrorMover,
  type FiltrosUsuarios,
  type TabAdministracion,
} from "./administracion-tabs";
import {
  ConfirmarEstadoSucursalDialog,
  SucursalDialog,
  type DatosSucursalFormulario,
} from "./GestionSucursalDialog";
import {
  CambiarRolesDialog,
  ConfirmarEstadoUsuarioDialog,
  MoverUsuarioDialog,
  type SucursalesDestino,
} from "./GestionUsuarioDialogs";

/** What the open dialog is doing; the user is looked up in the CURRENT rows. */
type AccionUsuario =
  | { readonly tipo: "roles"; readonly usuarioId: number }
  | { readonly tipo: "estado"; readonly usuarioId: number }
  | { readonly tipo: "mover"; readonly usuarioId: number };

/** What the open branch dialog is doing; the branch is looked up in the CURRENT rows. */
type AccionSucursal =
  | { readonly tipo: "crear" }
  | { readonly tipo: "editar"; readonly sucursalId: number }
  | { readonly tipo: "estado"; readonly sucursalId: number; readonly activar: boolean };

const TITULO_PROPIO_USUARIO =
  "No puede modificar su propio usuario: pídalo a otro Administrador.";
const TITULO_SUCURSAL_PROPIA =
  "No puede desactivar la sucursal en la que está trabajando: cambie primero a otra sucursal.";

export type UsuariosInicial =
  | { readonly ok: true; readonly data: ListarUsuariosAdministracion }
  | { readonly ok: false; readonly message: string };

export type SucursalesInicial =
  | { readonly ok: true; readonly data: readonly SucursalGestionDto[] }
  | { readonly ok: false; readonly message: string };

export type ConfiguracionInicial =
  | { readonly ok: true; readonly data: ConfiguracionAdministracionDto }
  | { readonly ok: false; readonly message: string };

export type RolesInicial =
  | { readonly ok: true; readonly data: readonly RolCatalogoDto[] }
  | { readonly ok: false; readonly message: string };

/** Case- and accent-insensitive text for the client-side branch search. */
function normalizarBusqueda(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

const MENSAJE_FALLO_CARGA = "No se pudo cargar la lista de usuarios. Intente de nuevo.";
const MENSAJE_FALLO_SUCURSALES = "No se pudieron cargar las sucursales. Intente de nuevo.";

const CLASE_CONTROL =
  "min-h-11 rounded-md border border-line bg-surface px-3 text-sm text-ink";
const CLASE_BOTON =
  "min-h-11 rounded-md border border-line px-4 text-sm font-medium text-ink disabled:opacity-40";
const CLASE_TABLA =
  "overflow-x-auto rounded-lg border border-line";
const CLASE_CABECERA =
  "bg-surface-muted text-xs uppercase text-ink-muted";
const CLASE_ALERTA =
  "rounded-md bg-danger/10 px-4 py-2 text-sm text-danger";

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
  roles,
  empresaNombre,
  puedeGestionar,
  sesionUsuarioId,
  sesionSucursalId,
}: {
  readonly tab: TabAdministracion;
  readonly filtrosIniciales: FiltrosUsuarios;
  readonly usuarios: UsuariosInicial | null;
  readonly sucursales: SucursalesInicial | null;
  readonly configuracion: ConfiguracionInicial | null;
  /** Read-only role catalog of the Roles tab (board 08 S3); null on any other tab. */
  readonly roles: RolesInicial | null;
  /** Session company display name, for the read-only Empresas tab (board 08 S2). */
  readonly empresaNombre: string;
  /** The server said the caller is an Administrador (UX only; actions re-check). */
  readonly puedeGestionar: boolean;
  /** Session user id, to disable the actions on one's own row (UX only). */
  readonly sesionUsuarioId: number;
  /** Session branch id, to disable "Desactivar" on one's own branch (UX only; the server re-checks). */
  readonly sesionSucursalId: number;
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
  const [destinos, setDestinos] = useState<SucursalesDestino>({ estado: "cargando" });
  const moviendo = accion !== null && accion.tipo === "mover";
  // The branch list is DERIVED from the server prop: `useState(prop)` would seed it once and
  // ignore the list the server sends when the person switches tabs (the Usuarios tab passes
  // null). Only a list re-read after a write is kept locally, tied to the prop it was read
  // against: a newer server list (new prop) always wins.
  const [recargada, setRecargada] = useState<{
    readonly base: SucursalesInicial | null;
    readonly valor: SucursalesInicial;
  } | null>(null);
  const sucursales =
    recargada !== null && recargada.base === sucursalesInicial ? recargada.valor : sucursalesInicial;
  const [accionSucursal, setAccionSucursal] = useState<AccionSucursal | null>(null);
  const [mensajeSucursal, setMensajeSucursal] = useState<string | null>(null);
  const [errorRecarga, setErrorRecarga] = useState<string | null>(null);

  // The move dialog reads the company's active branches (existing branch list
  // use case) every time it opens, so the select is never a stale list.
  useEffect(() => {
    if (!moviendo || !puedeGestionar) return;
    let vigente = true;
    listarSucursalesDeEmpresaAction()
      .then((r) => {
        if (!vigente) return;
        setDestinos(
          r.ok
            ? { estado: "listo", sucursales: r.data }
            : { estado: "error", mensaje: mensajeErrorMover(r.error.code, r.error.message) },
        );
      })
      .catch(() => {
        if (vigente) setDestinos({ estado: "error", mensaje: MENSAJE_FALLO_SUCURSALES });
      });
    return () => {
      vigente = false;
    };
  }, [moviendo, puedeGestionar]);

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
    if (siguiente.tipo === "mover") setDestinos({ estado: "cargando" });
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
    mensajeDeError: (code: string, mensajeServidor: string) => string = mensajeErrorGestion,
  ): Promise<void> {
    if (enviandoRef.current) return;
    enviandoRef.current = true;
    setEnviando(true);
    setErrorAccion(null);
    try {
      const r = await escribir();
      if (!r.ok) {
        setErrorAccion(mensajeDeError(r.error.code, r.error.message));
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

  function abrirAccionSucursal(siguiente: AccionSucursal): void {
    setMensajeSucursal(null);
    setErrorAccion(null);
    setAccionSucursal(siguiente);
  }

  function cerrarAccionSucursal(): void {
    setAccionSucursal(null);
    setErrorAccion(null);
  }

  /** Re-reads ALL the branches (active and inactive, the admin tab's read) after a write. */
  async function recargarSucursales(): Promise<void> {
    try {
      const r = await listarSucursalesAdministracionAction();
      if (r.ok) {
        setRecargada({ base: sucursalesInicial, valor: { ok: true, data: r.data } });
        setErrorRecarga(null);
      } else {
        setErrorRecarga(mensajeErrorGestion(r.error.code, r.error.message));
      }
    } catch {
      setErrorRecarga(MENSAJE_FALLO_SUCURSALES);
    }
  }

  /**
   * One branch write: same rules as `ejecutarEscritura` (pending flag with a ref
   * guard, dialog stays open with the catalog message on any refusal, new state
   * only after an ok answer plus a re-read, a conflict re-reads but NEVER retries).
   */
  async function ejecutarEscrituraSucursal(
    escribir: () =>
      | ReturnType<typeof crearSucursalAction>
      | ReturnType<typeof editarSucursalAction>
      | ReturnType<typeof desactivarSucursalAction>,
    mensajeOk: string,
    mensajeDeError: (error: {
      readonly code: string;
      readonly message: string;
      readonly detalle?: Parameters<typeof mensajeErrorCambioEstadoSucursal>[0]["detalle"];
    }) => string = (e) => mensajeErrorGestion(e.code, e.message),
  ): Promise<void> {
    if (enviandoRef.current) return;
    enviandoRef.current = true;
    setEnviando(true);
    setErrorAccion(null);
    try {
      const r = await escribir();
      if (!r.ok) {
        setErrorAccion(mensajeDeError(r.error));
        if (r.error.code === TEN_CONCURRENCIA_CONFLICTO) await recargarSucursales();
        return;
      }
      setAccionSucursal(null);
      setMensajeSucursal("cambio" in r.data && !r.data.cambio ? "No había cambios que guardar." : mensajeOk);
      await recargarSucursales();
    } catch {
      setErrorAccion(MENSAJE_FALLO_ACCION);
    } finally {
      enviandoRef.current = false;
      setEnviando(false);
    }
  }

  function guardarSucursal(
    accionActual: AccionSucursal,
    sucursal: SucursalGestionDto | undefined,
    datos: DatosSucursalFormulario,
  ): void {
    if (accionActual.tipo === "estado") return;
    if (accionActual.tipo === "crear") {
      void ejecutarEscrituraSucursal(
        () => crearSucursalAction(datos),
        `Sucursal ${datos.nombre} creada.`,
      );
      return;
    }
    if (sucursal === undefined) return;
    void ejecutarEscrituraSucursal(
      () =>
        editarSucursalAction({
          sucursalId: sucursal.id,
          ...datos,
          versionEsperada: sucursal.version,
        }),
      `Sucursal ${datos.nombre} actualizada.`,
    );
  }

  /** Activate / deactivate: same write rules, plus the multi-blocker message of a refused deactivation. */
  function confirmarEstadoSucursal(sucursal: SucursalGestionDto, activar: boolean): void {
    const entrada = { sucursalId: sucursal.id, versionEsperada: sucursal.version };
    void ejecutarEscrituraSucursal(
      () => (activar ? activarSucursalAction(entrada) : desactivarSucursalAction(entrada)),
      activar ? `Sucursal ${sucursal.nombre} activada.` : `Sucursal ${sucursal.nombre} desactivada.`,
      mensajeErrorCambioEstadoSucursal,
    );
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
            id={`tab-${t.valor}`}
            aria-controls={`panel-${t.valor}`}
            aria-selected={t.valor === tab}
            disabled={navegando}
            onClick={() => cambiarTab(t.valor)}
            className={
              t.valor === tab
                ? "min-h-11 rounded-md bg-accent px-4 text-sm font-medium text-accent-fg disabled:opacity-40"
                : "min-h-11 rounded-md border border-line px-4 text-sm font-medium text-ink disabled:opacity-40"
            }
          >
            {t.etiqueta}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="flex flex-col gap-6">
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
            destinos={destinos}
            onCerrar={cerrarAccion}
            onMover={(usuario, sucursalDestinoId, nombreDestino) =>
              void ejecutarEscritura(
                () =>
                  moverUsuarioDeSucursalAction({
                    usuarioId: usuario.id,
                    sucursalDestinoId,
                    versionEsperada: usuario.version,
                  }),
                `Usuario movido a ${nombreDestino}.`,
                mensajeErrorMover,
              )
            }
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
        {tab === "empresas" && (
          <TablaEmpresas empresaNombre={empresaNombre} inicial={sucursales} />
        )}
        {tab === "roles" && <TablaRoles inicial={roles} />}
        {tab === "sucursales" && (
          <TablaSucursales
            inicial={sucursales}
            puedeGestionar={puedeGestionar}
            sesionSucursalId={sesionSucursalId}
            enviando={enviando}
            mensaje={mensajeSucursal}
            errorRecarga={errorRecarga}
            onAccion={abrirAccionSucursal}
          />
        )}
        {tab === "sucursales" &&
          puedeGestionar &&
          accionSucursal !== null &&
          sucursales !== null &&
          sucursales.ok && (
            <DialogoSucursal
              accion={accionSucursal}
              sucursales={sucursales.data}
              enviando={enviando}
              error={errorAccion}
              onCerrar={cerrarAccionSucursal}
              onGuardar={guardarSucursal}
              onConfirmarEstado={confirmarEstadoSucursal}
            />
          )}
        {tab === "configuracion" && <PanelConfiguracion inicial={configuracionInicial} />}
      </div>
    </div>
  );
}

function DialogoAccion({
  accion,
  data,
  enviando,
  error,
  destinos,
  onCerrar,
  onMover,
  onGuardarRoles,
  onConfirmarEstado,
}: {
  readonly accion: AccionUsuario;
  readonly data: ListarUsuariosAdministracion;
  readonly enviando: boolean;
  readonly error: string | null;
  readonly destinos: SucursalesDestino;
  readonly onCerrar: () => void;
  readonly onMover: (
    usuario: UsuarioAdministracionDto,
    sucursalDestinoId: number,
    nombreDestino: string,
  ) => void;
  readonly onGuardarRoles: (usuario: UsuarioAdministracionDto, rolIds: number[]) => void;
  readonly onConfirmarEstado: (usuario: UsuarioAdministracionDto, activar: boolean) => void;
}) {
  // Always the row from the LATEST read, so a retry after a conflict carries the
  // reloaded `version`. A row that left the page's rows closes nothing visible.
  const usuario = data.items.find((u) => u.id === accion.usuarioId);
  if (usuario === undefined) return null;

  if (accion.tipo === "mover") {
    const nombreDe = (id: number): string =>
      (destinos.estado === "listo" ? destinos.sucursales.find((s) => s.id === id)?.nombre : undefined) ??
      "la nueva sucursal";
    return (
      <MoverUsuarioDialog
        usuario={usuario}
        destinos={destinos}
        enviando={enviando}
        error={error}
        onConfirmar={(sucursalDestinoId) => onMover(usuario, sucursalDestinoId, nombreDe(sucursalDestinoId))}
        onCerrar={onCerrar}
      />
    );
  }
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
          className="rounded-md bg-success-bg px-4 py-2 text-sm text-success-fg"
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
        <p className="rounded-md border border-line px-4 py-6 text-center text-sm text-ink-muted">
          No hay usuarios que coincidan con los filtros.
        </p>
      ) : (
        <div className={CLASE_TABLA} aria-busy={cargando}>
          <table className="w-full text-left text-sm">
            <thead className={CLASE_CABECERA}>
              <tr>
                <th scope="col" className="px-4 py-2">Usuario</th>
                <th scope="col" className="px-4 py-2">Nombre</th>
                <th scope="col" className="px-4 py-2">Roles</th>
                <th scope="col" className="px-4 py-2">Empresa/Sucursal</th>
                <th scope="col" className="px-4 py-2">Estado</th>
                {puedeGestionar && <th scope="col" className="px-4 py-2">Acciones</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {data.items.map((u) => (
                <tr key={u.id} data-testid={`usuario-fila-${u.id}`}>
                  <td className="px-4 py-2 font-mono text-xs">{u.nombreUsuario}</td>
                  <td className="px-4 py-2 font-medium text-ink">{u.nombre}</td>
                  <td className="px-4 py-2">{u.roles.join(" · ")}</td>
                  <td className="px-4 py-2">{`${u.empresaNombre} / ${u.sucursalNombre}`}</td>
                  <td className="px-4 py-2">
                    <span
                      className={`rounded px-2 py-1 text-xs font-medium ${
                        u.activo
                          ? "bg-success-bg text-success-fg"
                          : "bg-surface-raised text-ink-muted"
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
                        otraSucursal={u.esDeOtraSucursal}
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
        <span className="text-sm text-ink-muted">
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
  otraSucursal,
  deshabilitado,
  onAccion,
}: {
  readonly usuario: UsuarioAdministracionDto;
  /** The session user's own row: the server refuses it (TEN_AUTO_PROTECCION). */
  readonly propio: boolean;
  /** Another branch's user: visible company-wide, but writes are pinned to the session branch. */
  readonly otraSucursal: boolean;
  readonly deshabilitado: boolean;
  readonly onAccion: (accion: AccionUsuario) => void;
}) {
  const bloqueado = propio || otraSucursal || deshabilitado;
  const titulo = propio
    ? TITULO_PROPIO_USUARIO
    : otraSucursal
      ? "Este usuario pertenece a otra sucursal: cambie a esa sucursal para gestionarlo."
      : undefined;
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
      {/* Moving works on rows of ANY branch (the server widens the branch scope
          for this one write); only the session user's own row is refused. */}
      <button
        type="button"
        disabled={propio || deshabilitado}
        title={propio ? TITULO_PROPIO_USUARIO : undefined}
        onClick={() => onAccion({ tipo: "mover", usuarioId: usuario.id })}
        className={CLASE_BOTON}
      >
        Mover de sucursal
      </button>
    </div>
  );
}

function DialogoSucursal({
  accion,
  sucursales,
  enviando,
  error,
  onCerrar,
  onGuardar,
  onConfirmarEstado,
}: {
  readonly accion: AccionSucursal;
  readonly sucursales: readonly SucursalGestionDto[];
  readonly enviando: boolean;
  readonly error: string | null;
  readonly onCerrar: () => void;
  readonly onGuardar: (
    accion: AccionSucursal,
    sucursal: SucursalGestionDto | undefined,
    datos: DatosSucursalFormulario,
  ) => void;
  readonly onConfirmarEstado: (sucursal: SucursalGestionDto, activar: boolean) => void;
}) {
  // Always the row from the LATEST read, so a retry after a conflict carries the
  // reloaded `version`.
  const sucursal =
    accion.tipo === "crear" ? undefined : sucursales.find((s) => s.id === accion.sucursalId);
  if (accion.tipo !== "crear" && sucursal === undefined) return null;
  if (accion.tipo === "estado" && sucursal !== undefined) {
    return (
      <ConfirmarEstadoSucursalDialog
        sucursal={sucursal}
        activar={accion.activar}
        enviando={enviando}
        error={error}
        onConfirmar={() => onConfirmarEstado(sucursal, accion.activar)}
        onCerrar={onCerrar}
      />
    );
  }
  return (
    <SucursalDialog
      sucursal={sucursal ?? null}
      enviando={enviando}
      error={error}
      onConfirmar={(datos) => onGuardar(accion, sucursal, datos)}
      onCerrar={onCerrar}
    />
  );
}

function TablaSucursales({
  inicial,
  puedeGestionar,
  sesionSucursalId,
  enviando,
  mensaje,
  errorRecarga,
  onAccion,
}: {
  readonly inicial: SucursalesInicial | null;
  readonly puedeGestionar: boolean;
  readonly sesionSucursalId: number;
  readonly enviando: boolean;
  readonly mensaje: string | null;
  readonly errorRecarga: string | null;
  readonly onAccion: (accion: AccionSucursal) => void;
}) {
  const [busqueda, setBusqueda] = useState("");
  if (inicial === null) {
    return <p className={CLASE_ALERTA} role="alert">No hay datos de sucursales.</p>;
  }
  if (!inicial.ok) {
    return <p className={CLASE_ALERTA} role="alert">{inicial.message}</p>;
  }
  const consulta = normalizarBusqueda(busqueda);
  const visibles =
    consulta === ""
      ? inicial.data
      : inicial.data.filter((s) =>
          normalizarBusqueda(`${s.nombre} ${s.direccion}`).includes(consulta),
        );

  return (
    <div className="flex flex-col gap-4">
      {errorRecarga !== null && (
        <p role="alert" className={CLASE_ALERTA}>
          {errorRecarga}
        </p>
      )}
      {mensaje !== null && (
        <p
          role="status"
          className="rounded-md bg-success-bg px-4 py-2 text-sm text-success-fg"
        >
          {mensaje}
        </p>
      )}
      {puedeGestionar && (
        <div>
          <button
            type="button"
            disabled={enviando}
            onClick={() => onAccion({ tipo: "crear" })}
            className={CLASE_BOTON}
          >
            Nueva sucursal
          </button>
        </div>
      )}
      <input
        type="search"
        value={busqueda}
        onChange={(e) => setBusqueda(e.target.value)}
        placeholder="Buscar sucursal..."
        aria-label="Buscar sucursal"
        className={CLASE_CONTROL}
      />
      {visibles.length === 0 ? (
        <p className="rounded-md border border-line px-4 py-6 text-center text-sm text-ink-muted">
          No hay sucursales que coincidan con la búsqueda.
        </p>
      ) : (
      <div className={CLASE_TABLA}>
        <table className="w-full text-left text-sm">
          <thead className={CLASE_CABECERA}>
            <tr>
              <th scope="col" className="px-4 py-2">Nombre</th>
              <th scope="col" className="px-4 py-2">Dirección</th>
              <th scope="col" className="px-4 py-2">Teléfono</th>
              <th scope="col" className="px-4 py-2">Estado</th>
              {puedeGestionar && <th scope="col" className="px-4 py-2">Acciones</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {visibles.map((s) => (
              <tr key={s.id} data-testid={`sucursal-fila-${s.id}`}>
                <td className="px-4 py-2 font-medium text-ink">{s.nombre}</td>
                <td className="px-4 py-2">{s.direccion}</td>
                <td className="px-4 py-2">{s.telefono}</td>
                <td className="px-4 py-2">
                  <span
                    className={`rounded px-2 py-1 text-xs font-medium ${
                      s.activa
                        ? "bg-success-bg text-success-fg"
                        : "bg-surface-raised text-ink-muted"
                    }`}
                  >
                    {s.activa ? "Activa" : "Inactiva"}
                  </span>
                </td>
                {puedeGestionar && (
                  <td className="px-4 py-2">
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={enviando}
                        onClick={() => onAccion({ tipo: "editar", sucursalId: s.id })}
                        className={CLASE_BOTON}
                      >
                        Editar
                      </button>
                      {/* UX only: the server refuses the session's own branch too. */}
                      <button
                        type="button"
                        disabled={enviando || (s.activa && s.id === sesionSucursalId)}
                        title={s.activa && s.id === sesionSucursalId ? TITULO_SUCURSAL_PROPIA : undefined}
                        onClick={() => onAccion({ tipo: "estado", sucursalId: s.id, activar: !s.activa })}
                        className={CLASE_BOTON}
                      >
                        {s.activa ? "Desactivar" : "Activar"}
                      </button>
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      )}
    </div>
  );
}

/**
 * Empresas tab (08a, board 08 S2): READ-ONLY. The session company and its
 * branches. There is no company write use case and master entities are never
 * deleted (AGENTS.md), so no create/edit/delete control exists here.
 */
function TablaEmpresas({
  empresaNombre,
  inicial,
}: {
  readonly empresaNombre: string;
  readonly inicial: SucursalesInicial | null;
}) {
  if (inicial === null) {
    return <p className={CLASE_ALERTA} role="alert">No hay datos de empresas.</p>;
  }
  if (!inicial.ok) {
    return <p className={CLASE_ALERTA} role="alert">{inicial.message}</p>;
  }
  const sucursalesActivas = inicial.data.filter((s) => s.activa);
  return (
    <div className={CLASE_TABLA}>
      <table className="w-full text-left text-sm">
        <thead className={CLASE_CABECERA}>
          <tr>
            <th scope="col" className="px-4 py-2">Empresa</th>
            <th scope="col" className="px-4 py-2">Sucursales</th>
            <th scope="col" className="px-4 py-2">Estado</th>
          </tr>
        </thead>
        <tbody>
          <tr data-testid="empresa-fila">
            <td className="px-4 py-2 font-medium text-ink">{empresaNombre}</td>
            <td className="px-4 py-2">
              {sucursalesActivas.length === 0
                ? "Sin sucursales activas"
                : sucursalesActivas.map((s) => s.nombre).join(", ")}
            </td>
            <td className="px-4 py-2">
              <span className="rounded px-2 py-1 text-xs font-medium bg-success-bg text-success-fg">
                Activo
              </span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

/** Roles tab (08b, board 08 S3): READ-ONLY catalog of the active roles. */
function TablaRoles({ inicial }: { readonly inicial: RolesInicial | null }) {
  if (inicial === null) {
    return <p className={CLASE_ALERTA} role="alert">No hay datos de roles.</p>;
  }
  if (!inicial.ok) {
    return <p className={CLASE_ALERTA} role="alert">{inicial.message}</p>;
  }
  return (
    <div className={CLASE_TABLA}>
      <table className="w-full text-left text-sm">
        <thead className={CLASE_CABECERA}>
          <tr>
            <th scope="col" className="px-4 py-2">Rol</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {inicial.data.map((r) => (
            <tr key={r.id} data-testid={`rol-fila-${r.id}`}>
              <td className="px-4 py-2">{r.nombre}</td>
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
        <h2 className="text-lg font-semibold text-ink">Retenciones</h2>
        {retenciones === null ? (
          <p className="text-sm text-ink-muted">
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
              <tbody className="divide-y divide-line">
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
        <h2 className="text-lg font-semibold text-ink">ITBIS</h2>
        {itbisEnUso.length === 0 ? (
          <p className="rounded-md border border-line px-4 py-6 text-center text-sm text-ink-muted">
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
              <tbody className="divide-y divide-line">
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
        <EditarTasasItbisCard inicial={inicial.data.tasaItbis} />
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold text-ink">Secuencias NCF</h2>
        {ncf.length === 0 ? (
          <p className="rounded-md border border-line px-4 py-6 text-center text-sm text-ink-muted">
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
              <tbody className="divide-y divide-line">
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
