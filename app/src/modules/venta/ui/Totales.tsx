"use client";

/**
 * Running totals with the gravado/exento ITBIS breakdown (spec R-V14).
 * Purely presentational over the preview produced by the domain calculators;
 * `subtotalGravado`/`subtotalExento` are returned-only figures (R-V6) and are
 * shown here but never persisted by 5b.
 */

import type { TotalesVenta } from "../domain/venta";
import { formatearMonto } from "./carro";

function Fila({ etiqueta, valor, fuerte = false }: { etiqueta: string; valor: string; fuerte?: boolean }) {
  return (
    <div className={`flex items-center justify-between gap-6 py-0.5 ${fuerte ? "text-base font-semibold text-zinc-900 dark:text-zinc-50" : "text-sm text-zinc-700 dark:text-zinc-300"}`}>
      <span>{etiqueta}</span>
      <span className="tabular-nums">RD$ {formatearMonto(valor)}</span>
    </div>
  );
}

export function Totales({ totales }: { totales: TotalesVenta }) {
  return (
    <section aria-label="Totals" className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="mb-3 text-sm font-semibold text-zinc-900 dark:text-zinc-50">Totals</h2>
      <Fila etiqueta="Subtotal" valor={totales.subtotal} />
      <Fila etiqueta="Discount" valor={totales.descuento} />
      <Fila etiqueta="Gravado" valor={totales.subtotalGravado} />
      <Fila etiqueta="Exento" valor={totales.subtotalExento} />
      <Fila etiqueta="ITBIS" valor={totales.itbis} />
      <Fila etiqueta="Total" valor={totales.total} fuerte />
    </section>
  );
}
