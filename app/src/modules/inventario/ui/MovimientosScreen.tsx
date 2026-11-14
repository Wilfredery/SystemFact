"use client";

/**
 * Inventario "Historial de movimientos" (odd/tasks/inventario-historial.md S1) —
 * strictly read-only: no write control anywhere.
 *
 * Client island for the interactivity only: the server page hands over the first
 * load (already read through `listarMovimientosInventarioAction`), and every
 * filter or page change re-queries that same action. Quantities arrive as Decimal
 * strings and are only displayed (a sign is prefixed as text, never arithmetic);
 * dates are UTC instants rendered in America/Santo_Domingo.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { listarMovimientosInventarioAction } from "@/modules/inventario/http/actions";
import type { ListarMovimientosOutput } from "@/modules/inventario/application/listar-movimientos-inventario";
import {
  TIPOS_MOVIMIENTO,
  etiquetaTipoMovimiento,
  type TipoMovimientoInventario,
} from "@/modules/inventario/domain/movimientos";
import { formatearFechaHoraSD } from "@/modules/auditoria/ui/format";
import { TAMANO_PAGINA } from "./paginacion";

const DEBOUNCE_BUSQUEDA_MS = 300;
const MENSAJE_FALLO_CARGA = "No se pudo cargar el historial. Intente de nuevo.";
const SIN_USUARIO = "—";

export type MovimientosInicial =
  | { readonly ok: true; readonly data: ListarMovimientosOutput }
  | { readonly ok: false; readonly message: string };

export interface FiltrosMovimientos {
  readonly tipo: TipoMovimientoInventario | null;
  readonly producto: string;
  /** `YYYY-MM-DD` or "" (= default range). */
  readonly desde: string;
  readonly hasta: string;
}

const CLASE_CONTROL =
  "min-h-11 rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50";
const CLASE_BOTON =
  "min-h-11 rounded-md border border-zinc-300 px-4 text-sm font-medium text-zinc-700 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300";
const CLASE_ALERTA =
  "rounded-md bg-red-50 px-4 py-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-200";

function construirQuery(filtros: FiltrosMovimientos, page: number) {
  return {
    page,
    limit: TAMANO_PAGINA,
    ...(filtros.tipo === null ? {} : { tipo: filtros.tipo }),
    ...(filtros.producto.trim() === "" ? {} : { producto: filtros.producto.trim() }),
    ...(filtros.desde === "" ? {} : { desde: filtros.desde }),
    ...(filtros.hasta === "" ? {} : { hasta: filtros.hasta }),
  };
}

/** The signed quantity as text: a "+" in front of a positive amount, zero and negatives untouched. */
export function cantidadConSigno(valor: string): string {
  const esPositivo = !valor.startsWith("-") && /[1-9]/.test(valor);
  return esPositivo ? `+${valor}` : valor;
}

export function MovimientosScreen({
  inicial,
  filtrosIniciales,
}: {
  readonly inicial: MovimientosInicial;
  readonly filtrosIniciales: FiltrosMovimientos;
}) {
  const [data, setData] = useState<ListarMovimientosOutput | null>(
    inicial.ok ? inicial.data : null,
  );
  const [error, setError] = useState<string | null>(inicial.ok ? null : inicial.message);
  const [cargando, setCargando] = useState(false);
  // On the first load the server resolved the default range: show it in the date inputs.
  const [filtros, setFiltros] = useState<FiltrosMovimientos>(
    inicial.ok
      ? { ...filtrosIniciales, desde: inicial.data.desde, hasta: inicial.data.hasta }
      : filtrosIniciales,
  );
  const [texto, setTexto] = useState(filtrosIniciales.producto);
  const ultimaSolicitud = useRef(0);

  // Only the latest request may settle state: a slow earlier answer must not
  // overwrite a newer filter's rows.
  const consultar = useCallback(async (next: FiltrosMovimientos, page: number) => {
    const solicitud = ++ultimaSolicitud.current;
    setFiltros(next);
    setCargando(true);
    try {
      const r = await listarMovimientosInventarioAction(construirQuery(next, page));
      if (solicitud !== ultimaSolicitud.current) return;
      if (r.ok) {
        setData(r.data);
        setError(null);
      } else {
        setError(r.error.message);
      }
    } catch {
      // The action itself rejected (timeout, network, expired session).
      if (solicitud !== ultimaSolicitud.current) return;
      setError(MENSAJE_FALLO_CARGA);
    }
    setCargando(false);
  }, []);

  // The text search is debounced; tipo and dates apply immediately (handlers below).
  useEffect(() => {
    if (texto === filtros.producto) return;
    const timer = setTimeout(() => {
      void consultar({ ...filtros, producto: texto }, 1);
    }, DEBOUNCE_BUSQUEDA_MS);
    return () => clearTimeout(timer);
  }, [texto, filtros, consultar]);

  const totalPaginas = data === null ? 1 : Math.max(1, Math.ceil(data.total / data.limit));
  const busquedaPendiente = texto !== filtros.producto;

  return (
    <div className="flex flex-col gap-4">
      {error !== null && (
        <p role="alert" className={CLASE_ALERTA}>
          {error}
        </p>
      )}

      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <input
          type="search"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="Buscar por nombre o código..."
          aria-label="Buscar producto"
          className={`${CLASE_CONTROL} sm:flex-1`}
        />
        <select
          value={filtros.tipo ?? ""}
          onChange={(e) =>
            void consultar(
              {
                ...filtros,
                producto: texto,
                tipo: e.target.value === "" ? null : (e.target.value as TipoMovimientoInventario),
              },
              1,
            )
          }
          aria-label="Filtrar por tipo de movimiento"
          className={CLASE_CONTROL}
        >
          <option value="">Todos los tipos</option>
          {TIPOS_MOVIMIENTO.map((t) => (
            <option key={t} value={t}>
              {etiquetaTipoMovimiento(t)}
            </option>
          ))}
        </select>
        <label className="flex flex-col gap-1 text-xs text-zinc-500 dark:text-zinc-400">
          Desde
          <input
            type="date"
            value={filtros.desde}
            onChange={(e) => void consultar({ ...filtros, producto: texto, desde: e.target.value }, 1)}
            className={CLASE_CONTROL}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-zinc-500 dark:text-zinc-400">
          Hasta
          <input
            type="date"
            value={filtros.hasta}
            onChange={(e) => void consultar({ ...filtros, producto: texto, hasta: e.target.value }, 1)}
            className={CLASE_CONTROL}
          />
        </label>
      </div>

      {data !== null && data.items.length === 0 && (
        <p className="rounded-md border border-zinc-200 px-4 py-6 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
          No hay movimientos que coincidan con los filtros.
        </p>
      )}

      {data !== null && data.items.length > 0 && (
        <div
          className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800"
          aria-busy={cargando}
        >
          <table className="w-full text-left text-sm">
            <thead className="bg-zinc-50 text-xs uppercase text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
              <tr>
                <th scope="col" className="px-4 py-2">Fecha</th>
                <th scope="col" className="px-4 py-2">Producto</th>
                <th scope="col" className="px-4 py-2">Tipo</th>
                <th scope="col" className="px-4 py-2 text-right">Cantidad movida</th>
                <th scope="col" className="px-4 py-2 text-right">Cantidad anterior</th>
                <th scope="col" className="px-4 py-2 text-right">Cantidad nueva</th>
                <th scope="col" className="px-4 py-2">Usuario</th>
                <th scope="col" className="px-4 py-2">Motivo</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {data.items.map((m) => (
                <tr key={m.id} data-testid={`movimiento-fila-${m.id}`}>
                  <td className="whitespace-nowrap px-4 py-2 tabular-nums">
                    {formatearFechaHoraSD(new Date(m.fecha))}
                  </td>
                  <td className="px-4 py-2">
                    <span className="font-mono text-xs">{m.productoCodigo}</span>{" "}
                    <span className="font-medium text-zinc-900 dark:text-zinc-50">{m.productoNombre}</span>
                  </td>
                  <td className="px-4 py-2">{etiquetaTipoMovimiento(m.tipo)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{cantidadConSigno(m.cantidadMovida)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{m.cantidadAnterior}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{m.cantidadNueva}</td>
                  <td className="px-4 py-2">{m.usuarioNombre ?? SIN_USUARIO}</td>
                  <td className="px-4 py-2">{m.motivo}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data !== null && (
        <nav aria-label="Paginación historial" className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => void consultar(filtros, data.page - 1)}
            disabled={cargando || busquedaPendiente || data.page <= 1}
            aria-label="Página anterior"
            className={CLASE_BOTON}
          >
            Anterior
          </button>
          <span className="text-sm text-zinc-500">
            Página {data.page} de {totalPaginas}
          </span>
          <button
            type="button"
            onClick={() => void consultar(filtros, data.page + 1)}
            disabled={cargando || busquedaPendiente || data.page >= totalPaginas}
            aria-label="Página siguiente"
            className={CLASE_BOTON}
          >
            Siguiente
          </button>
        </nav>
      )}
    </div>
  );
}
