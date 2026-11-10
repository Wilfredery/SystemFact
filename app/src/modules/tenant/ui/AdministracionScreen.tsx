"use client";

/**
 * Administración screen (screens plan Step 7, `odd/tasks/administracion.md`
 * S2/S6). Read-only first (S1): NO creation, assignment, activation or any other
 * write — the wireframe's three tabs rendered as a directory only.
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
import type {
  ConfiguracionAdministracionDto,
  ListarUsuariosAdministracion,
  SucursalAdministracionDto,
} from "@/modules/tenant/http/shared";
import { formatearFechaSD } from "@/shared/ui/format/date";
import {
  DEBOUNCE_BUSQUEDA_MS,
  FILTROS_ACTIVO,
  TABS_ADMINISTRACION,
  construirHrefAdministracion,
  construirQueryUsuarios,
  type FiltrosUsuarios,
  type TabAdministracion,
} from "./administracion-tabs";

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
}: {
  readonly tab: TabAdministracion;
  readonly filtrosIniciales: FiltrosUsuarios;
  readonly usuarios: UsuariosInicial | null;
  readonly sucursales: SucursalesInicial | null;
  readonly configuracion: ConfiguracionInicial | null;
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
        />
      )}
      {tab === "sucursales" && <TablaSucursales inicial={sucursalesInicial} />}
      {tab === "configuracion" && <PanelConfiguracion inicial={configuracionInicial} />}
    </div>
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
}: {
  readonly data: ListarUsuariosAdministracion | null;
  readonly error: string | null;
  readonly cargando: boolean;
  readonly texto: string;
  readonly filtros: FiltrosUsuarios;
  readonly onTexto: (valor: string) => void;
  readonly onFiltrar: (filtros: FiltrosUsuarios) => void;
  readonly onPagina: (page: number) => void;
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

  const { retenciones, ncf } = inicial.data;

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
        {/*
          Documented T1 gap: no existing tenant reader exposes a TASA_ITBIS rate
          with its validity window, so this read-only build does not invent one.
        */}
        <p className="rounded-md border border-dashed border-zinc-300 px-4 py-3 text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
          No disponible aún: la lectura de las tasas de ITBIS (general/reducido) y su vigencia no
          existe en el backend actual.
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
