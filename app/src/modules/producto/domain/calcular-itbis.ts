import { Decimal } from "decimal.js";
import type { Producto } from "./producto";
import { CANTIDAD_INVALIDA, ProductoDomainError } from "./errors";

export interface ItbisLine {
  readonly baseImponible: Decimal;
  readonly itbis: Decimal;
  readonly total: Decimal;
}

/**
 * Calcula el ITBIS de un producto para una cantidad dada.
 *
 * Reglas:
 *   - `baseImponible = precioVenta * cantidad`
 *   - `itbis = baseImponible * tasa / 100`
 *   - `total = baseImponible + itbis`
 *   - Cantidad negativa lanza `CANTIDAD_INVALIDA`.
 *   - Cantidad cero devuelve base, itbis y total en cero.
 *
 * La cantidad se acepta como `Decimal` o string numérico — NUNCA como `number`,
 * para que un float (0.1+0.2, etc.) no introduzca ruido binario en el dominio
 * (decimal.js no puede sanear un valor que ya llegó como float).
 * Todo el cálculo usa `Decimal` para evitar errores de punto flotante.
 */
export function calcularItbisProducto(
  producto: Producto,
  cantidad: Decimal | string,
): ItbisLine {
  const qty = typeof cantidad === "string" ? new Decimal(cantidad) : cantidad;

  if (qty.isNegative()) {
    throw new ProductoDomainError(CANTIDAD_INVALIDA);
  }

  const baseImponible = producto.precioVenta.mul(qty);

  if (qty.isZero() || producto.exento) {
    return {
      baseImponible,
      itbis: new Decimal("0"),
      total: baseImponible,
    };
  }

  const tasa = new Decimal(producto.itbis.tasa).div(100);
  const itbis = baseImponible.mul(tasa);
  const total = baseImponible.plus(itbis);

  return {
    baseImponible,
    itbis,
    total,
  };
}
