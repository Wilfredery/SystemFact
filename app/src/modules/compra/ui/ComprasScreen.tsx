"use client";

/**
 * Compras screen (screens plan Step 6, `odd/tasks/compras.md` S4/S6).
 *
 * Client island for the interactivity only: the server page hands over the first
 * load (already read through `listarComprasAction`), and every filter or page
 * change re-queries that same action. Pagination is 25 rows per page.
 *
 * Role gate (S3/S4): the page decides whether this island renders the Acciones
 * column at all, from the named role groups behind `obtenerPermisosCompraAction`.
 * Operador and Despachador (who receive purchases) get a read-only list; every
 * write action re-checks the role on the server regardless.
 *
 * S6: money and quantities arrive as fixed-point STRINGS and are only formatted
 * for display (`formatearMonto`) — no float arithmetic on the client.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { listarComprasAction, obtenerCompraAction } from "@/modules/compra/http/actions";
import { formatearFechaSD } from "@/shared/ui/format/date";
import { formatearMonto } from "@/shared/ui/format/money";
import {
  DEBOUNCE_BUSQUEDA_MS,
  ESTADOS_COMPRA_FILTRO,
  TAMANO_PAGINA,
  TIPOS_COMPRA_FILTRO,
  construirQueryCompras,
  etiquetaEstadoCompra,
  etiquetaTipoCompra,
  type CompraFila,
  type FiltrosCompras,
  type ListadoCompras,
} from "./compras-filtros";

export type { CompraFila, FiltrosCompras } from "./compras-filtros";

const MENSAJE_FALLO_CARGA = "No se pudo cargar las compras. Intente de nuevo.";
const MENSAJE_FALLO_DETALLE = "No se pudo abrir la compra. Intente de nuevo.";

const CLASE_CONTROL =
  "min-h-11 rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50";
const CLASE_BOTON =
  "min-h-11 rounded-md border border-zinc-300 px-4 text-sm font-medium text-zinc-700 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300";
const CLASE_ALERTA =
  "rounded-md bg-red-50 px-4 py-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-200";

/** Badge tone per frozen purchase state. */
const CLASE_ESTADO: Record<string, string> = {
  BORRADOR: "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  PENDIENTE: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  RECIBIDA: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  CANCELADA: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
};

export type ComprasInicial =
  | { readonly ok: true; readonly data: ListadoCompras }
  | { readonly ok: false; readonly message: string };

type RespuestaDetalle = Awaited<ReturnType<typeof obtenerCompraAction>>;
type CompraDetalle = Extract<RespuestaDetalle, { ok: true }>["data"];

type DetalleAbierto =
  | { readonly correlativo: string; readonly estado: "cargando" }
  | { readonly correlativo: string; readonly estado: "listo"; readonly data: CompraDetalle }
  | { readonly correlativo: string; readonly estado: "error"; readonly mensaje: string };

export function ComprasScreen({
  inicial,
  filtrosIniciales,
  puedeGestionar,
}: {
  readonly inicial: ComprasInicial;
  readonly filtrosIniciales: FiltrosCompras;
  readonly puedeGestionar: boolean;
}) {
  const [data, setData] = useState<ListadoCompras | null>(
    inicial.ok ? inicial.data : null,
  );
  const [error, setError] = useState<string | null>(inicial.ok ? null : inicial.message);
  const [cargando, setCargando] = useState(false);
  const [filtros, setFiltros] = useState<FiltrosCompras>(filtrosIniciales);
  const [texto, setTexto] = useState(filtrosIniciales.proveedorBusqueda);
  const [detalle, setDetalle] = useState<DetalleAbierto | null>(null);
  const ultimaSolicitud = useRef(0);

  // Only the latest request may settle state: a slow earlier answer must not
  // overwrite a newer filter's rows.
  const consultar = useCallback(async (next: FiltrosCompras, page: number) => {
    const solicitud = ++ultimaSolicitud.current;
    setFiltros(next);
    setCargando(true);
    try {
      const r = await listarComprasAction(construirQueryCompras(next, page));
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

  // Search is debounced; the estado/tipo selects apply immediately (below).
  useEffect(() => {
    if (texto === filtros.proveedorBusqueda) return;
    const timer = setTimeout(() => {
      void consultar({ ...filtros, proveedorBusqueda: texto }, 1);
    }, DEBOUNCE_BUSQUEDA_MS);
    return () => clearTimeout(timer);
  }, [texto, filtros, consultar]);

  /** Read-only detail from the canonical single-purchase read (S7 reuse). */
  async function abrirDetalle(fila: CompraFila) {
    setDetalle({ correlativo: fila.correlativoInterno, estado: "cargando" });
    try {
      const r = await obtenerCompraAction({ id: fila.id });
      if (!r.ok) {
        setDetalle({
          correlativo: fila.correlativoInterno,
          estado: "error",
          mensaje: r.error.message,
        });
        return;
      }
      setDetalle({
        correlativo: fila.correlativoInterno,
        estado: "listo",
        data: r.data,
      });
    } catch {
      setDetalle({
        correlativo: fila.correlativoInterno,
        estado: "error",
        mensaje: MENSAJE_FALLO_DETALLE,
      });
    }
  }

  if (data === null) {
    return (
      <p role="alert" className={CLASE_ALERTA}>
        {error ?? "No hay datos de compras."}
      </p>
    );
  }

  // Every query this island sends uses the screen's page size.
  const totalPaginas = Math.max(1, Math.ceil(data.total / TAMANO_PAGINA));
  const busquedaPendiente = texto !== filtros.proveedorBusqueda;

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
          onChange={(e) => setTexto(e.target.value)}
          placeholder="Buscar por proveedor..."
          aria-label="Buscar proveedor"
          className={`${CLASE_CONTROL} sm:flex-1`}
        />
        <select
          value={filtros.estado}
          onChange={(e) =>
            void consultar({ ...filtros, proveedorBusqueda: texto, estado: e.target.value }, 1)
          }
          aria-label="Filtrar por estado"
          className={CLASE_CONTROL}
        >
          {ESTADOS_COMPRA_FILTRO.map((e) => (
            <option key={e.valor} value={e.valor}>
              {e.etiqueta}
            </option>
          ))}
        </select>
        <select
          value={filtros.tipoCompra}
          onChange={(e) =>
            void consultar(
              { ...filtros, proveedorBusqueda: texto, tipoCompra: e.target.value },
              1,
            )
          }
          aria-label="Filtrar por tipo de compra"
          className={CLASE_CONTROL}
        >
          {TIPOS_COMPRA_FILTRO.map((t) => (
            <option key={t.valor} value={t.valor}>
              {t.etiqueta}
            </option>
          ))}
        </select>
      </div>

      {data.items.length === 0 ? (
        <p className="rounded-md border border-zinc-200 px-4 py-6 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
          No hay compras que coincidan con los filtros.
        </p>
      ) : (
        <div
          className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800"
          aria-busy={cargando}
        >
          <table className="w-full text-left text-sm">
            <thead className="bg-zinc-50 text-xs uppercase text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
              <tr>
                <th scope="col" className="px-4 py-2">Correlativo</th>
                <th scope="col" className="px-4 py-2">Proveedor</th>
                <th scope="col" className="px-4 py-2">Tipo</th>
                <th scope="col" className="px-4 py-2">NCF</th>
                <th scope="col" className="px-4 py-2">Estado</th>
                <th scope="col" className="px-4 py-2">Fecha</th>
                <th scope="col" className="px-4 py-2">Total</th>
                {puedeGestionar && <th scope="col" className="px-4 py-2">Acciones</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {data.items.map((c) => (
                <tr key={c.id} data-testid={`compra-fila-${c.id}`}>
                  <td className="px-4 py-2 font-mono text-xs">{c.correlativoInterno}</td>
                  <td className="px-4 py-2 font-medium text-zinc-900 dark:text-zinc-50">
                    {c.proveedorNombre}
                  </td>
                  <td className="px-4 py-2">{etiquetaTipoCompra(c.tipoCompra)}</td>
                  <td className="px-4 py-2 font-mono text-xs">{c.ncf ?? "—"}</td>
                  <td className="px-4 py-2">
                    <span
                      className={`rounded px-2 py-1 text-xs font-medium ${
                        CLASE_ESTADO[c.estado] ?? ""
                      }`}
                    >
                      {etiquetaEstadoCompra(c.estado)}
                    </span>
                  </td>
                  <td className="px-4 py-2">{formatearFechaSD(c.fecha)}</td>
                  <td className="px-4 py-2 tabular-nums">{formatearMonto(c.total)}</td>
                  {puedeGestionar && (
                    <td className="px-4 py-2">
                      <button
                        type="button"
                        aria-label={`Ver detalle ${c.correlativoInterno}`}
                        onClick={() => void abrirDetalle(c)}
                        className={CLASE_BOTON}
                      >
                        Ver detalle
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <nav aria-label="Paginación compras" className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => void consultar(filtros, data.page - 1)}
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
          onClick={() => void consultar(filtros, data.page + 1)}
          disabled={cargando || busquedaPendiente || data.page >= totalPaginas}
          aria-label="Siguiente"
          className={CLASE_BOTON}
        >
          Siguiente
        </button>
      </nav>

      {detalle !== null && (
        <DetalleCompra detalle={detalle} onCerrar={() => setDetalle(null)} />
      )}
    </div>
  );
}

/** Read-only purchase detail (header figures, all as display strings). */
function DetalleCompra({
  detalle,
  onCerrar,
}: {
  readonly detalle: DetalleAbierto;
  readonly onCerrar: () => void;
}) {
  return (
    <section
      aria-label={`Detalle de compra ${detalle.correlativo}`}
      className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800"
    >
      <div className="mb-3 flex items-center justify-between gap-4">
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
          {detalle.correlativo}
        </h2>
        <button type="button" onClick={onCerrar} aria-label="Cerrar detalle" className={CLASE_BOTON}>
          Cerrar
        </button>
      </div>

      {detalle.estado === "cargando" && <p className="text-sm text-zinc-500">Cargando…</p>}

      {detalle.estado === "error" && (
        <p role="alert" className={CLASE_ALERTA}>
          {detalle.mensaje}
        </p>
      )}

      {detalle.estado === "listo" && (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
          <dt className="text-zinc-500">Proveedor</dt>
          <dd className="text-zinc-900 dark:text-zinc-50">{detalle.data.proveedor.nombre}</dd>
          <dt className="text-zinc-500">Estado</dt>
          <dd>{etiquetaEstadoCompra(detalle.data.estado)}</dd>
          <dt className="text-zinc-500">Tipo</dt>
          <dd>{etiquetaTipoCompra(detalle.data.tipoCompra)}</dd>
          <dt className="text-zinc-500">NCF</dt>
          <dd className="font-mono text-xs">{detalle.data.ncf ?? "—"}</dd>
          <dt className="text-zinc-500">Fecha</dt>
          <dd>{formatearFechaSD(detalle.data.fecha)}</dd>
          <dt className="text-zinc-500">Subtotal</dt>
          <dd className="tabular-nums">{formatearMonto(detalle.data.subtotal)}</dd>
          <dt className="text-zinc-500">ITBIS</dt>
          <dd className="tabular-nums">{formatearMonto(detalle.data.itbis)}</dd>
          <dt className="text-zinc-500">Retención ISR</dt>
          <dd className="tabular-nums">{formatearMonto(detalle.data.retencionIsr)}</dd>
          <dt className="text-zinc-500">Retención ITBIS</dt>
          <dd className="tabular-nums">{formatearMonto(detalle.data.retencionItbis)}</dd>
          <dt className="text-zinc-500">Total</dt>
          <dd className="tabular-nums font-medium">{formatearMonto(detalle.data.total)}</dd>
          <dt className="text-zinc-500">Líneas</dt>
          <dd className="tabular-nums">{detalle.data.lineas.length}</dd>
        </dl>
      )}
    </section>
  );
}
