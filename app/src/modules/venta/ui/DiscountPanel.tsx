"use client";

/**
 * Discount panel (spec R-V14). A header-level discount input rendered ONLY for
 * the Administrador role — UI gating is a UX nicety; the authoritative
 * enforcement (server-side Admin-only + the `DESC_MAX` triple-cap) stays in the
 * use case (design decision "Discount enforcement"). The admin's identity is
 * resolved and stored server-side (`descuentoAutorizadoPor`), never by the UI.
 */

import { DESCUENTO_TIPO, type Descuento } from "../domain/venta";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export function DiscountPanel({
  descuento,
  onChange,
}: {
  readonly descuento: Descuento;
  readonly onChange: (d: Descuento) => void;
}) {
  const esPorcentaje = descuento.descuentoTipo === DESCUENTO_TIPO.PORCENTAJE;
  return (
    <Card aria-label="Discount">
      <CardHeader>
        <CardTitle className="text-sm font-semibold">Header discount (admin)</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-end gap-4">
          <label className="text-xs text-ink-muted">
            <span>Type</span>
            <select
              aria-label="Discount type"
              value={descuento.descuentoTipo}
              onChange={(e) =>
                onChange({
                  descuentoTipo: e.target.value as Descuento["descuentoTipo"],
                  descuentoValor: descuento.descuentoValor,
                })
              }
              className="mt-1 min-h-11 rounded-lg border border-line bg-surface px-2.5 text-sm text-ink"
            >
              <option value={DESCUENTO_TIPO.PORCENTAJE}>Percentage</option>
              <option value={DESCUENTO_TIPO.MONTO}>Amount</option>
            </select>
          </label>
          <label className="text-xs text-ink-muted">
            <span>Value</span>
            <Input
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
              className="mt-1 w-28 text-right"
            />
          </label>
        </div>
        <p className="mt-2 text-xs text-ink-muted">
          {esPorcentaje ? "Percent of the gross subtotal" : "Fixed amount"}; capped by the{" "}
          <code>DESC_MAX</code> parameter server-side.
        </p>
      </CardContent>
    </Card>
  );
}
