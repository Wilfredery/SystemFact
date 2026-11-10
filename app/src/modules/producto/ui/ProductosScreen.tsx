"use client";

/**
 * Productos screen (plan Step 2, S1-S4).
 *
 * Client island for the interactivity only: the server page hands over the first
 * load (already read through `consultarProductosAction`), and every filter or
 * page change re-queries that same action. Prices arrive as Decimal(12,2)
 * strings and are only formatted for display — the screen never computes money.
 *
 * Role gate (S3): the page decides whether this island renders the manage
 * controls at all, from the manage role group. Operador and Despachador get a
 * read-only list; the write actions re-check the role on the server regardless.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  consultarProductosAction,
  desactivarProductoAction,
  obtenerProductoPorIdAction,
} from "@/modules/producto/http/actions";
import type { ConsultarProductosOutput } from "@/modules/producto/application/consultar-productos";
import type { ProductoConsultaItem } from "@/modules/producto/application/producto-consulta-projection";
import { formatearMonto } from "@/shared/ui/format";
import {
  DEBOUNCE_BUSQUEDA_MS,
  ESTADOS_PRODUCTO,
  construirQueryProductos,
  type EstadoProducto,
  type FiltrosProductos,
} from "./productos-filtros";
import { ProductoFormulario } from "./ProductoFormulario";
import { ConfirmarDesactivacion } from "./ConfirmarDesactivacion";

export type { EstadoProducto, FiltrosProductos } from "./productos-filtros";

const MENSAJE_FALLO_CARGA = "No se pudo cargar los productos. Intente de nuevo.";
const MENSAJE_FALLO_LECTURA = "No se pudo abrir el producto. Intente de nuevo.";
const MENSAJE_FALLO_ACCION = "No se pudo completar la acción. Intente de nuevo.";

const CLASE_CONTROL =
  "min-h-11 rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50";
const CLASE_BOTON =
  "min-h-11 rounded-md border border-zinc-300 px-4 text-sm font-medium text-zinc-700 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300";
const CLASE_ALERTA =
  "rounded-md bg-red-50 px-4 py-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-200";

export type ProductosInicial =
  | { readonly ok: true; readonly data: ConsultarProductosOutput }
  | { readonly ok: false; readonly message: string };

type FormularioAbierto =
  | { readonly modo: "crear" }
  | { readonly modo: "editar"; readonly producto: ProductoConsultaItem }
  | null;

export function ProductosScreen({
  inicial,
  filtrosIniciales,
  puedeGestionar,
}: {
  readonly inicial: ProductosInicial;
  readonly filtrosIniciales: FiltrosProductos;
  readonly puedeGestionar: boolean;
}) {
  const [data, setData] = useState<ConsultarProductosOutput | null>(
    inicial.ok ? inicial.data : null,
  );
  const [error, setError] = useState<string | null>(inicial.ok ? null : inicial.message);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const [filtros, setFiltros] = useState<FiltrosProductos>(filtrosIniciales);
  const [texto, setTexto] = useState(filtrosIniciales.busqueda);
  const [formulario, setFormulario] = useState<FormularioAbierto>(null);
  const [porDesactivar, setPorDesactivar] = useState<ProductoConsultaItem | null>(null);
  const [desactivando, setDesactivando] = useState(false);
  const [errorDesactivar, setErrorDesactivar] = useState<string | null>(null);
  const ultimaSolicitud = useRef(0);

  // Only the latest request may settle state: a slow earlier answer must not
  // overwrite a newer filter's rows.
  const consultar = useCallback(async (next: FiltrosProductos, page: number) => {
    const solicitud = ++ultimaSolicitud.current;
    setFiltros(next);
    setCargando(true);
    try {
      const r = await consultarProductosAction(construirQueryProductos(next, page));
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

  const refrescar = useCallback(
    async () => consultar({ ...filtros, busqueda: texto }, 1),
    [consultar, filtros, texto],
  );

  // Search is debounced; the selects apply immediately (handlers below).
  useEffect(() => {
    if (texto === filtros.busqueda) return;
    const timer = setTimeout(() => {
      void consultar({ ...filtros, busqueda: texto }, 1);
    }, DEBOUNCE_BUSQUEDA_MS);
    return () => clearTimeout(timer);
  }, [texto, filtros, consultar]);

  /** Opens the edit dialog from a fresh single-product read (version included). */
  async function abrirEdicion(id: number) {
    setMensaje(null);
    setError(null);
    try {
      const r = await obtenerProductoPorIdAction({ id });
      if (!r.ok) {
        setError(r.error.message);
        return;
      }
      setFormulario({ modo: "editar", producto: r.data });
    } catch {
      setError(MENSAJE_FALLO_LECTURA);
    }
  }

  function abrirCreacion() {
    setMensaje(null);
    setError(null);
    setFormulario({ modo: "crear" });
  }

  function abrirDesactivacion(producto: ProductoConsultaItem) {
    setMensaje(null);
    setErrorDesactivar(null);
    setPorDesactivar(producto);
  }

  async function confirmarDesactivacion() {
    if (porDesactivar === null) return;
    setDesactivando(true);
    setErrorDesactivar(null);
    try {
      const r = await desactivarProductoAction({ id: porDesactivar.id });
      if (!r.ok) {
        setErrorDesactivar(r.error.message);
        return;
      }
      setPorDesactivar(null);
      setMensaje("Producto desactivado.");
      await refrescar();
    } catch {
      setErrorDesactivar(MENSAJE_FALLO_ACCION);
    } finally {
      setDesactivando(false);
    }
  }

  if (data === null) {
    return (
      <p role="alert" className={CLASE_ALERTA}>
        {error ?? "No hay datos de productos."}
      </p>
    );
  }

  const totalPaginas = Math.max(1, Math.ceil(data.total / data.limit));
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
          value={filtros.estado}
          onChange={(e) =>
            void consultar(
              {
                ...filtros,
                busqueda: texto,
                estado: e.target.value as EstadoProducto,
              },
              1,
            )
          }
          aria-label="Filtrar por estado"
          className={CLASE_CONTROL}
        >
          {ESTADOS_PRODUCTO.map((e) => (
            <option key={e.valor} value={e.valor}>
              {e.etiqueta}
            </option>
          ))}
        </select>
        {puedeGestionar && (
          <button
            type="button"
            onClick={abrirCreacion}
            className="min-h-11 rounded-md bg-zinc-900 px-5 text-sm font-medium text-white dark:bg-zinc-50 dark:text-zinc-900"
          >
            + Nuevo producto
          </button>
        )}
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
                <th scope="col" className="px-4 py-2">ITBIS</th>
                <th scope="col" className="px-4 py-2 text-right">Precio</th>
                <th scope="col" className="px-4 py-2">Estado</th>
                {puedeGestionar && (
                  <th scope="col" className="px-4 py-2">Acciones</th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {data.items.map((p) => (
                <tr key={p.id} data-testid={`producto-fila-${p.id}`}>
                  <td className="px-4 py-2 font-mono text-xs">{p.codigo}</td>
                  <td className="px-4 py-2 font-medium text-zinc-900 dark:text-zinc-50">
                    {p.nombre}
                  </td>
                  <td className="px-4 py-2">{p.categoria}</td>
                  <td className="px-4 py-2">{p.unidadMedida}</td>
                  <td className="px-4 py-2">{p.tasaItbis}%</td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {formatearMonto(p.precioVenta)}
                  </td>
                  <td className="px-4 py-2">
                    <span
                      className={`rounded px-2 py-1 text-xs font-medium ${
                        p.activo
                          ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                          : "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                      }`}
                    >
                      {p.activo ? "Activo" : "Inactivo"}
                    </span>
                  </td>
                  {puedeGestionar && (
                    <td className="px-4 py-2">
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          aria-label={`Editar ${p.codigo}`}
                          onClick={() => void abrirEdicion(p.id)}
                          className={CLASE_BOTON}
                        >
                          Editar
                        </button>
                        {p.activo && (
                          <button
                            type="button"
                            aria-label={`Desactivar ${p.codigo}`}
                            onClick={() => abrirDesactivacion(p)}
                            className={CLASE_BOTON}
                          >
                            Desactivar
                          </button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <nav aria-label="Paginación productos" className="flex items-center justify-between gap-2">
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

      {formulario !== null && (
        <ProductoFormulario
          producto={formulario.modo === "editar" ? formulario.producto : null}
          categorias={data.categorias}
          onGuardado={() => {
            setMensaje(
              formulario.modo === "editar" ? "Producto actualizado." : "Producto creado.",
            );
            setFormulario(null);
            void refrescar();
          }}
          onCancelar={() => setFormulario(null)}
        />
      )}

      {porDesactivar !== null && (
        <ConfirmarDesactivacion
          producto={porDesactivar}
          enviando={desactivando}
          error={errorDesactivar}
          onConfirmar={() => void confirmarDesactivacion()}
          onCancelar={() => setPorDesactivar(null)}
        />
      )}
    </div>
  );
}
