"use client";

/**
 * Inventario consulta screen (wireframe `04-Inventario-Consulta`, read-only).
 *
 * Client island for the interactivity only: the server page hands over the first
 * load (already read through `consultarInventarioAction`), and every filter or
 * page change re-queries that same action. The screen never computes money — the
 * KPI value arrives as a Decimal string and is only formatted for display.
 * No adjust button and no row actions here: those belong to the Administrador-only
 * adjust flow (Step 1b).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { consultarInventarioAction } from "@/modules/inventario/http/actions";
import type { ConsultarInventarioOutput } from "@/modules/inventario/application/consultar-inventario";
import type { StockKpi } from "@/modules/inventario/domain/inventario";
import { formatearMonto } from "@/shared/ui/format";

export const TAMANO_PAGINA = 25;
const DEBOUNCE_BUSQUEDA_MS = 300;

export type InventarioInicial =
  | { readonly ok: true; readonly data: ConsultarInventarioOutput }
  | { readonly ok: false; readonly message: string };

export interface FiltrosInventario {
  readonly busqueda: string;
  readonly categoriaId: number | null;
  readonly estado: StockKpi | null;
}

const ETIQUETA_ESTADO: Record<StockKpi, string> = {
  normal: "Disponible",
  bajo_stock: "Bajo stock",
  agotado: "Agotado",
};

const CLASE_ESTADO: Record<StockKpi, string> = {
  normal: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  bajo_stock: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  agotado: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
};

const CLASE_CONTROL =
  "min-h-11 rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50";
const CLASE_BOTON =
  "min-h-11 rounded-md border border-zinc-300 px-4 text-sm font-medium text-zinc-700 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300";
const CLASE_ALERTA =
  "rounded-md bg-red-50 px-4 py-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-200";

function construirQuery(filtros: FiltrosInventario, page: number) {
  return {
    page,
    limit: TAMANO_PAGINA,
    ...(filtros.busqueda.trim() === "" ? {} : { busqueda: filtros.busqueda.trim() }),
    ...(filtros.categoriaId === null ? {} : { categoriaId: filtros.categoriaId }),
    ...(filtros.estado === null ? {} : { estado: filtros.estado }),
  };
}

export function InventarioScreen({
  inicial,
  filtrosIniciales,
}: {
  readonly inicial: InventarioInicial;
  readonly filtrosIniciales: FiltrosInventario;
}) {
  const [data, setData] = useState<ConsultarInventarioOutput | null>(
    inicial.ok ? inicial.data : null,
  );
  const [error, setError] = useState<string | null>(inicial.ok ? null : inicial.message);
  const [cargando, setCargando] = useState(false);
  const [filtros, setFiltros] = useState<FiltrosInventario>(filtrosIniciales);
  const [texto, setTexto] = useState(filtrosIniciales.busqueda);
  const ultimaSolicitud = useRef(0);

  // Only the latest request may settle state: a slow earlier answer must not
  // overwrite a newer filter's rows.
  const consultar = useCallback(async (next: FiltrosInventario, page: number) => {
    const solicitud = ++ultimaSolicitud.current;
    setFiltros(next);
    setCargando(true);
    const r = await consultarInventarioAction(construirQuery(next, page));
    if (solicitud !== ultimaSolicitud.current) return;
    if (r.ok) {
      setData(r.data);
      setError(null);
    } else {
      setError(r.error.message);
    }
    setCargando(false);
  }, []);

  // Search is debounced; the other filters apply immediately (handlers below).
  useEffect(() => {
    if (texto === filtros.busqueda) return;
    const timer = setTimeout(() => {
      void consultar({ ...filtros, busqueda: texto }, 1);
    }, DEBOUNCE_BUSQUEDA_MS);
    return () => clearTimeout(timer);
  }, [texto, filtros, consultar]);

  if (data === null) {
    return (
      <p role="alert" className={CLASE_ALERTA}>
        {error ?? "No hay datos de inventario."}
      </p>
    );
  }

  const totalPaginas = Math.max(1, Math.ceil(data.total / data.limit));

  return (
    <div className="flex flex-col gap-4">
      {error !== null && (
        <p role="alert" className={CLASE_ALERTA}>
          {error}
        </p>
      )}

      <section aria-label="Resumen de inventario" className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <TarjetaKpi testid="total" etiqueta="Total productos" valor={String(data.resumen.totalProductos)} />
        <TarjetaKpi testid="bajo" etiqueta="Bajo stock" valor={String(data.resumen.bajoStock)} />
        <TarjetaKpi testid="agotados" etiqueta="Agotados" valor={String(data.resumen.agotados)} />
        <TarjetaKpi
          testid="valor"
          etiqueta="Valor de inventario"
          valor={formatearMonto(data.resumen.valorInventario)}
        />
      </section>

      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          type="search"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="Buscar por nombre o código..."
          aria-label="Buscar producto"
          className={`${CLASE_CONTROL} sm:flex-1`}
        />
        <select
          value={filtros.categoriaId === null ? "" : String(filtros.categoriaId)}
          onChange={(e) =>
            void consultar(
              {
                ...filtros,
                busqueda: texto,
                categoriaId: e.target.value === "" ? null : Number(e.target.value),
              },
              1,
            )
          }
          aria-label="Filtrar por categoría"
          className={CLASE_CONTROL}
        >
          <option value="">Todas las categorías</option>
          {data.categorias.map((c) => (
            <option key={c.id} value={String(c.id)}>
              {c.nombre}
            </option>
          ))}
        </select>
        <select
          value={filtros.estado ?? ""}
          onChange={(e) =>
            void consultar(
              {
                ...filtros,
                busqueda: texto,
                estado: e.target.value === "" ? null : (e.target.value as StockKpi),
              },
              1,
            )
          }
          aria-label="Filtrar por estado"
          className={CLASE_CONTROL}
        >
          <option value="">Todos los estados</option>
          <option value="normal">Disponible</option>
          <option value="bajo_stock">Bajo stock</option>
          <option value="agotado">Agotado</option>
        </select>
      </div>

      {data.items.length === 0 ? (
        <p className="rounded-md border border-zinc-200 px-4 py-6 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
          No hay productos que coincidan con los filtros.
        </p>
      ) : (
        <div
          className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800"
          aria-busy={cargando}
        >
          <table className="w-full text-left text-sm">
            <thead className="bg-zinc-50 text-xs uppercase text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
              <tr>
                <th scope="col" className="px-4 py-2">Código</th>
                <th scope="col" className="px-4 py-2">Nombre</th>
                <th scope="col" className="px-4 py-2">Categoría</th>
                <th scope="col" className="px-4 py-2">Und.</th>
                <th scope="col" className="px-4 py-2 text-right">Existencia</th>
                <th scope="col" className="px-4 py-2 text-right">Stock mín.</th>
                <th scope="col" className="px-4 py-2">Estado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {data.items.map((p) => (
                <tr key={p.productoId} data-testid={`inventario-fila-${p.productoId}`}>
                  <td className="px-4 py-2 font-mono text-xs">{p.codigo}</td>
                  <td className="px-4 py-2 font-medium text-zinc-900 dark:text-zinc-50">{p.nombre}</td>
                  <td className="px-4 py-2">{p.categoria}</td>
                  <td className="px-4 py-2">{p.unidadMedida}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{p.cantidad}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{p.stockMinimo}</td>
                  <td className="px-4 py-2">
                    <span className={`rounded px-2 py-1 text-xs font-medium ${CLASE_ESTADO[p.estado]}`}>
                      {ETIQUETA_ESTADO[p.estado]}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <nav aria-label="Paginación inventario" className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => void consultar(filtros, data.page - 1)}
          disabled={cargando || data.page <= 1}
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
          disabled={cargando || data.page >= totalPaginas}
          aria-label="Página siguiente"
          className={CLASE_BOTON}
        >
          Siguiente
        </button>
      </nav>
    </div>
  );
}

function TarjetaKpi({
  testid,
  etiqueta,
  valor,
}: {
  readonly testid: string;
  readonly etiqueta: string;
  readonly valor: string;
}) {
  return (
    <div
      data-testid={`inventario-kpi-${testid}`}
      className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
    >
      <p className="text-xs text-zinc-500 dark:text-zinc-400">{etiqueta}</p>
      <p className="mt-2 text-2xl font-semibold text-zinc-900 dark:text-zinc-50">{valor}</p>
    </div>
  );
}
