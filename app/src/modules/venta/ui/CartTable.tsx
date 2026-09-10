"use client";

/**
 * Ephemeral cart table (spec R-V14): add/remove plus quantity and unit-price
 * editing, each row showing the live per-line ITBIS at its rate. Editing a
 * field keeps the raw string in state (the preview skips not-yet-valid lines);
 * money never round-trips through a float.
 */

import { formatearMonto, type LineaPreview } from "./carro";

export function CartTable({
  lineas,
  onCantidadChange,
  onPrecioChange,
  onRemove,
}: {
  lineas: readonly LineaPreview[];
  onCantidadChange: (productoId: number, valor: string) => void;
  onPrecioChange: (productoId: number, valor: string) => void;
  onRemove: (productoId: number) => void;
}) {
  return (
    <section aria-label="Cart" className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="mb-3 text-sm font-semibold text-zinc-900 dark:text-zinc-50">Cart</h2>
      {lineas.length === 0 ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">No products yet. Search and add a product.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-xs uppercase text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
                <th className="py-2 pr-3 font-medium">Product</th>
                <th className="py-2 pr-3 font-medium">Qty</th>
                <th className="py-2 pr-3 font-medium">Unit price</th>
                <th className="py-2 pr-3 font-medium">ITBIS</th>
                <th className="py-2 pr-3 font-medium">Subtotal</th>
                <th className="py-2 font-medium">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {lineas.map(({ linea, calculo, computable }) => (
                <tr key={linea.productoId} className="border-b border-zinc-100 dark:border-zinc-800">
                  <td className="py-2 pr-3">
                    <p className="font-medium text-zinc-900 dark:text-zinc-50">{linea.nombre}</p>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">{linea.codigo}</p>
                  </td>
                  <td className="py-2 pr-3">
                    <input
                      type="text"
                      inputMode="decimal"
                      value={linea.cantidad}
                      onChange={(e) => onCantidadChange(linea.productoId, e.target.value)}
                      aria-label={`Quantity for ${linea.nombre}`}
                      className="h-8 w-16 rounded border border-zinc-300 px-2 text-right dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-50"
                    />
                  </td>
                  <td className="py-2 pr-3">
                    <input
                      type="text"
                      inputMode="decimal"
                      value={linea.precioUnitario}
                      onChange={(e) => onPrecioChange(linea.productoId, e.target.value)}
                      aria-label={`Unit price for ${linea.nombre}`}
                      className="h-8 w-24 rounded border border-zinc-300 px-2 text-right dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-50"
                    />
                  </td>
                  <td className="py-2 pr-3 text-zinc-700 dark:text-zinc-300">
                    {computable && calculo !== null ? (
                      <>
                        {formatearMonto(calculo.itbisLinea)}{" "}
                        <span className="text-xs text-zinc-500">({linea.tasaItbis}%)</span>
                      </>
                    ) : (
                      <span className="text-xs text-amber-600">invalid</span>
                    )}
                  </td>
                  <td className="py-2 pr-3 text-zinc-700 dark:text-zinc-300">
                    {computable && calculo !== null ? formatearMonto(calculo.baseLinea) : "—"}
                  </td>
                  <td className="py-2 text-right">
                    <button
                      type="button"
                      onClick={() => onRemove(linea.productoId)}
                      aria-label={`Remove ${linea.nombre}`}
                      className="rounded border border-red-300 px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 dark:hover:bg-zinc-800"
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
