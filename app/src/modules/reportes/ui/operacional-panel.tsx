/**
 * Reportes UI — the operational report result panel (slice B).
 *
 * A pure SERVER presentational component (AGENTS.md "server components by default"): it renders
 * the {@link Pagina} a consult action returned — the rows, the page-independent Decimal
 * summary, simple link-based pagination, and the role-authorized "Exportar CSV" affordance. It
 * holds NO data, issues NO query and contains NO authorization logic: the use case already
 * gated the read (the panel is only reached with a successful, role-authorized result), and the
 * export link points at `/reportes/exportar`, which re-enforces the SAME gate server-side
 * (EXP-4). The export control renders ONLY alongside a permitted data panel — never for a
 * denial — so it is list-before-export and gate-identical (EXP-5, decision 2.5.3).
 *
 * Money/quantities are Decimal strings formatted via the reused cobros display formatters
 * (never a float); fiscal codes (VIGENTE/B01/AGOTADO…) render verbatim (they are codes, not
 * copy). The discriminated {@link PanelOperativoProps} union keeps every column access
 * statically typed — no `any` (AGENTS.md "zero any").
 */

import Link from "next/link";
import type { Pagina } from "../domain/reporte-resultado";
import type {
  EstadoFacturaCelda,
  InventarioValorizadoFila,
  ProductoVendidoFila,
  VentasPeriodoFila,
} from "../domain/operacional";
import type { SeleccionReporte } from "./url";
import { construirHref, construirHrefExportar } from "./url";
import {
  formatearCantidad,
  formatearEntero,
  formatearMontoDO,
} from "./format";

export type PanelOperativoProps =
  | {
      readonly reporte: "ventas";
      readonly pagina: Pagina<VentasPeriodoFila>;
      readonly seleccion: SeleccionReporte;
    }
  | {
      readonly reporte: "productos";
      readonly pagina: Pagina<ProductoVendidoFila>;
      readonly seleccion: SeleccionReporte;
    }
  | {
      readonly reporte: "inventario";
      readonly pagina: Pagina<InventarioValorizadoFila>;
      readonly seleccion: SeleccionReporte;
    }
  | {
      readonly reporte: "facturas";
      readonly pagina: Pagina<EstadoFacturaCelda>;
      readonly seleccion: SeleccionReporte;
    };

const TH = "py-1 font-medium text-zinc-500 dark:text-zinc-400";
const TH_R = `${TH} text-right`;
const TD = "py-1 text-zinc-900 dark:text-zinc-50";
const TD_R = `${TD} text-right`;
const BOTON =
  "inline-flex items-center rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800";

/** Render the shared panel chrome: title, summary strip, table (children), pagination + export. */
function Marco({
  titulo,
  resumen,
  pagina,
  seleccion,
  children,
}: {
  readonly titulo: string;
  readonly resumen: string;
  readonly pagina: Pagina<unknown>;
  readonly seleccion: SeleccionReporte;
  readonly children: React.ReactNode;
}) {
  const haySiguiente = pagina.page < pagina.totalPages;
  const hayAnterior = pagina.page > 1;
  return (
    <section
      aria-label={titulo}
      className="rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900"
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">{titulo}</h2>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">{resumen}</p>
        </div>
        <Link href={construirHrefExportar(seleccion)} className={BOTON}>
          Exportar CSV
        </Link>
      </div>

      {pagina.filas.length === 0 ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Sin resultados para el filtro seleccionado.
        </p>
      ) : (
        <table className="w-full text-left text-sm">{children}</table>
      )}

      <div className="mt-4 flex items-center gap-3 text-sm">
        {hayAnterior && (
          <Link
            href={construirHref(seleccion, { page: pagina.page - 1 })}
            className={BOTON}
          >
            ← Anterior
          </Link>
        )}
        {haySiguiente && (
          <Link
            href={construirHref(seleccion, { page: pagina.page + 1 })}
            className={BOTON}
          >
            Siguiente →
          </Link>
        )}
        <span className="text-zinc-500 dark:text-zinc-400">
          Página {formatearEntero(pagina.page)} de {formatearEntero(Math.max(1, pagina.totalPages))}{" "}
          · {formatearEntero(pagina.total)} resultados
        </span>
      </div>
    </section>
  );
}

export function PanelOperativo(props: PanelOperativoProps) {
  const { seleccion } = props;

  if (props.reporte === "ventas") {
    const { pagina } = props;
    const totalNeto = pagina.resumen.totalNeto ?? "0.00";
    const ops = pagina.resumen.totalOperaciones ?? "0";
    return (
      <Marco
        titulo="Ventas por período"
        resumen={`Total neto ${formatearMontoDO(totalNeto)} · ${formatearEntero(
          Number(ops),
        )} operaciones confirmadas`}
        pagina={pagina}
        seleccion={seleccion}
      >
        <thead className={TH}>
          <tr>
            <th className={TH}>Fecha (SD)</th>
            <th className={TH_R}>Ventas</th>
            <th className={TH_R}>Monto</th>
          </tr>
        </thead>
        <tbody>
          {pagina.filas.map((f) => (
            <tr key={f.fechaSD} className="border-t border-zinc-100 dark:border-zinc-800">
              <td className={TD}>{f.fechaSD}</td>
              <td className={TD_R}>{formatearEntero(f.operaciones)}</td>
              <td className={TD_R}>{formatearMontoDO(f.neto)}</td>
            </tr>
          ))}
        </tbody>
      </Marco>
    );
  }

  if (props.reporte === "productos") {
    const { pagina } = props;
    return (
      <Marco
        titulo="Productos más / menos vendidos"
        resumen={`Total ${formatearCantidad(pagina.resumen.totalUnidades ?? "0.000")} unidades · ${formatearMontoDO(
          pagina.resumen.totalMonto ?? "0.00",
        )}`}
        pagina={pagina}
        seleccion={seleccion}
      >
        <thead className={TH}>
          <tr>
            <th className={TH}>Producto</th>
            <th className={TH_R}>Unidades</th>
            <th className={TH_R}>Monto</th>
          </tr>
        </thead>
        <tbody>
          {pagina.filas.map((f) => (
            <tr key={f.productoId} className="border-t border-zinc-100 dark:border-zinc-800">
              <td className={TD}>{f.nombre}</td>
              <td className={TD_R}>{formatearCantidad(f.unidades)}</td>
              <td className={TD_R}>{formatearMontoDO(f.monto)}</td>
            </tr>
          ))}
        </tbody>
      </Marco>
    );
  }

  if (props.reporte === "inventario") {
    const { pagina } = props;
    return (
      <Marco
        titulo="Inventario valorizado por sucursal"
        resumen={`Valor ${formatearMontoDO(pagina.resumen.valor ?? "0.00")} · ${formatearCantidad(
          pagina.resumen.unidades ?? "0.000",
        )} unidades · ${pagina.resumen.bajoStock ?? "0"} bajo stock · ${
          pagina.resumen.agotados ?? "0"
        } agotados`}
        pagina={pagina}
        seleccion={seleccion}
      >
        <thead className={TH}>
          <tr>
            <th className={TH}>Sucursal</th>
            <th className={TH}>Producto</th>
            <th className={TH_R}>Cantidad</th>
            <th className={TH_R}>Costo prom.</th>
            <th className={TH_R}>Valor</th>
            <th className={TH_R}>Estado</th>
          </tr>
        </thead>
        <tbody>
          {pagina.filas.map((f) => (
            <tr key={f.inventarioId} className="border-t border-zinc-100 dark:border-zinc-800">
              <td className={TD}>{f.sucursalNombre}</td>
              <td className={TD}>{f.productoNombre}</td>
              <td className={TD_R}>{formatearCantidad(f.cantidad)}</td>
              <td className={TD_R}>{formatearMontoDO(f.costoPromedio)}</td>
              <td className={TD_R}>{formatearMontoDO(f.valor)}</td>
              <td className={TD_R}>{f.estadoStock}</td>
            </tr>
          ))}
        </tbody>
      </Marco>
    );
  }

  // facturas — estado × tipoNcf grid with derived payment state.
  const { pagina } = props;
  return (
    <Marco
      titulo="Estado de facturas"
      resumen={`${pagina.resumen.totalFacturas ?? "0"} facturas · ${formatearMontoDO(
        pagina.resumen.totalMonto ?? "0.00",
      )} · Pendientes ${pagina.resumen.pendientes ?? "0"} · Parciales ${
        pagina.resumen.parciales ?? "0"
      } · Pagadas ${pagina.resumen.pagadas ?? "0"}`}
      pagina={pagina}
      seleccion={seleccion}
    >
      <thead className={TH}>
        <tr>
          <th className={TH}>Estado</th>
          <th className={TH}>Tipo NCF</th>
          <th className={TH_R}>Facturas</th>
          <th className={TH_R}>Monto</th>
          <th className={TH_R}>Pend.</th>
          <th className={TH_R}>Parc.</th>
          <th className={TH_R}>Pag.</th>
        </tr>
      </thead>
      <tbody>
        {pagina.filas.map((c) => (
          <tr
            key={`${c.estado}:${c.tipoNcf}`}
            className="border-t border-zinc-100 dark:border-zinc-800"
          >
            <td className={TD}>{c.estado}</td>
            <td className={TD}>{c.tipoNcf}</td>
            <td className={TD_R}>{formatearEntero(c.facturas)}</td>
            <td className={TD_R}>{formatearMontoDO(c.monto)}</td>
            <td className={TD_R}>{formatearEntero(c.pendientes)}</td>
            <td className={TD_R}>{formatearEntero(c.parciales)}</td>
            <td className={TD_R}>{formatearEntero(c.pagadas)}</td>
          </tr>
        ))}
      </tbody>
    </Marco>
  );
}
