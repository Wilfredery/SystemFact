/**
 * Use case: emit a B04 Nota de Crédito for a sale return (fase-5d, task 1.2).
 *
 * The single canonical return flow. Runs INSIDE the caller's tenant
 * transaction (never opens one, never touches HTTP/UI) and composes, in order:
 *
 *   1. `leerVentaParaDevolucionEnTx`            — venta + factura guard
 *   2. `leerPlazoDevolucionEnTx` + `validarPlazoDevolucion` — R-D2 window
 *   3. resolve lines against the ORIGINAL sale  — line validity + frozen
 *      money/rate (R-D5 mirror of the invoice values)
 *   4. `leerStockSucursalEnTx` for ALL products — CRITICAL serialization
 *      point for the R-D3 cap (see the `devolucion-repository` module doc:
 *      the NCF row lock alone cannot serialize the cap under READ COMMITTED
 *      because the cumulative read happens BEFORE the NCF write)
 *   5. per product: cumulative read + `validarCantidadDevuelta` — considering
 *      BOTH prior NCs AND the sibling lines of this NC (same product may
 *      appear as VENDIBLE + DANADO lines)
 *   5b. R-D5 idempotency gate (approved design amendment): an exact
 *      (productoId, cantidad, tipoReposicion) triple already emitted on a prior
 *      VIGENTE NC of this factura rejects the WHOLE call with
 *      `DEVOLUCION_YA_REGISTRADA` before any write or B04 burn; a different
 *      quantity for the same product stays legal (the cumulative cap decides)
 *   6. `calcularTotalesNotaCredito`             — R-D5 frozen math
 *   7. `consumirNcfEnTx(tx, ctx, "B04")`        — atomic NCF consume with the
 *      non-blocking `NCF_UMBRAL_90` warning
 *   8. NOTA_CREDITO + DETALLE rows + audit      — state VIGENTE from birth
 *   9. `registrarDevolucion`                    — post-write stock effect
 *
 * Error mapping (design D2 / R-V13): the return speaks the frozen venta
 * catalog; the NCF consume error maps to the NCF codes PINNED in that same
 * catalog (`mapearCodigoNcf`, same as `confirmarVenta`). `VentaConfigError`
 * (`PLAZO_DEVOLUCION_FALTANTE` from task 1.7) and `VentaDomainError` are
 * caught pre-write and returned as typed results. ANY error raised by the
 * post-write inventory mutation (`registrarDevolucion` —
 * `InventarioDomainError`: bad motivo, NaN stock, DANADO loss over balance)
 * INTENTIONALLY propagates: the wrapper aborts the WHOLE transaction (NC +
 * details + NCF + audit + stock), so a failure after the NC exists can never
 * leave a validated NC with a partial stock effect.
 *
 * Concurrency discipline: the serialization point is the INVENTARIO row lock
 * taken BEFORE the cumulative read; the NCF range lock serializes NCF
 * consumption, not the return cap. `cantidad`/`tasaItbis` travel as raw
 * strings and their grammar is re-validated here (defense in depth; Zod at the
 * boundary is never authoritative for domain rules).
 */

import { Decimal } from "decimal.js";
import {
  DEVOLUCION_YA_REGISTRADA,
  FACTURA_NO_VIGENTE,
  LINEA_INVALIDA,
  LINEAS_VACIAS,
  messageFor,
  VENTA_NO_CONFIRMADA,
  VENTA_NO_ENCONTRADO,
  VentaDomainError,
  type VentaErrorCode,
} from "../../venta/domain/errors";
import { ESTADO_VENTA } from "../../venta/domain/venta";
import {
  leerPlazoDevolucionEnTx,
  PLAZO_DEVOLUCION_FALTANTE,
  VentaConfigError,
} from "../../venta/infrastructure/config-repository";
import { leerVentaParaDevolucionEnTx } from "../../venta/infrastructure/venta-repository";
import {
  consumirNcfEnTx,
  NcfConsumoError,
  type NcfConsumoErrorCode,
} from "@/modules/ncf/application/consumir-ncf";
import { NCF_UMBRAL_90 } from "@/modules/ncf/domain/ncf-rules";
import { registrarDevolucion } from "@/modules/inventario/application/registrar-salidas-venta";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import {
  calcularTotalesNotaCredito,
  validarCantidadDevuelta,
  validarPlazoDevolucion,
  validarReturnType,
  type DetalleNotaCreditoInput,
  type TipoReposicion,
} from "../domain/devolucion";
import {
  crearDetalleNotaCreditoEnTx,
  crearNotaCreditoEnTx,
  existeDevolucionIdenticaEnTx,
  leerPriorNCsPorFacturaEnTx,
  leerStockSucursalEnTx,
  registrarAuditNotaCreditoEnTx,
} from "../infrastructure/devolucion-repository";

/** One return line from the transport; `cantidad` stays a raw string. */
export interface LineaDevolucionInput {
  readonly productoId: number;
  readonly cantidad: string;
  readonly tipoReposicion: TipoReposicion;
}

/** Return request: the original sale id, a trimmed audit reason and ≥1 line. */
export interface CrearDevolucionInput {
  readonly ventaId: number;
  readonly motivo: string;
  readonly lineas: readonly LineaDevolucionInput[];
  /** Injected clock (return window + NCF SD-expiry); defaults to `new Date()`. */
  readonly now?: Date;
}

/** Composed error surface: the frozen venta catalog ∪ PLAZO_DEVOLUCION_FALTANTE. */
export type DevolucionErrorCode = VentaErrorCode | typeof PLAZO_DEVOLUCION_FALTANTE;

/** Non-blocking warning channel — currently only the 90% NCF-range threshold. */
export type DevolucionWarning = { readonly code: typeof NCF_UMBRAL_90 };

/** The emitted credit note: id + burned B04 NCF + frozen header money. */
export interface DevolucionOutput {
  readonly id: number;
  readonly ncf: string;
  readonly facturaId: number;
  readonly estado: string;
  readonly monto: string;
  readonly itbis: string;
  readonly lineas: number;
}

export type DevolucionResult =
  | {
      readonly ok: true;
      readonly data: DevolucionOutput;
      readonly warnings?: readonly DevolucionWarning[];
    }
  | {
      readonly ok: false;
      readonly code: DevolucionErrorCode;
      readonly message: string;
      /** Minimal locator context; only the idempotency gate (605) populates it. */
      readonly details?: { readonly facturaId: number; readonly productoId: number };
    };

function devolucionError(code: VentaErrorCode): DevolucionResult {
  return { ok: false, code, message: messageFor(code) };
}

/** The NCF codes are PINNED members of the venta catalog (R-V13) — honest cast. */
function mapearCodigoNcf(code: NcfConsumoErrorCode): VentaErrorCode {
  return code as VentaErrorCode;
}

/** Quantity grammar mirroring the domain calculator — LINEA_INVALIDA pre-Decimal. */
function aDecimalCantidad(cantidad: string, productoId: number): Decimal {
  if (!/^\d{1,9}(\.\d{1,3})?$/.test(cantidad)) {
    throw new VentaDomainError(LINEA_INVALIDA, { productoId });
  }
  return new Decimal(cantidad);
}

/**
 * PURE resolution of the requested return lines against the ORIGINAL sale rows
 * (R-D5 mirror, quality-polish 1e): a product never sold in THIS venta is an
 * invalid line, and money + rate freeze from the original row — the exact
 * predicates the inline loop applied, only relocated. `validarReturnType` and
 * the quantity-grammar probe keep throwing `VentaDomainError(LINEA_INVALIDA)`
 * at the same pre-write position (the outer catch maps them). No DB access:
 * it runs before the locking `leerStockSucursalEnTx` read.
 *
 * v2r-04: a product may legitimately span SEVERAL ORIGINAL rows of the same
 * factura (e.g. 5.000 units at one price and 2.000 units elsewhere — the sale
 * was billed in two detail rows). The frozen original for that product is the
 * SUM of those row quantities: previously the Map collapsed every row to the
 * LAST one, so returning 6.000 of 7.000 sold was wrongly rejected. Money and
 * rate stay frozen from the original rows and MUST be homogeneous across them
 * — a product billed at two different prices/rates has no single frozen
 * mirror, so it fails LOUD with `LINEA_INVALIDA` (never a silent pick).
 */
export function resolverLineasContraVentaOriginal(
  inputLineas: readonly LineaDevolucionInput[],
  ventaLineas: readonly {
    readonly productoId: number;
    readonly cantidad: string;
    readonly precioUnitario: string;
    readonly tasaItbis: string;
  }[],
): {
  readonly lineas: DetalleNotaCreditoInput[];
  readonly cantidades: Decimal[];
  readonly originales: Decimal[];
} {
  // Group ORIGINAL rows per product: Σ cantidad, frozen money/rate. The rate/
  // price comparison is NUMERIC (Decimal.equals, not string) so a rate stored
  // as "18" in one row and "18.00" in another is still homogeneous.
  const agrupado = new Map<number, { cantidad: Decimal; precioUnitario: string; tasaItbis: string }>();
  for (const l of ventaLineas) {
    const previo = agrupado.get(l.productoId);
    if (previo === undefined) {
      agrupado.set(l.productoId, {
        cantidad: new Decimal(l.cantidad),
        precioUnitario: l.precioUnitario,
        tasaItbis: l.tasaItbis,
      });
      continue;
    }
    if (
      !new Decimal(previo.precioUnitario).equals(new Decimal(l.precioUnitario)) ||
      !new Decimal(previo.tasaItbis).equals(new Decimal(l.tasaItbis))
    ) {
      throw new VentaDomainError(LINEA_INVALIDA, { productoId: l.productoId });
    }
    previo.cantidad = previo.cantidad.plus(new Decimal(l.cantidad));
  }

  const lineas: DetalleNotaCreditoInput[] = [];
  const cantidades: Decimal[] = [];
  const originales: Decimal[] = [];
  for (const l of inputLineas) {
    validarReturnType(l.tipoReposicion);
    const original = agrupado.get(l.productoId);
    if (original === undefined) {
      throw new VentaDomainError(LINEA_INVALIDA, { productoId: l.productoId });
    }
    const cantidad = aDecimalCantidad(l.cantidad, l.productoId);
    lineas.push({
      productoId: l.productoId,
      cantidad: l.cantidad,
      precioUnitario: original.precioUnitario,
      tasaItbis: original.tasaItbis,
      tipoReposicion: l.tipoReposicion,
    });
    cantidades.push(cantidad);
    originales.push(original.cantidad);
  }
  return { lineas, cantidades, originales };
}

export async function crearDevolucion(
  tx: PrismaTx,
  ctx: TenantCtx,
  input: CrearDevolucionInput,
): Promise<DevolucionResult> {
  const now = input.now ?? new Date();

  try {
    const venta = await leerVentaParaDevolucionEnTx(tx, ctx, input.ventaId);
    if (venta === null) return devolucionError(VENTA_NO_ENCONTRADO);
    if (venta.estado !== ESTADO_VENTA.CONFIRMADA) return devolucionError(VENTA_NO_CONFIRMADA);
    // S6582 (quality-polish 1e): optional chaining covers both failure shapes
    // identically — a `null` factura short-circuits to `undefined`, which is
    // never `"VIGENTE"`, so the same FACTURA_NO_VIGENTE guard fires.
    if (venta.factura?.estado !== "VIGENTE") {
      return devolucionError(FACTURA_NO_VIGENTE);
    }

    // R-D2: the config window covering the RETURN instant (task 1.7 reader),
    // then the SD calendar-day window from the sale date.
    const plazoDias = await leerPlazoDevolucionEnTx(tx, ctx.empresaId, now);
    validarPlazoDevolucion(venta.ventaFecha, plazoDias, now);

    // Unreachable via the boundary Zod (min 1) but the app layer is also
    // called directly by tests — a zero-line NC must never be created.
    if (input.lineas.length === 0) return devolucionError(LINEAS_VACIAS);

    // Resolve against the ORIGINAL sale rows via the pure resolver (quality-polish
    // 1e): a product never sold in THIS venta is an invalid line, and money +
    // rate freeze from the original row (the design's R-D5 mirror; see the
    // DETALLE_NOTA_CREDITO schema-comment tension note in `devolucion-repository`).
    const { lineas, cantidades, originales } = resolverLineasContraVentaOriginal(
      input.lineas,
      venta.lineas,
    );

    // CRITICAL: lock ALL inventory rows FIRST (ascending, the same order every
    // inventory seam uses) — this IS the serialization point for R-D3. All
    // cumulative reads below run under those locks.
    await leerStockSucursalEnTx(tx, ctx, lineas.map((l) => l.productoId));

    // Cumulative cap: prior NCs (ONE batched read for every distinct product,
    // no N+1) PLUS the sibling lines of THIS NC already processed — a product
    // may legitimately appear twice (VENDIBLE + DANADO), so each sibling line
    // must see the previous one or the combined quantity could exceed the
    // original sale.
    const idsDistintos = [...new Set(lineas.map((l) => l.productoId))];
    const priorPorProducto = await leerPriorNCsPorFacturaEnTx(
      tx,
      ctx,
      venta.factura.facturaId,
      idsDistintos,
    );

    // R-D5 idempotency gate (approved design amendment, task 3.3): an exact
    // (productoId, cantidad, tipoReposicion) triple already emitted on a
    // prior VIGENTE NC of this factura is a RETRY, not a cumulative return —
    // reject BEFORE the cap check, before any write and BEFORE the B04 burn.
    // A different quantity for the same product still passes (task 3.1).
    const repetida = await existeDevolucionIdenticaEnTx(
      tx,
      ctx,
      venta.factura.facturaId,
      input.lineas,
    );
    if (repetida !== null) {
      return {
        ok: false,
        code: DEVOLUCION_YA_REGISTRADA,
        message: messageFor(DEVOLUCION_YA_REGISTRADA),
        details: {
          facturaId: venta.factura.facturaId,
          productoId: repetida.productoId,
        },
      };
    }

    const acumulado = new Map<number, Decimal>(
      idsDistintos.map((productoId) => [
        productoId,
        priorPorProducto.get(productoId) ?? new Decimal(0),
      ]),
    );
    for (let i = 0; i < lineas.length; i++) {
      const linea = lineas[i];
      // `acumulado` is seeded with the prior-NC totals; each sibling line adds
      // its quantity, so a repeated product sees the previous line.
      const ya = acumulado.get(linea.productoId) ?? new Decimal(0);
      validarCantidadDevuelta(cantidades[i], originales[i], ya);
      acumulado.set(linea.productoId, ya.plus(cantidades[i]));
    }

    const totales = calcularTotalesNotaCredito(lineas);

    const consumido = await consumirNcfEnTx(tx, ctx, "B04", { now });

    const notaCredito = await crearNotaCreditoEnTx(tx, ctx, {
      facturaOriginalId: venta.factura.facturaId,
      clienteId: venta.clienteId,
      ncf: consumido.ncf,
      motivo: input.motivo.trim(),
      monto: totales.monto,
      itbis: totales.itbis,
      fechaEmision: now,
    });

    // The calculator returns per-line money in INPUT order — persist verbatim,
    // never recompute a second formula (frozen parity).
    const detalles = lineas.map((linea, i) => ({
      productoId: linea.productoId,
      cantidad: linea.cantidad,
      precioUnitario: linea.precioUnitario,
      tasaItbis: linea.tasaItbis,
      subtotalLinea: totales.lineas[i].subtotalLinea,
      itbis: totales.lineas[i].itbisLinea,
      tipoReposicion: linea.tipoReposicion,
    }));
    await crearDetalleNotaCreditoEnTx(tx, notaCredito.id, detalles);

    await registrarAuditNotaCreditoEnTx(
      tx,
      ctx,
      notaCredito.id,
      {
        estado: "VIGENTE",
        ncf: consumido.ncf,
        monto: totales.monto,
        itbis: totales.itbis,
      },
      input.motivo.trim(),
    );

    // Post-write stock effect. Any InventarioDomainError raised here (bad
    // motivo, NaN balance, DANADO loss over stock) propagates and the wrapper
    // rolls back EVERYTHING — NC, details, NCF, audit, stock together.
    await registrarDevolucion(tx, ctx, {
      notaCreditoId: notaCredito.id,
      motivo: input.motivo.trim(),
      lineas: detalles.map((d) => ({
        productoId: d.productoId,
        cantidad: d.cantidad,
        tipoReposicion: d.tipoReposicion,
      })),
    });

    const output: DevolucionOutput = {
      id: notaCredito.id,
      ncf: consumido.ncf,
      facturaId: venta.factura.facturaId,
      estado: "VIGENTE",
      monto: totales.monto,
      itbis: totales.itbis,
      lineas: detalles.length,
    };

    return consumido.warning !== undefined
      ? { ok: true, data: output, warnings: [{ code: NCF_UMBRAL_90 }] }
      : { ok: true, data: output };
  } catch (err) {
    if (err instanceof NcfConsumoError) {
      return devolucionError(mapearCodigoNcf(err.code));
    }
    if (err instanceof VentaConfigError) {
      // This reader only ever throws PLAZO_DEVOLUCION_FALTANTE (task 1.7);
      // DESC_MAX_FALTANTE belongs to a different reader and can't surface here.
      return { ok: false, code: err.code as typeof PLAZO_DEVOLUCION_FALTANTE, message: err.message };
    }
    if (err instanceof VentaDomainError) {
      return devolucionError(err.code);
    }
    // Post-write failures (InventarioDomainError, Prisma) intentionally
    // propagate: the transaction rolls back, never a partial document.
    throw err;
  }
}