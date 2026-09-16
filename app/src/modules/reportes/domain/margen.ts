/**
 * Reportes domain — product-profitability (rentabilidad) metric math (REN-1, slice D).
 *
 * ADR-013: PURE TypeScript — imports nothing from Next.js, React, Prisma or Supabase. It owns
 * ONLY the Decimal arithmetic the rentabilidad report pins in REN-1, so the fiscal margin math is
 * unit-testable with no database (design "Domain … margin/aging/comparison Decimal math"; AGENTS.md
 * "All fiscal math lives here as testable functions"). EVERY money figure is a `Decimal(12,2)`
 * STRING and every quantity a `Decimal(12,3)` STRING — never a JS number (AGENTS.md "Money =
 * Decimal"). The repository hands this layer the already-SQL-aggregated per-product raw sums
 * (Σ quantities, Σ(qty × price), Σ(qty × cost) — never raw line items), so reducing/paging these
 * grouped rows is aggregation pushdown, not a fetch-then-sum (OP-5).
 *
 * Pinned formulas (REN-1 — the contract is the FORMULAS; the spec's illustrative margin figure is
 * reconciled in {@link calcularMargen}):
 *   - precio costo  = `Producto.costoPromedio` (the CURRENT average cost — see the limitation);
 *   - precio salida = cantidad-weighted mean of `DetalleVenta.precioUnitario`
 *                   = Σ(cantidad × precioUnitario) ÷ Σcantidad sold   (0 sold → `0.00`);
 *   - Inversión     = Σ(cantidad × costoUnitario) over received purchases;
 *   - Entrada       = Σ quantities purchased;   Salida = Σ quantities sold;
 *   - Capital       = current stock × costoPromedio;
 *   - Margen        = Ventas − (Salida × costoPromedio),  Ventas = Σ(cantidad × precioUnitario);
 *   - Margen %      = Margen ÷ Ventas × 100   (zero sales → `0.00`, never a division by zero).
 *
 * REN-3 COST-BASIS LIMITATION: `DetalleVenta` stores no per-line cost snapshot, so these margins
 * are computed from the CURRENT `costoPromedio` and are NOT reproducible historical figures. The
 * disclaimer is a single frozen constant ({@link NOTA_LIMITACION_RENTABILIDAD}) so the on-screen
 * panel and every exported CSV render the SAME wording (no drift) — REN-3.
 */

import { Decimal } from "decimal.js";

/**
 * The frozen cost-basis limitation text (REN-3). ONE source shared by the UI panel and the CSV
 * footer so a consumer can never mistake the figures for frozen history and the two surfaces can
 * never word it differently. A guard test asserts this exact string appears in BOTH renders.
 */
export const NOTA_LIMITACION_RENTABILIDAD =
  "Limitación: los márgenes usan el costo promedio ACTUAL del producto. DetalleVenta no guarda un " +
  "costo por línea, por lo que estas cifras no son históricas y cambian cuando se registran nuevas compras.";

/** One rounded money value (2 dp) as a fixed string — the `Decimal(12,2)` display/serialisation scale. */
function dinero(d: Decimal): string {
  return d.toDecimalPlaces(2).toFixed(2);
}

/** One rounded quantity value (3 dp) as a fixed string — the `Decimal(12,3)` display/serialisation scale. */
function cantidad(d: Decimal): string {
  return d.toDecimalPlaces(3).toFixed(3);
}

/**
 * The cantidad-weighted output price (REN-1): Σ(cantidad × precioUnitario) ÷ Σcantidad sold. A
 * zero-sold product has no realized output price → `0.00` (never a NaN/÷0). The sales amount is
 * the numerator so the price and the margen share ONE definition of "ventas".
 */
export function calcularPrecioSalida(params: {
  readonly ventasBrutas: string;
  readonly unidadesVendidas: string;
}): string {
  const ventas = new Decimal(params.ventasBrutas);
  const unidades = new Decimal(params.unidadesVendidas);
  if (unidades.isZero()) return "0.00";
  return dinero(ventas.div(unidades));
}

/**
 * The gross margin (REN-1): `Ventas − Salida × costoPromedio`, where `Ventas = Σ(cantidad ×
 * precioUnitario)` sold. `costoPromedio` is the CURRENT average cost (the REN-3 limitation — there
 * is no per-line historical cost). All `Decimal(12,2)`; the result may be negative (a loss).
 */
export function calcularMargen(params: {
  readonly ventasBrutas: string;
  readonly unidadesVendidas: string;
  readonly costoPromedio: string;
}): string {
  const ventas = new Decimal(params.ventasBrutas);
  const salida = new Decimal(params.unidadesVendidas);
  const costo = new Decimal(params.costoPromedio);
  return dinero(ventas.minus(salida.times(costo)));
}

/**
 * The margin as a percentage of sales (REN-1 "margen % of ventas"): `Margen ÷ Ventas × 100`.
 * A zero-sales product has no percentage → exactly `0.00` (no division by zero). 2 dp, `Decimal`.
 */
export function calcularMargenPorciento(params: {
  readonly margen: string;
  readonly ventasBrutas: string;
}): string {
  const margen = new Decimal(params.margen);
  const ventas = new Decimal(params.ventasBrutas);
  if (ventas.isZero()) return "0.00";
  return dinero(margen.div(ventas).times(100));
}

/**
 * The capital tied in stock (REN-1): current stock × `costoPromedio`. The stock is the branch/
 * company-scoped current `Inventario.cantidad` already summed by the repository; the cost basis is
 * the CURRENT average (REN-3 limitation), all `Decimal(12,2)`.
 */
export function calcularCapital(params: {
  readonly stockActual: string;
  readonly costoPromedio: string;
}): string {
  const stock = new Decimal(params.stockActual);
  const costo = new Decimal(params.costoPromedio);
  return dinero(stock.times(costo));
}

/**
 * A single product's raw, SQL-aggregated profitability inputs (REN-1, REN-2). These are the per-
 * product GROUP BY outputs — never raw line items — crossing the SQL boundary as Decimal text:
 * money `numeric(12,2)`, quantities `numeric(12,3)`.
 */
export interface RentabilidadInsumo {
  readonly productoId: number;
  readonly nombre: string;
  /** `Producto.costoPromedio` — the CURRENT average cost, `Decimal(12,2)` string. */
  readonly costoPromedio: string;
  /** Σ quantity sold over CONFIRMADA sales in the filter (Salida), `Decimal(12,3)` string. */
  readonly unidadesVendidas: string;
  /** Σ (cantidad × precioUnitario) sold in the filter — the Ventas basis, `Decimal(12,2)` string. */
  readonly ventasBrutas: string;
  /** Σ quantity purchased over received compras in the filter (Entrada), `Decimal(12,3)` string. */
  readonly unidadesCompradas: string;
  /** Σ (cantidad × costoUnitario) over received compras (Inversión), `Decimal(12,2)` string. */
  readonly inversion: string;
  /** Current stock in the (branch) scope, `Decimal(12,3)` string. */
  readonly stockActual: string;
}

/** A fully-computed rentabilidad row (REN-1) — every figure a Decimal string, ready for screen + CSV. */
export interface RentabilidadFila {
  readonly productoId: number;
  readonly nombre: string;
  /** precio costo = current `costoPromedio`, `Decimal(12,2)` string. */
  readonly precioCosto: string;
  /** precio salida = cantidad-weighted mean of unit prices, `Decimal(12,2)` string. */
  readonly precioSalida: string;
  /** Salida — Σ units sold, `Decimal(12,3)` string. */
  readonly unidadesVendidas: string;
  /** Entrada — Σ units purchased, `Decimal(12,3)` string. */
  readonly unidadesCompradas: string;
  /** Ventas basis (Σ qty × price sold), `Decimal(12,2)` string. */
  readonly ventas: string;
  /** Inversión = Σ(purchase qty × costoUnitario), `Decimal(12,2)` string. */
  readonly inversion: string;
  /** Capital = current stock × costoPromedio, `Decimal(12,2)` string. */
  readonly capital: string;
  /** Margen = Ventas − (Salida × costoPromedio), `Decimal(12,2)` string. */
  readonly margen: string;
  /** Margen % of Ventas (`0.00` when Ventas = 0), `Decimal(12,2)` string. */
  readonly margenPorciento: string;
}

/**
 * Compute one product's full rentabilidad row from its raw aggregated inputs (REN-1). Pure Decimal
 * throughout; quantities are re-emitted at the `Decimal(12,3)` scale and money at `Decimal(12,2)`
 * so the screen and the CSV print byte-identical figures (EXP-2 display parity).
 */
export function calcularFilaRentabilidad(insumo: RentabilidadInsumo): RentabilidadFila {
  const precioSalida = calcularPrecioSalida({
    ventasBrutas: insumo.ventasBrutas,
    unidadesVendidas: insumo.unidadesVendidas,
  });
  const margen = calcularMargen({
    ventasBrutas: insumo.ventasBrutas,
    unidadesVendidas: insumo.unidadesVendidas,
    costoPromedio: insumo.costoPromedio,
  });
  const margenPorciento = calcularMargenPorciento({
    margen,
    ventasBrutas: insumo.ventasBrutas,
  });
  const capital = calcularCapital({
    stockActual: insumo.stockActual,
    costoPromedio: insumo.costoPromedio,
  });
  return {
    productoId: insumo.productoId,
    nombre: insumo.nombre,
    precioCosto: dinero(new Decimal(insumo.costoPromedio)),
    precioSalida,
    unidadesVendidas: cantidad(new Decimal(insumo.unidadesVendidas)),
    unidadesCompradas: cantidad(new Decimal(insumo.unidadesCompradas)),
    ventas: dinero(new Decimal(insumo.ventasBrutas)),
    inversion: dinero(new Decimal(insumo.inversion)),
    capital,
    margen,
    margenPorciento,
  };
}

/** The report-level Decimal-string totals reduced across the FULL filtered row set (EXP-2 parity). */
export interface RentabilidadResumen {
  readonly unidadesVendidas: string;
  readonly unidadesCompradas: string;
  readonly ventas: string;
  readonly inversion: string;
  readonly capital: string;
  readonly margen: string;
  /** Aggregate margen % of aggregate Ventas (`0.00` when Ventas = 0). */
  readonly margenPorciento: string;
  /** The count of products with sales-or-purchase activity in the filter. */
  readonly productos: string;
}

/**
 * Reduce the computed rows into the report summary — Σ over ALREADY-aggregated per-product rows
 * (the same grouped result the grid shows), never a re-scan of raw line items (OP-5). The page
 * passed here is the FULL filtered dataset (the CSV and the screen summary share it), so the totals
 * are page-independent (EXP-2).
 */
export function resumirRentabilidad(
  filas: readonly RentabilidadFila[],
): RentabilidadResumen {
  let unidadesVendidas = new Decimal(0);
  let unidadesCompradas = new Decimal(0);
  let ventas = new Decimal(0);
  let inversion = new Decimal(0);
  let capital = new Decimal(0);
  let margen = new Decimal(0);
  for (const f of filas) {
    unidadesVendidas = unidadesVendidas.plus(new Decimal(f.unidadesVendidas));
    unidadesCompradas = unidadesCompradas.plus(new Decimal(f.unidadesCompradas));
    ventas = ventas.plus(new Decimal(f.ventas));
    inversion = inversion.plus(new Decimal(f.inversion));
    capital = capital.plus(new Decimal(f.capital));
    margen = margen.plus(new Decimal(f.margen));
  }
  return {
    unidadesVendidas: cantidad(unidadesVendidas),
    unidadesCompradas: cantidad(unidadesCompradas),
    ventas: dinero(ventas),
    inversion: dinero(inversion),
    capital: dinero(capital),
    margen: dinero(margen),
    margenPorciento: calcularMargenPorciento({
      margen: margen.toFixed(2),
      ventasBrutas: ventas.toFixed(2),
    }),
    productos: String(filas.length),
  };
}
