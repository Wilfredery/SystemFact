"use client";

/**
 * Inventario consulta screen (wireframe `04-Inventario-Consulta`, read-only).
 *
 * Client island for the interactivity only: the server page hands over the first
 * load (already read through `consultarInventarioAction`), and every filter or
 * page change re-queries that same action. The screen never computes money — the
 * KPI value arrives as a Decimal string and is only formatted for display.
 * Per the board-04 decision (odd/tasks/uiux-alignment.md S19), rows for the
 * manage group carry a ⋯ menu with "Ajustar" (prefills the adjust form with the
 * product's code) and "Historial" (opens the movement history filtered to the
 * product). Both destinations are Administrador-only server-side, so the menu
 * renders only when the page grants `puedeAjustar`.
 *
 * Board-04 S24: F0 primitives + token classes only (no raw palette, no
 * dark-mode overrides). The `normal` status badge uses the `--success-bg`/`--success-fg`
 * pair added for this board.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { consultarInventarioAction } from "@/modules/inventario/http/actions";
import type { ConsultarInventarioOutput } from "@/modules/inventario/application/consultar-inventario";
import type { StockKpi } from "@/modules/inventario/domain/inventario";
import { formatearMonto } from "@/shared/ui/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
const MENSAJE_FALLO_CARGA = "No se pudo cargar el inventario. Intente de nuevo.";

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

/** Status badge tone per stock state (F0.1 registry only — the registries own both modes). */
const CLASE_ESTADO: Record<StockKpi, string> = {
  normal: "border-transparent bg-success-bg text-success-fg",
  bajo_stock: "border-transparent bg-warn-bg text-warn",
  agotado: "border-transparent bg-danger/10 text-danger",
};

/** Native <select> face, token-bound (the F0 Select primitive is not used here). */
const CLASE_SELECT =
  "min-h-11 rounded-lg border border-line bg-surface px-2.5 text-sm text-ink";
const CLASE_ALERTA =
  "rounded-md bg-danger/10 px-3 py-2 text-sm text-danger";

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
  puedeAjustar = false,
}: {
  readonly inicial: InventarioInicial;
  readonly filtrosIniciales: FiltrosInventario;
  /** Menu column on each row (adjust + history): manage group only. */
  readonly puedeAjustar?: boolean;
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
    try {
      const r = await consultarInventarioAction(construirQuery(next, page));
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
  const busquedaPendiente = texto !== filtros.busqueda;

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
        <Input
          type="search"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="Buscar por nombre o código..."
          aria-label="Buscar producto"
          className="sm:flex-1"
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
          className={CLASE_SELECT}
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
          className={CLASE_SELECT}
        >
          <option value="">Todos los estados</option>
          <option value="normal">Disponible</option>
          <option value="bajo_stock">Bajo stock</option>
          <option value="agotado">Agotado</option>
        </select>
      </div>

      {data.items.length === 0 ? (
        <p className="rounded-md border border-line px-4 py-6 text-center text-sm text-ink-muted">
          No hay productos que coincidan con los filtros.
        </p>
      ) : (
        <div
          className="overflow-x-auto rounded-lg border border-line"
          aria-busy={cargando}
        >
          <Table>
            <TableHeader className="bg-surface-muted text-xs uppercase">
              <TableRow>
                <TableHead scope="col" className="px-4">Código</TableHead>
                <TableHead scope="col" className="px-4">Nombre</TableHead>
                <TableHead scope="col" className="px-4">Categoría</TableHead>
                <TableHead scope="col" className="px-4">Und.</TableHead>
                <TableHead scope="col" className="px-4 text-right">Existencia</TableHead>
                <TableHead scope="col" className="px-4 text-right">Stock mín.</TableHead>
                <TableHead scope="col" className="px-4">Estado</TableHead>
                {puedeAjustar && (
                  <TableHead scope="col" className="px-4">Acciones</TableHead>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.items.map((p) => (
                <TableRow key={p.productoId} data-testid={`inventario-fila-${p.productoId}`}>
                  <TableCell className="px-4 py-2 font-mono text-xs">{p.codigo}</TableCell>
                  <TableCell className="px-4 py-2 font-medium text-ink">{p.nombre}</TableCell>
                  <TableCell className="px-4 py-2">{p.categoria}</TableCell>
                  <TableCell className="px-4 py-2">{p.unidadMedida}</TableCell>
                  <TableCell className="px-4 py-2 text-right tabular-nums">{p.cantidad}</TableCell>
                  <TableCell className="px-4 py-2 text-right tabular-nums">{p.stockMinimo}</TableCell>
                  <TableCell className="px-4 py-2">
                    <Badge className={CLASE_ESTADO[p.estado]}>
                      {ETIQUETA_ESTADO[p.estado]}
                    </Badge>
                  </TableCell>
                  {puedeAjustar && (
                    <TableCell className="px-4 py-2">
                      <MenuFila codigo={p.codigo} />
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <nav aria-label="Paginación inventario" className="flex items-center justify-between gap-2">
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
    </div>
  );
}

/**
 * Per-row ⋯ menu: "Ajustar" (prefill by code) and "Historial" (exact-code
 * filtered history). The panel renders through a portal with fixed position so
 * the table's `overflow-x-auto` wrapper can never clip it (JD-B-003); it closes
 * on Escape or on a press outside both the panel and the button.
 */
function MenuFila({ codigo }: { readonly codigo: string }) {
  const [abierto, setAbierto] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const botonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  function alternar() {
    if (abierto) {
      setAbierto(false);
      return;
    }
    const r = botonRef.current?.getBoundingClientRect();
    if (r !== undefined) {
      // Right-align under the button (panel width 176px = 44rem/4 -> w-44).
      setPos({ top: r.bottom + 4, left: Math.max(8, r.right - 176) });
    }
    setAbierto(true);
  }

  useEffect(() => {
    if (!abierto) return;
    const alPulsar = (e: MouseEvent) => {
      const objetivo = e.target as Node;
      if (!menuRef.current?.contains(objetivo) && !botonRef.current?.contains(objetivo)) {
        setAbierto(false);
      }
    };
    const alTeclar = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAbierto(false);
    };
    document.addEventListener("mousedown", alPulsar);
    document.addEventListener("keydown", alTeclar);
    return () => {
      document.removeEventListener("mousedown", alPulsar);
      document.removeEventListener("keydown", alTeclar);
    };
  }, [abierto]);

  return (
    <>
      <Button
        ref={botonRef}
        type="button"
        variant="outline"
        size="icon"
        aria-haspopup="menu"
        aria-expanded={abierto}
        aria-label={`Acciones ${codigo}`}
        data-testid={`menu-fila-${codigo}`}
        onClick={alternar}
        className="text-lg"
      >
        <span aria-hidden="true">⋯</span>
      </Button>
      {abierto &&
        pos !== null &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            aria-label={`Acciones ${codigo}`}
            style={{ position: "fixed", top: pos.top, left: pos.left }}
            className="z-50 flex w-44 flex-col overflow-hidden rounded-lg border border-line bg-surface shadow-md"
          >
            <Link
              role="menuitem"
              href={`/inventario/ajuste?producto=${encodeURIComponent(codigo)}`}
              className="min-h-11 px-4 py-2 text-sm text-ink hover:bg-surface-muted"
            >
              Ajustar
            </Link>
            <Link
              role="menuitem"
              href={`/inventario/movimientos?productoCodigo=${encodeURIComponent(codigo)}`}
              className="min-h-11 px-4 py-2 text-sm text-ink hover:bg-surface-muted"
            >
              Historial
            </Link>
          </div>,
          document.body,
        )}
    </>
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
    <Card size="sm" data-testid={`inventario-kpi-${testid}`} className="gap-1">
      <CardHeader>
        <CardDescription>{etiqueta}</CardDescription>
        <CardTitle className="text-2xl font-semibold tabular-nums">{valor}</CardTitle>
      </CardHeader>
    </Card>
  );
}
