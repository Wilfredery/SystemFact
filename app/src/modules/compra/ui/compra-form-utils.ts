/**
 * Pure helpers of the purchase create/edit dialog (screens plan Step 6,
 * `odd/tasks/compras.md` T3: S1, S2, S5, S6).
 *
 * Kept outside the `"use client"` island so the dialog imports values, not
 * client references, and so the rules below are testable without React.
 *
 * S6 (no float math in the UI): the money/quantity DISPLAY math reuses the
 * purchase DOMAIN's own calculators (`calcularLinea`, `calcularTotales`,
 * `validarLinea` from `domain/calculators`), not a client-side re-implementation.
 * The domain is pure TypeScript over `decimal.js`, so the preview a user sees
 * while typing is computed by exactly the function the server runs when the
 * purchase is saved — the two can never drift, and nothing crosses a JS float.
 *
 * The local validation re-applies the domain's own width/positivity rules
 * (`RE_CANTIDAD`, `RE_COSTO_UNITARIO`) to give a friendly message per field;
 * every other rule stays server-side (the transport/use case answers it with a
 * stable typed error).
 */

import { Decimal } from "decimal.js";
import {
  TIPO_COMPRA,
  TIPO_NCF_COMPRA,
  type CompraLineaCalculada,
  type TipoNcfCompra,
  type TotalesCompra,
} from "../domain/compra";
import {
  RE_CANTIDAD,
  RE_COSTO_UNITARIO,
  calcularLinea,
  calcularTotales,
  validarLinea,
} from "../domain/calculators";
import { formatearFechaSD } from "@/shared/ui/format/date";
import { TIPOS_COMPRA_FILTRO } from "./compras-filtros";

/** The purchase-type options of the form (the list labels, without "todos"). */
export const TIPOS_COMPRA_FORMULARIO: readonly { valor: string; etiqueta: string }[] =
  TIPOS_COMPRA_FILTRO.filter((t) => t.valor !== "");

/** The receipt NCF kind a purchase type is billed with (S1: mercancía → B01). */
export function tipoNcfParaCompra(tipoCompra: string): TipoNcfCompra {
  return tipoCompra === TIPO_COMPRA.MERCANCIA
    ? TIPO_NCF_COMPRA.B01
    : TIPO_NCF_COMPRA.B11;
}

/** Display text of the wireframe's "Formal → B01" / "Informal (B11)" concept. */
export function etiquetaComprobanteCompra(tipoCompra: string): string {
  return tipoNcfParaCompra(tipoCompra) === TIPO_NCF_COMPRA.B01
    ? "B01 — Formal"
    : "B11 — Informal";
}

/**
 * Display of a purchase `fecha`. The date is a BUSINESS CALENDAR DAY frozen at
 * UTC midnight when the purchase is created (`2026-01-10T00:00:00.000Z`), so it
 * renders as that UTC day through the shared formatter's safe bare-date path —
 * reading the instant in `America/Santo_Domingo` would show the previous day
 * (midnight UTC is 20:00 of the prior SD day).
 */
export function formatearFechaCompra(iso: string): string {
  return formatearFechaSD(iso.slice(0, 10));
}

/** The one error banner style of the purchase screens (single definition). */
export const CLASE_ALERTA_COMPRA =
  "rounded-md bg-red-50 px-4 py-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-200";

/** The subset of a product the line editor needs (all from a read action). */
export interface ProductoCompraOpcion {
  readonly id: number;
  readonly codigo: string;
  readonly nombre: string;
  readonly unidadMedida: string;
  readonly tasaItbis: string;
}

/** One editable line: quantities/costs stay STRINGS until the action is called. */
export interface LineaCompraFormulario {
  readonly clave: string;
  readonly producto: ProductoCompraOpcion | null;
  readonly cantidad: string;
  readonly costoUnitario: string;
}

/** A fresh line: quantity 1, no cost yet, no product chosen. */
export function lineaCompraVacia(clave: string): LineaCompraFormulario {
  return { clave, producto: null, cantidad: "1", costoUnitario: "" };
}

/**
 * The purchase detail the edit dialog prefills from (`obtenerCompraAction`).
 * Declared structurally so the screen hands over its action payload as-is.
 */
export interface CompraDetalleEditable {
  readonly id: number;
  readonly correlativoInterno: string;
  readonly estado: string;
  readonly tipoCompra: string;
  readonly fecha: string;
  readonly proveedor: { readonly id: number; readonly nombre: string };
  readonly lineas: readonly {
    readonly productoId: number;
    readonly productoNombre: string;
    readonly cantidad: string;
    readonly costoUnitario: string;
    readonly tasaItbis: string;
    readonly itbisLinea: string;
    readonly subtotalLinea: string;
  }[];
}

export const MENSAJE_PROVEEDOR_REQUERIDO = "Debe seleccionar un proveedor.";
export const MENSAJE_FECHA_REQUERIDA = "Debe indicar la fecha de la compra.";
export const MENSAJE_LINEA_REQUERIDA = "Debe agregar al menos una línea con producto.";
export const MENSAJE_CANTIDAD_INVALIDA =
  "La cantidad debe ser un número mayor que cero (hasta 3 decimales).";
export const MENSAJE_COSTO_INVALIDO =
  "El costo unitario debe ser un número mayor o igual a cero (hasta 2 decimales).";

/** `null` when the form may be submitted, otherwise the first local message. */
export function validarFormularioCompra(input: {
  readonly proveedorId: number | null;
  readonly fecha: string;
  readonly lineas: readonly LineaCompraFormulario[];
}): string | null {
  if (input.proveedorId === null) return MENSAJE_PROVEEDOR_REQUERIDO;
  if (input.fecha.trim() === "") return MENSAJE_FECHA_REQUERIDA;
  if (input.lineas.length === 0) return MENSAJE_LINEA_REQUERIDA;
  for (const linea of input.lineas) {
    if (linea.producto === null) return MENSAJE_LINEA_REQUERIDA;
    const cantidad = linea.cantidad.trim();
    if (
      !RE_CANTIDAD.test(cantidad) ||
      new Decimal(cantidad).lessThanOrEqualTo(0)
    ) {
      return MENSAJE_CANTIDAD_INVALIDA;
    }
    const costo = linea.costoUnitario.trim();
    if (!RE_COSTO_UNITARIO.test(costo) || new Decimal(costo).lessThan(0)) {
      return MENSAJE_COSTO_INVALIDO;
    }
  }
  return null;
}

/**
 * The payload the actions receive: decimal STRINGS, nothing else (S6). The
 * no-product case is narrowed HERE rather than asserted, so a future caller
 * cannot hand the transport a line without a product; the dialog already
 * refused that shape through {@link validarFormularioCompra}.
 */
export function lineasParaAccion(
  lineas: readonly LineaCompraFormulario[],
): { productoId: number; cantidad: string; costoUnitario: string }[] {
  return lineas.map((linea) => {
    const producto = linea.producto;
    if (producto === null) {
      throw new Error("Una línea sin producto no puede enviarse: valide el formulario antes.");
    }
    return {
      productoId: producto.id,
      cantidad: linea.cantidad.trim(),
      costoUnitario: linea.costoUnitario.trim(),
    };
  });
}

export interface VistaPreviaCompra {
  /** Per-line frozen amounts, keyed by the form line's `clave`. */
  readonly porClave: ReadonlyMap<string, CompraLineaCalculada>;
  readonly totales: TotalesCompra;
}

/**
 * Display-only fiscal preview, computed by the DOMAIN's calculators over the
 * lines that are already valid, so a half-typed line simply does not contribute
 * (it never throws and never injects a zero-cost line into the totals).
 */
export function vistaPreviaCompra(
  lineas: readonly LineaCompraFormulario[],
): VistaPreviaCompra {
  const calculadas: CompraLineaCalculada[] = [];
  const porClave = new Map<string, CompraLineaCalculada>();

  for (const linea of lineas) {
    if (linea.producto === null) continue;
    const input = {
      productoId: linea.producto.id,
      cantidad: linea.cantidad.trim(),
      costoUnitario: linea.costoUnitario.trim(),
    };
    if (validarLinea(input, linea.producto.tasaItbis) !== null) continue;
    const calculada = calcularLinea(input, linea.producto.tasaItbis);
    calculadas.push(calculada);
    porClave.set(linea.clave, calculada);
  }

  return { porClave, totales: calcularTotales(calculadas) };
}
