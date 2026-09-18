/**
 * Shared application helper: validate + compute sale draft lines (PR-2).
 *
 * One source of truth for the pre-write pipeline used by BOTH `crearVenta` and
 * `actualizarVenta`, so the two paths can never drift. It enforces, in order:
 *   1. non-empty line set (`LINEAS_VACIAS`);
 *   2. per line: the product exists and is active for this TENANT
 *      (`PRODUCTO_NO_ENCONTRADO` / `PRODUCTO_INACTIVO`), the line shape is valid
 *      (`LINEA_INVALIDA`), and the product's ITBIS rate validity window covers the
 *      sale date (`TASA_ITBIS_VIGENCIA_FALTA`, naming the product) — zero writes;
 *   3. when ANY positive discount is present: a server-side Administrador role
 *      check (`DESCUENTO_NO_AUTORIZADO`), the hard-fail `DESC_MAX` config read
 *      (`DESC_MAX_FALTANTE`), then the pure triple-cap rule
 *      (`DESCUENTO_EXCEDE_MAXIMO` / `DESCUENTO_EXCEDE_BASE` / `DESCUENTO_INVALIDO`);
 *   4. the frozen per-line + header computation (R-V5 / R-V6);
 *   5. branch stock shortages collected as non-blocking warnings (R-V9).
 *
 * It performs NO database write — only reads. On success it returns the
 * persistence-ready lines, the header totals, the returned gravado/exento split
 * (never stored) and the warnings, all Decimal-compatible strings.
 */

import { Decimal } from "decimal.js";
import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import {
  LINEA_INVALIDA,
  LINEAS_VACIAS,
  PRODUCTO_INACTIVO,
  PRODUCTO_NO_ENCONTRADO,
  TASA_ITBIS_VIGENCIA_FALTA,
  DESCUENTO_NO_AUTORIZADO,
  type StockWarning,
  type VentaErrorCode,
} from "../domain/errors";
import {
  esDescuentoCero,
  type Descuento,
  type VentaLineaInput,
} from "../domain/venta";
import {
  calcularLineaVenta,
  calcularTotalesVenta,
  validarLineaVenta,
} from "../domain/calculators";
import {
  normalizarDescuento,
  validarDescuentosContraMaximo,
  type DescuentoLineaCap,
} from "../domain/descuentos";
import { DESC_MAX_FALTANTE, leerConfigVentaEnTx, VentaConfigError } from "../infrastructure/config-repository";
import {
  leerProductosParaLineasVentaEnTx,
  leerStockSucursalEnTx,
  tieneRolPermitidoEnTx,
  type ProductoParaLineaVenta,
  type StockSucursal,
  type VentaLineaPersistir,
  type VentaTotalesWrite,
} from "../infrastructure/venta-repository";
import {
  ventaGuardadoError,
  type VentaGuardadoErrorCode,
} from "./venta-guardado";

/** Input to the shared draft-line preparation. */
export interface PrepararLineasVentaInput {
  readonly lineas: readonly VentaLineaInput[];
  /** Header-level discount; normalize absent → canonical PORCENTAJE/0.00. */
  readonly descuentoCabecera: Descuento;
  /** The sale date: drives the ITBIS validity window and DESC_MAX window. */
  readonly fecha: Date;
}

/** Successful preparation, ready to persist. */
export interface LineasPreparadasVenta {
  readonly lineas: readonly VentaLineaPersistir[];
  readonly totales: VentaTotalesWrite;
  /** Σ final gravado bases — returned, never stored (spec R-V6). */
  readonly subtotalGravado: string;
  /** Σ final exento bases — returned, never stored (spec R-V6). */
  readonly subtotalExento: string;
  readonly total: string;
  readonly warnings: readonly StockWarning[];
}

export type PrepararLineasVentaResultado =
  | { readonly ok: true; readonly data: LineasPreparadasVenta }
  | { readonly ok: false; readonly code: VentaGuardadoErrorCode; readonly message: string };

/** Roles that may apply a discount server-side (R-V8): Administrador only. */
const ROL_ADMINISTRADOR = "Administrador";

/** True when a submitted discount carries a non-zero effect after normalization. */
function esDescuentoPositivo(d: Descuento): boolean {
  return !esDescuentoCero(normalizarDescuento(d));
}

/**
 * Rate-validity check for the frozen ITBIS window (R-V2). Instant comparison
 * against the sale date, parity with the retention reader (see the config
 * repository note on why no tz dependency is introduced). `vigenteHasta` null =
 * open-ended.
 */
function tasaVigenteEn(producto: ProductoParaLineaVenta, fecha: Date): boolean {
  const desde = producto.itbisVigenteDesde.getTime();
  const hasta =
    producto.itbisVigenteHasta === null ? Infinity : producto.itbisVigenteHasta.getTime();
  const f = fecha.getTime();
  return desde <= f && f <= hasta;
}

/**
 * Pure per-line preconditions (pipeline step 2). Every line's product must be
 * present for this tenant and active, its shape valid, and its ITBIS rate window
 * cover the sale date. Returns the first stable error code, or `null` when all
 * lines pass. No DB access — the caller has already batch-read the products.
 */
function validarPrecondicionesLineas(
  lineas: readonly VentaLineaInput[],
  productosById: ReadonlyMap<number, ProductoParaLineaVenta>,
  fecha: Date,
): VentaErrorCode | null {
  for (const linea of lineas) {
    const producto = productosById.get(linea.productoId);
    if (producto === undefined) return PRODUCTO_NO_ENCONTRADO;
    if (!producto.activo) return PRODUCTO_INACTIVO;
    if (validarLineaVenta(linea, producto.tasaItbis) !== null) {
      return LINEA_INVALIDA;
    }
    if (!tasaVigenteEn(producto, fecha)) return TASA_ITBIS_VIGENCIA_FALTA;
  }
  return null;
}

/** Typed result of the discount authorization + cap pipeline (step 3). */
type DescuentosResultado =
  | { readonly ok: true; readonly actor: number | null }
  | {
      readonly ok: false;
      readonly code: VentaGuardadoErrorCode;
      readonly message: string;
    };

/**
 * Pipeline step 3: when ANY positive discount is present, enforce the
 * server-side Administrador role (UI hiding is NOT the control, R-V8), hard-fail
 * the `DESC_MAX` config read, then run the pure triple-cap rule on the gross
 * bases. Resolves to the acting admin id (the discount authorizer) or a typed
 * error from the existing stable catalogs. It only performs reads.
 */
async function validarDescuentosAutorizadosYTopes(
  tx: PrismaTx,
  ctx: TenantCtx,
  lineas: readonly VentaLineaInput[],
  headerDescuento: Descuento,
  productosById: ReadonlyMap<number, ProductoParaLineaVenta>,
  fecha: Date,
): Promise<DescuentosResultado> {
  const hayDescuento =
    esDescuentoPositivo(headerDescuento) ||
    lineas.some((l) => esDescuentoPositivo(l.descuento));
  if (!hayDescuento) return { ok: true, actor: null };

  // 3a. Server-side Administrador check (UI hiding is NOT the control).
  const esAdmin = await tieneRolPermitidoEnTx(tx, ctx.usuarioId, ctx.empresaId, [
    ROL_ADMINISTRADOR,
  ]);
  if (!esAdmin) return ventaGuardadoError(DESCUENTO_NO_AUTORIZADO);
  const actor = ctx.usuarioId;

  // 3b. Hard-fail DESC_MAX read (missing/expired → config error, zero writes).
  let descMax: string;
  try {
    descMax = await leerConfigVentaEnTx(tx, ctx.empresaId, fecha);
  } catch (err) {
    if (err instanceof VentaConfigError) {
      // This reader only ever throws DESC_MAX_FALTANTE (task 1.7 added the
      // PLAZO_DEVOLUCION_FALTANTE code, but that reader lives in devolucion).
      return ventaGuardadoError(err.code as typeof DESC_MAX_FALTANTE);
    }
    throw err;
  }

  // 3c. Pure triple-cap + shape/base validation on the gross bases.
  const capInput: DescuentoLineaCap[] = lineas.map((l) => ({
    subtotalBruto: calcularLineaVenta(
      l,
      productosById.get(l.productoId)!.tasaItbis,
    ).subtotalBruto,
    descuento: normalizarDescuento(l.descuento),
  }));
  const cap = validarDescuentosContraMaximo({
    lineas: capInput,
    descuentoCabecera: headerDescuento,
    descMax,
  });
  if (!cap.ok) return ventaGuardadoError(cap.code as VentaErrorCode);
  return { ok: true, actor };
}

/** The per-line computation shape produced by the frozen calculator. */
type LineaCalculadaVenta = ReturnType<typeof calcularLineaVenta>;
/** The post-header-proration line shape produced by the totals calculator. */
type LineaFinalVenta = ReturnType<typeof calcularTotalesVenta>["lineas"][number];

/**
 * Pure pipeline step 4: turn the frozen per-line computations and the
 * post-proration finals into the persistence-ready lines. The discount authorizer
 * is recorded on a line ONLY when that line itself carries a discount.
 */
function construirLineasPersistibles(
  lineas: readonly VentaLineaInput[],
  calculadas: readonly LineaCalculadaVenta[],
  finales: readonly LineaFinalVenta[],
  actorDescuento: number | null,
): VentaLineaPersistir[] {
  return calculadas.map((c, i) => {
    const f = finales[i];
    // Authorizer is recorded per line only when THAT line carries a discount.
    const autorizadoPor = esDescuentoPositivo(lineas[i].descuento)
      ? actorDescuento
      : null;
    return {
      productoId: c.productoId,
      cantidad: c.cantidad,
      precioUnitario: c.precioUnitario,
      descuentoLinea: c.descuentoLinea,
      descuentoTipo: c.descuentoTipo,
      descuentoAutorizadoPor: autorizadoPor,
      tasaItbis: c.tasaItbis,
      itbisLinea: f.itbisLinea,
      subtotalLinea: f.baseFinal,
    };
  });
}

/**
 * Pure pipeline step 5: collect non-blocking branch stock shortages (R-V9). A
 * line whose requested quantity exceeds branch availability yields a
 * `STOCK_INSUFICIENTE` warning; a product with no stock row defaults to
 * `"0.000"`. Shortages never block a draft save.
 */
function colectarWarningsStock(
  lineas: readonly VentaLineaPersistir[],
  stocks: readonly StockSucursal[],
): StockWarning[] {
  const stockByProduct = new Map(
    stocks.map((s) => [s.productoId, s.disponible]),
  );
  const warnings: StockWarning[] = [];
  for (const l of lineas) {
    const disponible = stockByProduct.get(l.productoId) ?? "0.000";
    if (new Decimal(l.cantidad).greaterThan(new Decimal(disponible))) {
      warnings.push({
        code: "STOCK_INSUFICIENTE",
        productoId: l.productoId,
        available: disponible,
        requested: l.cantidad,
      });
    }
  }
  return warnings;
}

/**
 * Validate, cap-check, compute and collect stock warnings for a draft's lines.
 * Returns a typed error (never throws for business reasons; the config hard-fail
 * is caught in the discount helper) so both save use cases share one pipeline.
 * A thin, linear orchestrator over the pure/async helpers above — the stage
 * order (validate → discount → compute → stock) is preserved unchanged.
 */
export async function prepararLineasVenta(
  tx: PrismaTx,
  ctx: TenantCtx,
  input: PrepararLineasVentaInput,
): Promise<PrepararLineasVentaResultado> {
  const { lineas, fecha } = input;

  // 1. At least one line.
  if (lineas.length === 0) {
    return ventaGuardadoError(LINEAS_VACIAS);
  }

  const headerDescuento = normalizarDescuento(input.descuentoCabecera);

  // 2. Batch product read (empresa-scoped), then pure per-line preconditions.
  const productos = await leerProductosParaLineasVentaEnTx(
    tx,
    ctx.empresaId,
    lineas.map((l) => l.productoId),
  );
  const productosById = new Map(productos.map((p) => [p.id, p]));

  const precond = validarPrecondicionesLineas(lineas, productosById, fecha);
  if (precond !== null) {
    return ventaGuardadoError(precond);
  }

  // 3. Discount pipeline — role, config, cap. No-op when no discount is present.
  const descuentos = await validarDescuentosAutorizadosYTopes(
    tx,
    ctx,
    lineas,
    headerDescuento,
    productosById,
    fecha,
  );
  if (!descuentos.ok) {
    return descuentos;
  }
  const actorDescuento = descuentos.actor;

  // 4. Frozen computation (R-V5 + R-V6 proration) and persistence-ready lines.
  const calculadas = lineas.map((l) =>
    calcularLineaVenta(l, productosById.get(l.productoId)!.tasaItbis),
  );
  const { lineas: finales, totales } = calcularTotalesVenta(
    calculadas,
    headerDescuento,
  );
  const persistir = construirLineasPersistibles(
    lineas,
    calculadas,
    finales,
    actorDescuento,
  );

  const totalesWrite: VentaTotalesWrite = {
    subtotal: totales.subtotal,
    descuento: totales.descuento,
    descuentoTipo: headerDescuento.descuentoTipo,
    descuentoAutorizadoPor: esDescuentoPositivo(headerDescuento)
      ? actorDescuento
      : null,
    itbis: totales.itbis,
    total: totales.total,
  };

  // 5. Branch stock shortages — non-blocking warnings only (R-V9).
  const stocks = await leerStockSucursalEnTx(
    tx,
    ctx.sucursalId,
    persistir.map((l) => l.productoId),
  );
  const warnings = colectarWarningsStock(persistir, stocks);

  return {
    ok: true,
    data: {
      lineas: persistir,
      totales: totalesWrite,
      subtotalGravado: totales.subtotalGravado,
      subtotalExento: totales.subtotalExento,
      total: totales.total,
      warnings,
    },
  };
}
