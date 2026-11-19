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
 *
 * Board-04 S24: F0 primitives + token classes only (no raw palette, no
 * dark-mode overrides).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { listarMovimientosInventarioAction } from "@/modules/inventario/http/actions";
import type { ListarMovimientosOutput } from "@/modules/inventario/application/listar-movimientos-inventario";
import {
  TIPOS_MOVIMIENTO,
  etiquetaTipoMovimiento,
  type TipoMovimientoInventario,
} from "@/modules/inventario/domain/movimientos";
import { formatearFechaHoraSD } from "@/shared/ui/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
  /** Board-04 S19: exact product code from the consulta row menu (sticky filter). */
  readonly productoCodigo: string;
  /** `YYYY-MM-DD` or "" (= default range). */
  readonly desde: string;
  readonly hasta: string;
}

/** Native <select>/<input type=date> face, token-bound (no F0 primitive needed). */
const CLASE_CONTROL =
  "min-h-11 rounded-lg border border-line bg-surface px-2.5 text-sm text-ink";
const CLASE_ALERTA =
  "rounded-md bg-danger/10 px-3 py-2 text-sm text-danger";

function construirQuery(filtros: FiltrosMovimientos, page: number) {
  return {
    page,
    limit: TAMANO_PAGINA,
    ...(filtros.tipo === null ? {} : { tipo: filtros.tipo }),
    ...(filtros.producto.trim() === "" ? {} : { producto: filtros.producto.trim() }),
    ...(filtros.productoCodigo.trim() === "" ? {} : { productoCodigo: filtros.productoCodigo.trim() }),
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
        <Input
          type="search"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="Buscar por nombre o código..."
          aria-label="Buscar producto"
          className="sm:flex-1"
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
        <label className="flex flex-col gap-1 text-xs text-ink-muted">
          Desde
          <input
            type="date"
            value={filtros.desde}
            onChange={(e) => void consultar({ ...filtros, producto: texto, desde: e.target.value }, 1)}
            className={CLASE_CONTROL}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-muted">
          Hasta
          <input
            type="date"
            value={filtros.hasta}
            onChange={(e) => void consultar({ ...filtros, producto: texto, hasta: e.target.value }, 1)}
            className={CLASE_CONTROL}
          />
        </label>
      </div>

      {/* Board-04 S19: the row-menu exact filter is sticky; make it visible
          and clearable, otherwise the search box would silently do nothing. */}
      {filtros.productoCodigo.trim() !== "" && (
        <div data-testid="filtro-producto-codigo" className="flex items-center gap-2 text-sm">
          <span className="text-ink-muted">Producto:</span>
          <span className="font-mono text-ink">{filtros.productoCodigo.trim()}</span>
          <button
            type="button"
            aria-label="Quitar filtro de producto"
            onClick={() => void consultar({ ...filtros, productoCodigo: "" }, 1)}
            className="inline-flex min-h-9 min-w-9 items-center justify-center rounded-md border border-line text-ink hover:bg-surface-muted"
          >
            <span aria-hidden="true">✕</span>
          </button>
        </div>
      )}

      {data !== null && data.items.length === 0 && (
        <p className="rounded-md border border-line px-4 py-6 text-center text-sm text-ink-muted">
          No hay movimientos que coincidan con los filtros.
        </p>
      )}

      {data !== null && data.items.length > 0 && (
        <div
          className="overflow-x-auto rounded-lg border border-line"
          aria-busy={cargando}
        >
          <Table>
            <TableHeader className="bg-surface-muted text-xs uppercase">
              <TableRow>
                <TableHead scope="col" className="px-4">Fecha</TableHead>
                <TableHead scope="col" className="px-4">Producto</TableHead>
                <TableHead scope="col" className="px-4">Tipo</TableHead>
                <TableHead scope="col" className="px-4 text-right">Cantidad movida</TableHead>
                <TableHead scope="col" className="px-4 text-right">Cantidad anterior</TableHead>
                <TableHead scope="col" className="px-4 text-right">Cantidad nueva</TableHead>
                <TableHead scope="col" className="px-4">Usuario</TableHead>
                <TableHead scope="col" className="px-4">Motivo</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.items.map((m) => (
                <TableRow key={m.id} data-testid={`movimiento-fila-${m.id}`}>
                  <TableCell className="whitespace-nowrap px-4 py-2 tabular-nums">
                    {formatearFechaHoraSD(new Date(m.fecha))}
                  </TableCell>
                  <TableCell className="px-4 py-2">
                    <span className="font-mono text-xs">{m.productoCodigo}</span>{" "}
                    <span className="font-medium text-ink">{m.productoNombre}</span>
                  </TableCell>
                  <TableCell className="px-4 py-2">{etiquetaTipoMovimiento(m.tipo)}</TableCell>
                  <TableCell className="px-4 py-2 text-right tabular-nums">{cantidadConSigno(m.cantidadMovida)}</TableCell>
                  <TableCell className="px-4 py-2 text-right tabular-nums">{m.cantidadAnterior}</TableCell>
                  <TableCell className="px-4 py-2 text-right tabular-nums">{m.cantidadNueva}</TableCell>
                  <TableCell className="px-4 py-2">{m.usuarioNombre ?? SIN_USUARIO}</TableCell>
                  <TableCell className="px-4 py-2">{m.motivo}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {data !== null && (
        <nav aria-label="Paginación historial" className="flex items-center justify-between gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => void consultar(filtros, data.page - 1)}
            disabled={cargando || busquedaPendiente || data.page <= 1}
            aria-label="Página anterior"
          >
            Anterior
          </Button>
          <span className="text-sm text-ink-muted">
            Página {data.page} de {totalPaginas}
          </span>
          <Button
            type="button"
            variant="outline"
            onClick={() => void consultar(filtros, data.page + 1)}
            disabled={cargando || busquedaPendiente || data.page >= totalPaginas}
            aria-label="Página siguiente"
          >
            Siguiente
          </Button>
        </nav>
      )}
    </div>
  );
}
