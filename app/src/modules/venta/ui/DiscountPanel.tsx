"use client";

/**
 * Discount panel (spec R-V14). A header-level discount input rendered ONLY for
 * the Administrador role — UI gating is a UX nicety; the authoritative
 * enforcement (server-side Admin-only + the `DESC_MAX` triple-cap) stays in the
 * use case (design decision "Discount enforcement"). The admin's identity is
 * resolved and stored server-side (`descuentoAutorizadoPor`), never by the UI.
 */

import { DESCUENTO_TIPO, type Descuento } from "../domain/venta";

export function DiscountPanel({
  descuento,
  onChange,
}: {
  descuento: Descuento;
  onChange: (d: Descuento) => void;
}) {
  const esPorcentaje = descuento.descuentoTipo === DESCUENTO_TIPO.PORCENTAJE;
  return (
    <section aria-label="Discount" className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="mb-3 text-sm font-semibold text-zinc-900 dark:text-zinc-50">Header discount (admin)</h2>
      <div className="flex items-end gap-2">
        <label className="text-xs text-zinc-600 dark:text-zinc-400">
          Type
          <select
            aria-label="Discount type"
            value={descuento.descuentoTipo}
            onChange={(e) =>
              onChange({
                descuentoTipo: e.target.value as Descuento["descuentoTipo"],
                descuentoValor: descuento.descuentoValor,
              })
            }
            className="mt-1 h-9 rounded-lg border border-zinc-300 px-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-50"
          >
            <option value={DESCUENTO_TIPO.PORCENTAJE}>Percentage</option>
            <option value={DESCUENTO_TIPO.MONTO}>Amount</option>
          </select>
        </label>
        <label className="text-xs text-zinc-600 dark:text-zinc-400">
          Value
          <input
            type="text"
            inputMode="decimal"
            aria-label="Discount value"
            value={descuento.descuentoValor}
            onChange={(e) =>
              onChange({
                descuentoTipo: descuento.descuentoTipo,
                descuentoValor: e.target.value,
              })
            }
            className="mt-1 h-9 w-28 rounded-lg border border-zinc-300 px-2 text-right text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-50"
          />
        </label>
      </div>
      <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
        {esPorcentaje ? "Percent of the gross subtotal" : "Fixed amount"}; capped by the{" "}
        <code>DESC_MAX</code> parameter server-side.
      </p>
    </section>
  );
}
