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
import { leerConfigVentaEnTx, VentaConfigError } from "../infrastructure/config-repository";
import {
  leerProductosParaLineasVentaEnTx,
  leerStockSucursalEnTx,
  tieneRolPermitidoEnTx,
  type ProductoParaLineaVenta,
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
 * Validate, cap-check, compute and collect stock warnings for a draft's lines.
 * Returns a typed error (never throws for business reasons; the config hard-fail
 * is caught here) so both save use cases share one pipeline.
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

  // 2. Batch product read (empresa-scoped), then per-line preconditions.
  const productos = await leerProductosParaLineasVentaEnTx(
    tx,
    ctx.empresaId,
    lineas.map((l) => l.productoId),
  );
  const productosById = new Map(productos.map((p) => [p.id, p]));

  for (const linea of lineas) {
    const producto = productosById.get(linea.productoId);
    if (producto === undefined) {
      return ventaGuardadoError(PRODUCTO_NO_ENCONTRADO);
    }
    if (!producto.activo) {
      return ventaGuardadoError(PRODUCTO_INACTIVO);
    }
    if (validarLineaVenta(linea, producto.tasaItbis) !== null) {
      return ventaGuardadoError(LINEA_INVALIDA);
    }
    if (!tasaVigenteEn(producto, fecha)) {
      return ventaGuardadoError(TASA_ITBIS_VIGENCIA_FALTA);
    }
  }

  // 3. Discount pipeline — role, config, cap. Only when a discount is present.
  const hayDescuento =
    esDescuentoPositivo(headerDescuento) ||
    lineas.some((l) => esDescuentoPositivo(l.descuento));

  let actorDescuento: number | null = null;
  if (hayDescuento) {
    // 3a. Server-side Administrador check (UI hiding is NOT the control).
    const esAdmin = await tieneRolPermitidoEnTx(tx, ctx.usuarioId, ctx.empresaId, [
      ROL_ADMINISTRADOR,
    ]);
    if (!esAdmin) {
      return ventaGuardadoError(DESCUENTO_NO_AUTORIZADO);
    }
    actorDescuento = ctx.usuarioId;

    // 3b. Hard-fail DESC_MAX read (missing/expired → config error, zero writes).
    let descMax: string;
    try {
      descMax = await leerConfigVentaEnTx(tx, ctx.empresaId, fecha);
    } catch (err) {
      if (err instanceof VentaConfigError) {
        return ventaGuardadoError(err.code);
      }
      throw err;
    }

    // 3c. Pure triple-cap + shape/base validation on the gross bases.
    const brutoPorLinea = lineas.map((l) =>
      calcularLineaVenta(l, productosById.get(l.productoId)!.tasaItbis)
        .subtotalBruto,
    );
    const capInput: DescuentoLineaCap[] = lineas.map((l, i) => ({
      subtotalBruto: brutoPorLinea[i],
      descuento: normalizarDescuento(l.descuento),
    }));
    const cap = validarDescuentosContraMaximo({
      lineas: capInput,
      descuentoCabecera: headerDescuento,
      descMax,
    });
    if (!cap.ok) {
      return ventaGuardadoError(cap.code as VentaErrorCode);
    }
  }

  // 4. Frozen computation (R-V5 + R-V6 proration) and persistence-ready lines.
  const calculadas = lineas.map((l) =>
    calcularLineaVenta(l, productosById.get(l.productoId)!.tasaItbis),
  );
  const { lineas: finales, totales } = calcularTotalesVenta(
    calculadas,
    headerDescuento,
  );

  const persistir: VentaLineaPersistir[] = calculadas.map((c, i) => {
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
  const stockByProduct = new Map(stocks.map((s) => [s.productoId, s.disponible]));
  const warnings: StockWarning[] = [];
  for (const l of persistir) {
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
