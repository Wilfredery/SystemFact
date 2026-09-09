/**
 * Shared application helper: validate + compute purchase lines.
 *
 * Turns submitted lines into frozen-rate, fully-calculated lines plus header
 * totals, enforcing the same preconditions (active supplier, tenant-owned and
 * active products, valid quantities/costs/rates) used by create, update and
 * confirm. Returns a typed coded error (never throwing for business reasons)
 * so every use case shares one source of truth for line rules (spec: invalid
 * line / foreign or inactive product).
 */

import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import {
  LINEA_INVALIDA,
  PRODUCTO_NO_ENCONTRADO,
  PROVEEDOR_INACTIVO,
  PROVEEDOR_NO_ENCONTRADO,
  messageFor,
  type CompraErrorCode,
} from "../domain/errors";
import type {
  CompraLineaCalculada,
  CompraLineaInput,
  TotalesCompra,
} from "../domain/compra";
import { calcularLinea, calcularTotales, validarLinea } from "../domain/calculators";
import { leerProductosParaLineasEnTx } from "../infrastructure/compra-repository";

export type PrepararLineasResultado =
  | {
      readonly ok: true;
      readonly lineas: readonly CompraLineaCalculada[];
      readonly totales: TotalesCompra;
    }
  | { readonly ok: false; readonly code: CompraErrorCode; readonly message: string };

/**
 * Validate the supplier is present and active, then validate + freeze each
 * line against its product's ITBIS rate and aggregate the header totals.
 * An empty line set is rejected (a purchase needs at least one line).
 */
export async function prepararLineas(
  tx: PrismaTx,
  empresaId: number,
  proveedorId: number,
  proveedorActivo: boolean,
  proveedorExiste: boolean,
  lineas: readonly CompraLineaInput[],
): Promise<PrepararLineasResultado> {
  if (!proveedorExiste) {
    return { ok: false, code: PROVEEDOR_NO_ENCONTRADO, message: messageFor(PROVEEDOR_NO_ENCONTRADO) };
  }
  if (!proveedorActivo) {
    return { ok: false, code: PROVEEDOR_INACTIVO, message: messageFor(PROVEEDOR_INACTIVO) };
  }
  if (lineas.length === 0) {
    return { ok: false, code: LINEA_INVALIDA, message: messageFor(LINEA_INVALIDA) };
  }

  const productos = await leerProductosParaLineasEnTx(
    tx,
    empresaId,
    lineas.map((l) => l.productoId),
  );
  const productosById = new Map(productos.map((p) => [p.id, p]));

  const calculadas: CompraLineaCalculada[] = [];
  for (const linea of lineas) {
    const producto = productosById.get(linea.productoId);
    if (producto === undefined) {
      return { ok: false, code: PRODUCTO_NO_ENCONTRADO, message: messageFor(PRODUCTO_NO_ENCONTRADO) };
    }
    if (!producto.activo) {
      return { ok: false, code: LINEA_INVALIDA, message: messageFor(LINEA_INVALIDA) };
    }
    const invalida = validarLinea(linea, producto.tasaItbis);
    if (invalida !== null) {
      return { ok: false, code: invalida, message: messageFor(invalida) };
    }
    calculadas.push(calcularLinea(linea, producto.tasaItbis));
  }

  return { ok: true, lineas: calculadas, totales: calcularTotales(calculadas) };
}
