"use client";

/**
 * Running totals with the gravado/exento ITBIS breakdown (spec R-V14).
 * Purely presentational over the preview produced by the domain calculators;
 * `subtotalGravado`/`subtotalExento` are returned-only figures (R-V6) and are
 * shown here but never persisted by 5b.
 */

import type { TotalesVenta } from "../domain/venta";
import { formatearMonto } from "@/shared/ui/format";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { calcularVuelto } from "./credito";

function Fila({ etiqueta, valor, fuerte = false }: { readonly etiqueta: string; readonly valor: string; readonly fuerte?: boolean }) {
  return (
    <div className={`flex items-center justify-between gap-6 py-2 ${fuerte ? "text-base font-semibold text-ink" : "text-sm text-ink"}`}>
      <span>{etiqueta}</span>
      <span className="tabular-nums">{formatearMonto(valor)}</span>
    </div>
  );
}

export function Totales({
  totales,
  dineroRecibido,
  onDineroRecibidoChange,
  onFocusDineroRecibido,
}: {
  readonly totales: TotalesVenta;
  /** F2 (D3/R-V22) optional vuelto slot: absent props = today's Totales shape. */
  readonly dineroRecibido?: string;
  readonly onDineroRecibidoChange?: (v: string) => void;
  /** D4/R-V23: focusing the money input retargets the shared keypad. */
  readonly onFocusDineroRecibido?: () => void;
}) {
  const vueltoSlot = onDineroRecibidoChange !== undefined && dineroRecibido !== undefined;
  const vuelto = calcularVuelto(totales.total, dineroRecibido ?? "");
  const estado = vuelto.estado;
  return (
    <Card aria-label="Totals">
      <CardHeader>
        <CardTitle className="text-sm font-semibold">Totals</CardTitle>
      </CardHeader>
      <CardContent>
        <Fila etiqueta="Subtotal" valor={totales.subtotal} />
        <Fila etiqueta="Discount" valor={totales.descuento} />
        <Fila etiqueta="Gravado" valor={totales.subtotalGravado} />
        <Fila etiqueta="Exento" valor={totales.subtotalExento} />
        <Fila etiqueta="ITBIS" valor={totales.itbis} />
        <Fila etiqueta="Total" valor={totales.total} fuerte />
        {vueltoSlot && (
          <div className="mt-2 border-t border-line pt-2">
            <Input
              type="text"
              inputMode="decimal"
              value={dineroRecibido}
              onChange={(e) => onDineroRecibidoChange(e.target.value)}
              onFocus={() => onFocusDineroRecibido?.()}
              aria-label="Money received"
              placeholder="0.00"
              className="min-h-12 w-full text-right"
            />
            {estado === "VUELTO" && (
              <div className="mt-2 flex items-center gap-2">
                <span className="text-sm font-semibold text-ink">
                  Vuelto {formatearMonto(vuelto.monto)}
                </span>
                <Badge variant="outline">Reference only</Badge>
              </div>
            )}
            {estado === "FALTA" && (
              <div className="mt-2 flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-ink">
                    Falta {formatearMonto(vuelto.monto)}
                  </span>
                  <Badge variant="outline">Reference only</Badge>
                </div>
              </div>
            )}
            {(estado === "SIN_DATOS") && null}
            <p className="mt-1 text-xs text-ink-muted">
              The sale records the full invoice total. Not a payment.
            </p>
            {estado === "FALTA" && (
              <p className="text-xs text-ink-muted">
                Shortfall shown as a reference; the confirmed sale always records the full total.
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
