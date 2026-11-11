/**
 * Caja UI — presentation helpers and wireframe labels (S7).
 *
 * A PLAIN module (no `"use client"`): the server page and the client island both import these
 * values, and a server component importing a constant from a client module would receive a client
 * reference instead of the value (the same rule the Administración tabs follow).
 *
 * Nothing here computes business figures: the DTOs already carry `Decimal(12,2)` STRINGS and the
 * use cases own every calculation. These helpers only FORMAT those strings (sign, method label, the
 * method-sum for the Total row via decimal.js, the margin suffix) so the island has ONE home for
 * every displayed figure and never does JS float arithmetic (AGENTS.md "Money = Decimal").
 */

import { Decimal } from "decimal.js";
import { formatearMonto } from "@/shared/ui/format";

/** Wireframe 06a copy (S1), stored once so a test can pin it verbatim. */
export const TEXTO_NOTA_CIERRE = "Cierre informativo: no bloquea las operaciones del día.";

/** The corte panel's formula (S1), verbatim from the wireframe. */
export const FORMULA_CORTE =
  "Efectivo esperado = Cobros en efectivo − Devoluciones en efectivo";

/** S3 — the deliberate "not yet" hint next to the disabled close button. */
export const HINT_PROXIMAMENTE = "Próximamente";

/**
 * S4 — the PDF route the export link points at. It ships in a later task, so the control is a
 * plain `href` (a link degrades honestly instead of rendering a button that does nothing).
 */
export const RUTA_CIERRE_PDF = "/api/caja/cierre-pdf";

/** The anchor target of the 06a section (S2: "Ver cierre de caja →"). */
export const ANCLA_CIERRE = "caja-cierre";

/** Stable test ids — the RTL specs and the panels share one literal home. */
export const CAJA_TESTID = {
  cierre: "caja-cierre",
  fecha: "caja-fecha",
  tenant: "caja-tenant",
  kpiTotalFacturado: "caja-kpi-total-facturado",
  kpiTotalCobrado: "caja-kpi-total-cobrado",
  kpiEfectivoEsperado: "caja-kpi-efectivo-esperado",
  kpiDiferencia: "caja-kpi-diferencia",
  tablaMetodos: "caja-tabla-metodos",
  totalFila: "caja-total-fila",
  corte: "caja-corte",
  corteCobros: "caja-corte-cobros",
  corteDevoluciones: "caja-corte-devoluciones",
  corteEsperado: "caja-corte-esperado",
  cerrarHint: "caja-cerrar-hint",
  resumen: "caja-resumen",
  resumenVentas: "caja-resumen-ventas",
  resumenCosto: "caja-resumen-costo",
  resumenMargen: "caja-resumen-margen",
  resumenMargenPct: "caja-resumen-margen-pct",
} as const;

/** The test id of one método row (`caja-metodo-EFECTIVO`). */
export function testIdMetodo(metodo: string): string {
  return `caja-metodo-${metodo}`;
}

/** Whether a Decimal string is negative — drives the distinct Diferencia styling. */
export function esMontoNegativo(valor: string): boolean {
  return /^-\d/.test(valor.trim());
}

/**
 * A signed `Decimal(12,2)` string → Dominican display that KEEPS the sign in front of the currency
 * (`"-499.50"` → `"-RD$ 499.50"`). The shared `formatearMonto` returns negatives verbatim, so the
 * sign is split off here and the magnitude formatted by that single money helper.
 */
export function formatearMontoConSigno(valor: string): string {
  const t = valor.trim();
  if (t.startsWith("-")) return `-${formatearMonto(t.slice(1))}`;
  return formatearMonto(t);
}

/**
 * A `Pago.metodoPago` enum value → the wireframe row label (`EFECTIVO` → `Efectivo`). An unknown
 * value still renders readable (never hidden, never blank).
 */
export function etiquetaMetodo(metodo: string): string {
  const texto = metodo.replace(/_/g, " ").toLowerCase();
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

/** Σ of the per-method `cobros` Decimal strings → a `Decimal(12,2)` string (exact, no float). */
export function sumarMontos(valores: readonly string[]): string {
  const total = valores.reduce((acc, valor) => acc.plus(new Decimal(valor.trim())), new Decimal(0));
  return total.toFixed(2);
}

/** The 06b "Margen %" cell: the DTO already carries one decimal (`"32.6"` → `"32.6%"`). */
export function formatearMargen(porcentaje: string): string {
  return `${porcentaje.trim()}%`;
}
