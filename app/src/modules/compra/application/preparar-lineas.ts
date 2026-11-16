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
  TASA_ITBIS_CONFIG_FALTANTE,
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
import {
  calcularLinea,
  calcularTotales,
  validarLinea,
} from "../domain/calculators";
import { leerProductosParaLineasEnTx } from "../infrastructure/compra-repository";
import { TasasItbisConfigError } from "@/shared/domain/tasas-itbis";
import { leerTasasItbisEnTx } from "@/shared/infrastructure/tasas-itbis-config";

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
 * Each line's rate is checked against the per-empresa TASA_ITBIS list read
 * INSIDE the tenant transaction AFTER the product batch, at the compra `fecha`
 * (feature itbis-tasas-config, slice 3e). A missing/malformed key fails loud
 * with the stable `TASA_ITBIS_CONFIG_FALTANTE` code (S15) — never a silent
 * hardcoded default.
 * An empty line set is rejected (a purchase needs at least one line).
 */
export async function prepararLineas(
  tx: PrismaTx,
  empresaId: number,
  proveedorId: number,
  proveedorActivo: boolean,
  proveedorExiste: boolean,
  lineas: readonly CompraLineaInput[],
  fecha: Date,
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

  // Per-empresa ITBIS rate list (TASA_ITBIS), read in the same transaction
  // AFTER the product batch; the compra fecha selects the validity window.
  let tasasPermitidas: readonly string[];
  try {
    tasasPermitidas = await leerTasasItbisEnTx(tx, empresaId, fecha);
  } catch (err) {
    if (err instanceof TasasItbisConfigError) {
      return {
        ok: false,
        code: TASA_ITBIS_CONFIG_FALTANTE,
        message: messageFor(TASA_ITBIS_CONFIG_FALTANTE),
      };
    }
    throw err;
  }

  const calculadas: CompraLineaCalculada[] = [];
  for (const linea of lineas) {
    const producto = productosById.get(linea.productoId);
    if (producto === undefined) {
      return { ok: false, code: PRODUCTO_NO_ENCONTRADO, message: messageFor(PRODUCTO_NO_ENCONTRADO) };
    }
    if (!producto.activo) {
      return { ok: false, code: LINEA_INVALIDA, message: messageFor(LINEA_INVALIDA) };
    }
    const invalida = validarLinea(linea, producto.tasaItbis, tasasPermitidas);
    if (invalida !== null) {
      return { ok: false, code: invalida, message: messageFor(invalida) };
    }
    calculadas.push(calcularLinea(linea, producto.tasaItbis));
  }

  return { ok: true, lineas: calculadas, totales: calcularTotales(calculadas) };
}
