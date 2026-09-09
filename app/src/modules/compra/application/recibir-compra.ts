/**
 * Use case: CMP-RECEIVE — guarded `PENDIENTE → RECIBIDA` receipt (fase-3-4b).
 *
 * Ownership model (Approach B): compra OWNS the state transition and the
 * orchestration; inventario OWNS every stock/movement/cost invariant via the
 * `registrarEntradasCompra` use case (application → application over published
 * domain types). Compra NEVER writes stock, `MovimientoInventario` or
 * `Producto.costoPromedio` itself.
 *
 * Runs entirely inside the CALLER's single `withTenantTransaction` (the HTTP
 * adapter opens exactly one; no nested transaction, no direct Compra→Inventario
 * infrastructure call). Ordered so that every rejection BEFORE the state flip is
 * a plain typed result (commits nothing), while the one failure that CAN happen
 * AFTER the flip (an inventario entry rejection) is THROWN so the whole
 * transaction — including the guarded `estado='RECIBIDA'` write — rolls back.
 *
 * Idempotency (spec "Idempotent receipt under retry"): the guarded
 * `UPDATE ... WHERE estado='PENDIENTE'` with an affected-rows check is the sole
 * arbiter — a duplicate click (already `RECIBIDA`) or a losing concurrent race
 * updates zero rows and produces ZERO inventory calls, so stock/movements/cost
 * can never be applied twice.
 *
 * Branch scoping (spec "session branch only"): only the purchase's own branch
 * may receive it; `ctx.sucursalId !== compra.sucursalId` returns a typed branch
 * error with zero writes.
 */

import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import {
  COMPRA_NO_ENCONTRADA,
  COMPRA_SUCURSAL_INVALIDA,
  CONCURRENCIA_CONFLICTO,
  INVENTARIO_ENTRADA_RECHAZADA,
  COMPRA_INMUTABLE,
  messageFor,
  CompraDomainError,
  type CompraErrorCode,
} from "../domain/errors";
import {
  ESTADO_COMPRA,
  transicionarRecibir,
  type CompraResult,
  type EstadoCompraCore,
} from "../domain/compra";
import {
  leerCompraEnTx,
  recibirCompraEnTx,
  registrarAuditCompraEnTx,
} from "../infrastructure/compra-repository";
import { registrarEntradasCompra } from "@/modules/inventario/application/registrar-entrada-compra";
import { InventarioDomainError } from "@/modules/inventario/domain/errors";

export interface RecibirCompraInput {
  readonly id: number;
}

export interface RecibirCompraOutput {
  readonly id: number;
  readonly estado: EstadoCompraCore;
  /** Number of purchase lines whose stock was entered (one movement each). */
  readonly movimientosAplicados: number;
}

export type RecibirCompraResult = CompraResult<RecibirCompraOutput>;

function buildError(
  code: CompraErrorCode,
): { ok: false; code: CompraErrorCode; message: string } {
  return { ok: false, code, message: messageFor(code) };
}

/**
 * Receive a `PENDIENTE` purchase: flip its state under a guarded update, then
 * delegate the full receipt to inventario for stock + `ENTRADA_COMPRA`
 * movements (carrying `compraId`) + the company-wide cost update, all inside the
 * same transaction, and append one compra audit row.
 *
 * @throws CompraDomainError(INVENTARIO_ENTRADA_RECHAZADA) if the inventario
 *   entry rejects AFTER the state flip — thrown (not returned) so the guarded
 *   update rolls back and the purchase is never left `RECIBIDA` without stock.
 */
export async function recibirCompra(
  tx: PrismaTx,
  ctx: TenantCtx,
  input: RecibirCompraInput,
): Promise<RecibirCompraResult> {
  const compra = await leerCompraEnTx(tx, ctx, input.id);
  if (compra === null) {
    return buildError(COMPRA_NO_ENCONTRADA);
  }

  // Branch guard FIRST: a foreign-branch purchase is refused with zero writes.
  if (compra.sucursalId !== ctx.sucursalId) {
    return buildError(COMPRA_SUCURSAL_INVALIDA);
  }

  // Pure state guard. Wrong state → TRANSICION_INVALIDA (zero writes). An
  // already-received purchase (idempotent duplicate) surfaces as the stable
  // CONCURRENCIA_CONFLICTO so a duplicate click reports "already received".
  const transicion = transicionarRecibir(compra.estado);
  if (!transicion.ok) {
    if (transicion.code === COMPRA_INMUTABLE) {
      return buildError(CONCURRENCIA_CONFLICTO);
    }
    return buildError(transicion.code);
  }

  // Guarded flip `PENDIENTE → RECIBIDA`. Zero affected rows means a concurrent
  // receipt won; perform NO inventory call (idempotent, no double-entry).
  const { recibido } = await recibirCompraEnTx(tx, ctx, input.id);
  if (!recibido) {
    return buildError(CONCURRENCIA_CONFLICTO);
  }

  // Full receipt: hand ALL persisted lines to inventario in one batch. The net
  // (ITBIS-exclusive) unit cost is the persisted `costoUnitario`; inventario
  // aggregates duplicate products into one cost update while writing one
  // movement per line. Any rejection THROWS so this transaction (including the
  // estado flip above) rolls back atomically.
  const lineas = compra.lineas.map((l) => ({
    productoId: l.productoId,
    cantidad: l.cantidad,
    costoUnitarioSinItbis: l.costoUnitario,
  }));
  const motivo = `Recepción compra ${compra.correlativoInterno}`;

  let movimientos;
  try {
    movimientos = await registrarEntradasCompra(tx, ctx, {
      compraId: input.id,
      motivo,
      lineas,
    });
  } catch (err) {
    // Map any inventario domain failure to the stable bridge code; never leak
    // inventario's internal codes/details into compra's public error catalog.
    if (err instanceof InventarioDomainError) {
      throw new CompraDomainError(INVENTARIO_ENTRADA_RECHAZADA, {
        compraId: input.id,
      });
    }
    throw err;
  }

  await registrarAuditCompraEnTx(
    tx,
    ctx,
    "ACTUALIZAR",
    input.id,
    { estado: ESTADO_COMPRA.PENDIENTE },
    { estado: ESTADO_COMPRA.RECIBIDA, movimientosAplicados: movimientos.length },
    "compra.recibida",
  );

  return {
    ok: true,
    data: {
      id: input.id,
      estado: ESTADO_COMPRA.RECIBIDA,
      movimientosAplicados: lineas.length,
    },
  };
}
