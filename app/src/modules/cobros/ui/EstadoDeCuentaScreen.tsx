"use client";

/**
 * Customer estado de cuenta (fase-6 PR-4, spec R-C7 / R-B1).
 *
 * One customer's statement: their VIGENTE receivables with total, applied cobros,
 * pending balance and the DERIVED payment state. Every number is read from the SAME
 * single canonical `consultarSaldoCxcAction` the board uses and then narrowed to the
 * given customer client-side — there is no per-customer balance query and nothing is
 * cached (ADR-017: a re-open always shows the latest committed payment). The only
 * thing this view adds over the board is the inclusion of fully settled (`PAGADA`)
 * invoices, because a statement lists the whole account, not just what is collectable.
 *
 * Client island for the fetch + inline collection only; it computes NO money.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { Decimal } from "decimal.js";
import { consultarSaldoCxcAction } from "@/modules/cobros/http/actions";
import type { SaldoCxCVista } from "@/modules/cobros/application/consultar-saldo-cxc";
import type { EstadoPagoDerivado } from "@/modules/cobros/domain/pago";
import { formatearFechaDO, formatearMontoDO } from "./format";
import { PaymentForm } from "./PaymentForm";

const ETIQUETA_ESTADO: Record<EstadoPagoDerivado, string> = {
  PENDIENTE: "Pendiente",
  PARCIAL: "Parcial",
  PAGADA: "Pagada",
};

const CLASE_ESTADO: Record<EstadoPagoDerivado, string> = {
  PENDIENTE: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  PARCIAL: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  PAGADA: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
};

export function EstadoDeCuentaScreen({ clienteId }: { readonly clienteId: number }) {
  const [filas, setFilas] = useState<readonly SaldoCxCVista[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [abierto, setAbierto] = useState<number | null>(null);

  function aplicar(r: Awaited<ReturnType<typeof consultarSaldoCxcAction>>): void {
    if (r.ok) {
      setFilas(r.data);
      setError(null);
    } else {
      setError(`[${r.error.code}] ${r.error.message}`);
    }
    setCargando(false);
  }

  // Reload after a committed collection (a normal handler call, not in an effect).
  async function recargar(): Promise<void> {
    aplicar(await consultarSaldoCxcAction({}));
  }

  // The mount fetch settles state from the action's resolution callback (an
  // external-system boundary), never synchronously in the effect body.
  useEffect(() => {
    void consultarSaldoCxcAction({}).then(aplicar);
  }, []);

  // Narrow the canonical set to this customer; the aggregate is the only data
  // source, so a foreign clienteId simply yields an empty statement (never a leak —
  // the read is already tenant-scoped by the action's RLS GUCs).
  const cuentas = filas.filter((f) => f.clienteId === clienteId);
  // Sum the derived pending balances with `decimal.js` (never a float — AGENTS.md
  // "Money = Decimal"); a display aggregate of already-derived facts.
  const totalPend = cuentas
    .reduce((acc, c) => acc.plus(new Decimal(c.saldoPendiente)), new Decimal(0))
    .toFixed(2);

  if (cargando) {
    return <p className="text-sm text-zinc-500">Cargando estado de cuenta…</p>;
  }
  if (error !== null) {
    return (
      <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">
        {error}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
          Estado de cuenta · Cliente #{clienteId}
        </h1>
        <Link
          href="/cobros/cxc-board"
          className="rounded border border-zinc-300 px-2 py-1 text-xs font-medium text-zinc-700 dark:border-zinc-700 dark:text-zinc-300"
        >
          Volver al tablero
        </Link>
      </header>

      {cuentas.length === 0 ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Sin facturas vigentes para este cliente.
        </p>
      ) : (
        <>
          <p
            data-testid="estado-cuenta-pendiente-total"
            className="text-sm text-zinc-700 dark:text-zinc-200"
          >
            Saldo total pendiente:{" "}
            <span className="font-semibold">{formatearMontoDO(totalPend)}</span>
          </p>
          <ul className="divide-y divide-zinc-100 rounded-lg border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
            {cuentas.map((f) => {
              const pagada = f.estadoPago === "PAGADA";
              return (
                <li
                  key={f.facturaId}
                  data-testid={`estado-cuenta-fila-${f.facturaId}`}
                  className="px-4 py-3"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-50">
                        Factura #{f.facturaId} · Total {formatearMontoDO(f.total)}
                      </p>
                      <p className="text-xs text-zinc-500 dark:text-zinc-400">
                        Cobros aplicados {formatearMontoDO(f.cobrosAplicados)} · Pendiente{" "}
                        {formatearMontoDO(f.saldoPendiente)} ·{" "}
                        <span className={`rounded px-1.5 py-0.5 font-medium ${CLASE_ESTADO[f.estadoPago]}`}>
                          {f.enMora ? "En mora" : ETIQUETA_ESTADO[f.estadoPago]}
                        </span>
                        {" · Vence "}
                        {formatearFechaDO(f.vencimiento)}
                      </p>
                    </div>
                    {!pagada && (
                      <button
                        type="button"
                        onClick={() => setAbierto(abierto === f.facturaId ? null : f.facturaId)}
                        aria-label={`Cobrar factura ${f.facturaId}`}
                        aria-expanded={abierto === f.facturaId}
                        className="shrink-0 rounded border border-emerald-300 px-2 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-50 dark:border-emerald-700 dark:text-emerald-300 dark:hover:bg-zinc-800"
                      >
                        {abierto === f.facturaId ? "Ocultar" : "Cobrar"}
                      </button>
                    )}
                  </div>
                  {abierto === f.facturaId && !pagada && (
                    <PaymentForm
                      facturaId={f.facturaId}
                      saldoPendiente={f.saldoPendiente}
                      onCobrado={recargar}
                      onCerrar={() => setAbierto(null)}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
