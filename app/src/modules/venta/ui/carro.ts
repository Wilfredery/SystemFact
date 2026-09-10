/**
 * Pure client-side cart model for the POS screen (PR-3, spec R-V14).
 *
 * No React, no DOM, no network: just the ephemeral cart shape, its immutable
 * transitions, and the LIVE PREVIEW of fiscal totals computed with the SAME
 * pure domain calculators the server uses (design decision "UI totals": the
 * client previews with `calcularLineaVenta`/`calcularTotalesVenta`; the save
 * actions always recompute authoritatively server-side). Money stays
 * `Decimal`-compatible strings end to end — no floats.
 */

import { Decimal } from "decimal.js";
import {
  DESCUENTO_CERO,
  type Descuento,
  type VentaLineaCalculada,
  type VentaLineaInput,
} from "../domain/venta";
import {
  calcularLineaVenta,
  calcularTotalesVenta,
  validarLineaVenta,
} from "../domain/calculators";
import type { VentaTotalesCalculo } from "../domain/calculators";

/** A product option as returned by `listarProductosAction`. */
export interface ProductoOpcion {
  readonly id: number;
  readonly codigo: string;
  readonly nombre: string;
  /** ITBIS-exclusive net unit price, `Decimal(12,2)` string. */
  readonly precioVenta: string;
  /** Frozen rate as the product's current ITBIS configuration ("18"|"16"|"0"). */
  readonly tasaItbis: string;
}

/** One ephemeral cart line (never persisted until a save round-trip). */
export interface CarroLinea {
  readonly productoId: number;
  readonly codigo: string;
  readonly nombre: string;
  /** Editable `Decimal(12,3)` string. */
  readonly cantidad: string;
  /** Editable ITBIS-exclusive `Decimal(12,2)` string. */
  readonly precioUnitario: string;
  /** Product's ITBIS rate carried from search for the live preview. */
  readonly tasaItbis: string;
}

/** The client's selection; `id === null` means Consumidor Final (contado). */
export interface SeleccionCliente {
  readonly id: number | null;
  readonly nombre: string;
}

/** Label for the default contado selection (the resolver maps `null` → CF). */
export const CONSUMIDOR_FINAL_LABEL = "Consumidor Final";

/** Add-or-increment: re-adding an existing product increases its quantity. */
export function agregarAlCarrito(
  carro: readonly CarroLinea[],
  producto: ProductoOpcion,
): CarroLinea[] {
  const existente = carro.find((l) => l.productoId === producto.id);
  if (existente !== undefined) {
    const siguiente = sumarUnaUnidad(existente.cantidad);
    return carro.map((l) =>
      l.productoId === producto.id ? { ...l, cantidad: siguiente } : l,
    );
  }
  return [
    ...carro,
    {
      productoId: producto.id,
      codigo: producto.codigo,
      nombre: producto.nombre,
      cantidad: "1",
      precioUnitario: producto.precioVenta,
      tasaItbis: producto.tasaItbis,
    },
  ];
}

/**
 * Add one whole unit to a base-unit quantity as a pure decimal-string operation
 * (no float ever touches a `Decimal(12,3)` quantity — AGENTS.md "Money/quantity
 * = Decimal"). Falls back to `"1"` for an unparseable mid-edit value.
 */
function sumarUnaUnidad(cantidad: string): string {
  if (!/^\d{1,9}(\.\d{1,3})?$/.test(cantidad)) return "1";
  const resultado = new Decimal(cantidad).plus(1);
  // Trim to at most 3 decimals (the column precision) and drop trailing zeros
  // so a whole count reads "3" not "3.000".
  return resultado.toDecimalPlaces(3).toString();
}

export function quitarDelCarrito(
  carro: readonly CarroLinea[],
  productoId: number,
): CarroLinea[] {
  return carro.filter((l) => l.productoId !== productoId);
}

/** Field-limited edit used by the cart inputs; invalid values are kept verbatim */
export function editarLinea(
  carro: readonly CarroLinea[],
  productoId: number,
  campo: "cantidad" | "precioUnitario",
  valor: string,
): CarroLinea[] {
  return carro.map((l) => (l.productoId === productoId ? { ...l, [campo]: valor } : l));
}

/** True when the line still parses as a computable draft line (preview-safe). */
export function lineaComputable(linea: CarroLinea): boolean {
  const input: VentaLineaInput = {
    productoId: linea.productoId,
    cantidad: linea.cantidad,
    precioUnitario: linea.precioUnitario,
    descuento: DESCUENTO_CERO,
  };
  return validarLineaVenta(input, linea.tasaItbis) === null;
}

/** A line's contribution to the preview (its pre-proration calculation). */
export interface LineaPreview {
  readonly linea: CarroLinea;
  readonly computable: boolean;
  readonly calculo: VentaLineaCalculada | null;
}

export interface VistaPrevia {
  readonly porLinea: readonly LineaPreview[];
  readonly totales: VentaTotalesCalculo["totales"];
}

/**
 * Responsive fiscal preview over the current cart. Lines whose quantity or
 * price the user is mid-edit on (invalid shapes) are flagged and excluded from
 * the running totals; the server recomputes everything on save regardless.
 */
export function calcularVistaPrevia(
  carro: readonly CarroLinea[],
  descuentoCabecera: Descuento,
): VistaPrevia {
  const porLinea: LineaPreview[] = carro.map((linea) => {
    if (!lineaComputable(linea)) return { linea, computable: false, calculo: null };
    const calculo = calcularLineaVenta(
      {
        productoId: linea.productoId,
        cantidad: linea.cantidad,
        precioUnitario: linea.precioUnitario,
        descuento: DESCUENTO_CERO,
      },
      linea.tasaItbis,
    );
    return { linea, computable: true, calculo };
  });

  const computables = porLinea
    .filter((p) => p.calculo !== null)
    .map((p) => p.calculo as VentaLineaCalculada);

  return {
    porLinea,
    totales: calcularTotalesVenta(computables, descuentoCabecera).totales,
  };
}

const MONTO_RE = /^(\d+)(\.(\d{1,2}))?$/;

/** Presentation-only grouping of a fixed-point string: `1234.5` → `1,234.50`. */
export function formatearMonto(valor: string): string {
  const m = MONTO_RE.exec(valor.trim());
  if (m === null) return valor;
  const entero = m[1].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const dec = (m[3] ?? "").padEnd(2, "0");
  return dec === "00" && !valor.includes(".") ? `${entero}.00` : `${entero}.${dec}`;
}
