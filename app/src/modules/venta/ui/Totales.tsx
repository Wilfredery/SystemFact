"use client";

/**
 * Running totals with the gravado/exento ITBIS breakdown (spec R-V14).
 * Purely presentational over the preview produced by the domain calculators;
 * `subtotalGravado`/`subtotalExento` are returned-only figures (R-V6) and are
 * shown here but never persisted by 5b.
 */

import type { TotalesVenta } from "../domain/venta";
import { formatearMonto } from "@/shared/ui/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

function Fila({ etiqueta, valor, fuerte = false }: { readonly etiqueta: string; readonly valor: string; readonly fuerte?: boolean }) {
  return (
    <div className={`flex items-center justify-between gap-6 py-2 ${fuerte ? "text-base font-semibold text-ink" : "text-sm text-ink"}`}>
      <span>{etiqueta}</span>
      <span className="tabular-nums">{formatearMonto(valor)}</span>
    </div>
  );
}

export function Totales({ totales }: { readonly totales: TotalesVenta }) {
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
      </CardContent>
    </Card>
  );
}
