/**
 * Reportes UI — the dashboard KPI tiles (DB-1, DB-2).
 *
 * A pure SERVER presentational component: it renders ONLY the tiles present in the
 * {@link DashboardVista} the use case returned. The use case already enforced the role gate
 * and set non-permitted tiles to `null` (DB-2), so this component has no role logic at all —
 * it cannot render a tile whose data never reached it. Figures are Decimal strings formatted
 * for display via the reused cobros money formatter (never a float). This keeps UI a thin
 * projection of the server-authorized view (AGENTS.md "UI consumes use cases, never the ORM").
 */

import Link from "next/link";
import type { DashboardVista } from "../domain/dashboard";
import {
  formatearCantidad,
  formatearEntero,
  formatearMontoDO,
} from "./format";

const CLASE_TILE =
  "rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900";
const CLASE_TITULO = "text-sm font-medium text-zinc-500 dark:text-zinc-400";
const CLASE_VALOR = "mt-1 text-2xl font-semibold text-zinc-900 dark:text-zinc-50";
const CLASE_SUB = "mt-1 text-xs text-zinc-500 dark:text-zinc-400";

export function DashboardKpis({ vista }: { readonly vista: DashboardVista }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {vista.ventasDia !== null && (
        <section className={CLASE_TILE} aria-label="Ventas del día">
          <p className={CLASE_TITULO}>Ventas del día</p>
          <p className={CLASE_VALOR}>{formatearMontoDO(vista.ventasDia.neto)}</p>
          <p className={CLASE_SUB}>
            {formatearEntero(vista.ventasDia.operaciones)} operaciones confirmadas
          </p>
        </section>
      )}

      {vista.ventasMes !== null && (
        <section className={CLASE_TILE} aria-label="Ventas del mes">
          <p className={CLASE_TITULO}>Ventas del mes</p>
          <p className={CLASE_VALOR}>{formatearMontoDO(vista.ventasMes.neto)}</p>
          <p className={CLASE_SUB}>
            {formatearEntero(vista.ventasMes.operaciones)} operaciones confirmadas
          </p>
        </section>
      )}

      {vista.cxC !== null && (
        <section className={CLASE_TILE} aria-label="Cuentas por cobrar">
          <p className={CLASE_TITULO}>CxC — saldo pendiente</p>
          <p className={CLASE_VALOR}>{formatearMontoDO(vista.cxC.saldoTotal)}</p>
          <p className={CLASE_SUB}>
            {formatearEntero(vista.cxC.facturasPendientes)} facturas pendientes
          </p>
        </section>
      )}

      {vista.inventario !== null && (
        <section className={CLASE_TILE} aria-label="Inventario">
          <p className={CLASE_TITULO}>Inventario valorizado</p>
          <p className={CLASE_VALOR}>{formatearMontoDO(vista.inventario.valor)}</p>
          <p className={CLASE_SUB}>
            {formatearCantidad(vista.inventario.unidades)} unidades ·{" "}
            {formatearEntero(vista.inventario.bajoStock)} bajo stock ·{" "}
            {formatearEntero(vista.inventario.agotados)} agotados
          </p>
        </section>
      )}

      {vista.topVendedores !== null && (
        <section
          className={`${CLASE_TILE} sm:col-span-2 lg:col-span-3`}
          aria-label="Productos más vendidos"
        >
          <p className={CLASE_TITULO}>Productos más vendidos (mes)</p>
          {vista.topVendedores.length === 0 ? (
            <p className={CLASE_SUB}>Sin ventas confirmadas en el período.</p>
          ) : (
            <table className="mt-3 w-full text-left text-sm">
              <thead className="text-zinc-500 dark:text-zinc-400">
                <tr>
                  <th className="py-1 font-medium">Producto</th>
                  <th className="py-1 text-right font-medium">Unidades</th>
                  <th className="py-1 text-right font-medium">Monto</th>
                </tr>
              </thead>
              <tbody>
                {vista.topVendedores.map((p) => (
                  <tr key={p.productoId} className="border-t border-zinc-100 dark:border-zinc-800">
                    <td className="py-1 text-zinc-900 dark:text-zinc-50">{p.nombre}</td>
                    <td className="py-1 text-right text-zinc-700 dark:text-zinc-300">
                      {formatearCantidad(p.unidades)}
                    </td>
                    <td className="py-1 text-right text-zinc-700 dark:text-zinc-300">
                      {formatearMontoDO(p.monto)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      <div className="sm:col-span-2 lg:col-span-3">
        <Link
          href="/reportes"
          className="inline-flex items-center justify-center rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          Ir a Reportes →
        </Link>
      </div>
    </div>
  );
}
