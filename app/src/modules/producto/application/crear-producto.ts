import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import { Decimal } from "decimal.js";
import {
  CODIGO_PRODUCTO_DUPLICADO,
  TASA_ITBIS_INVALIDA,
  PRECIO_BASE_INVALIDO,
  VIGENCIA_INVALIDA,
  CATEGORIA_INVALIDA,
  messageFor,
  ProductoDomainError,
  type ProductoErrorCode,
} from "../domain/errors";
import {
  esTasaItbisValida,
  buildProductoItbis,
  type Producto,
} from "../domain/producto";
import type { CrearProductoInput } from "../infrastructure/producto-repository";
import {
  existeCodigoEnEmpresa,
  crearProductoEnTx,
  registrarProductoCreadoEnTx,
} from "../infrastructure/producto-repository";
// Design D3 (fase-3-2): category ownership belongs to the Categoria module.
import { categoriaPerteneceAEmpresa } from "@/modules/categoria/infrastructure/categoria-repository";

export type CrearProductoResult =
  | { ok: true; producto: Producto }
  | { ok: false; code: ProductoErrorCode; message: string };

// Precio >= 0, hasta 2 decimales y dentro de la magnitud Decimal(12,2):
// 10 dígitos enteros + 2 decimales. Sin el bound un monto de 20 dígitos
// pasaría la validación y explotaría al llegar a la BD. 10^10 es el primer
// valor con 11 dígitos enteros (Decimal(12,2) admite hasta 9999999999.99).
const MAGNITUD_MAX_PRECIO = new Decimal("10000000000");

function esPrecioValido(precio: Decimal): boolean {
  return (
    !precio.isNegative() &&
    precio.decimalPlaces() <= 2 &&
    precio.lt(MAGNITUD_MAX_PRECIO)
  );
}

function buildError(
  code: ProductoErrorCode,
): { ok: false; code: ProductoErrorCode; message: string } {
  return { ok: false, code, message: messageFor(code) };
}

export async function crearProducto(
  tx: PrismaTx,
  ctx: TenantCtx,
  input: CrearProductoInput,
): Promise<CrearProductoResult> {
  // Domain validation (no DB required)
  if (!esTasaItbisValida(input.itbisTasa)) {
    return buildError(TASA_ITBIS_INVALIDA);
  }

  if (!esPrecioValido(input.precioVenta)) {
    return buildError(PRECIO_BASE_INVALIDO);
  }

  try {
    buildProductoItbis({
      tasa: input.itbisTasa,
      vigenteDesde: input.itbisVigenteDesde,
      vigenteHasta: input.itbisVigenteHasta,
      aplicaRetencionITBIS: input.itbisAplicaRetencionITBIS,
    });
  } catch (err) {
    // Catch only the domain's known vigencia violation; any other error is a
    // defect and must propagate, never be swallowed as VIGENCIA_INVALIDA.
    if (err instanceof ProductoDomainError && err.code === VIGENCIA_INVALIDA) {
      return buildError(VIGENCIA_INVALIDA);
    }
    throw err;
  }

  const duplicado = await existeCodigoEnEmpresa(tx, ctx.empresaId, input.codigo);
  if (duplicado) {
    return buildError(CODIGO_PRODUCTO_DUPLICADO);
  }

  // Cross-tenant guard: the category reference must belong to the same
  // empresa, otherwise a foreign category could surface later.
  const categoriaValida = await categoriaPerteneceAEmpresa(
    tx,
    ctx.empresaId,
    input.categoriaId,
  );
  if (!categoriaValida) {
    return buildError(CATEGORIA_INVALIDA);
  }

  let producto: Producto;
  try {
    producto = await crearProductoEnTx(tx, ctx, input);
  } catch (err) {
    // The unique (empresaId, codigo) constraint can still fire between the
    // pre-check above and the insert (TOCTOU); the repository maps that P2002
    // to the domain duplicate-code error, which must surface as a result, not
    // an exception. Unexpected errors propagate untouched.
    if (err instanceof ProductoDomainError && err.code === CODIGO_PRODUCTO_DUPLICADO) {
      return buildError(CODIGO_PRODUCTO_DUPLICADO);
    }
    throw err;
  }

  await registrarProductoCreadoEnTx(tx, ctx, producto);

  return { ok: true, producto };
}
