"use client";

/**
 * Receipt reprint screen (fase-6 PR-4, spec R-C4).
 *
 * Shows a persisted, PRINTABLE receipt identified by its company-serialized
 * `correlativoRecibo`. A receipt is a NON-FISCAL document — it is a copy of a
 * payment already reflected on its VIGENTE invoice; the invoice's own NCF appears
 * for cross-reference only and the screen says so explicitly (R-C4: "Receipts MUST be
 * reprintable and MUST NOT be fiscal documents"). Reprinting NEVER emits a new tax
 * document or a new receipt number.
 *
 * Client island for the fetch + `window.print()` only; the payment facts come from
 * `consultarReciboAction` (the module's thin read adapter), which enforces the
 * tenant/role scope and maps a missing/foreign number to `PAGO_NO_ENCONTRADO`.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { consultarReciboAction } from "@/modules/cobros/http/actions";
import type { ReciboVista } from "@/modules/cobros/application/consultar-recibo";
import { formatearFechaDO, formatearMontoDO } from "./format";

/** ISO/UTC instant → SD calendar date string, reusing the domain date discipline. */
function fechaSDDesdeISO(iso: string): string {
  // Presentation-only: resolve the stored instant to its Santo-Domingo calendar day
  // (no manual hour arithmetic — the Intl formatter owns the conversion).
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Santo_Domingo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

export function ReciboReprintScreen({ correlativo }: { readonly correlativo: number }) {
  const [recibo, setRecibo] = useState<ReciboVista | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  function aplicar(r: Awaited<ReturnType<typeof consultarReciboAction>>): void {
    if (r.ok) {
      setRecibo(r.data);
      setError(null);
    } else {
      setError(`[${r.error.code}] ${r.error.message}`);
    }
    setCargando(false);
  }

  // The mount fetch settles state from the action's resolution callback (an
  // external-system boundary), never synchronously in the effect body.
  useEffect(() => {
    void consultarReciboAction({ correlativoRecibo: correlativo }).then(aplicar);
  }, [correlativo]);

  if (cargando) {
    return <p className="text-sm text-zinc-500">Cargando recibo…</p>;
  }
  if (error !== null || recibo === null) {
    return (
      <div className="flex flex-col gap-3">
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">
          {error ?? "Recibo no encontrado."}
        </p>
        <Link
          href="/cobros/cxc-board"
          className="text-xs text-indigo-600 hover:underline dark:text-indigo-400"
        >
          Volver al tablero
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-md flex-col gap-4">
      <div className="flex items-center justify-between">
        <Link
          href="/cobros/cxc-board"
          className="rounded border border-zinc-300 px-2 py-1 text-xs font-medium text-zinc-700 dark:border-zinc-700 dark:text-zinc-300"
        >
          Volver al tablero
        </Link>
        <button
          type="button"
          onClick={() => {
            // `print` is absent in a non-browser test host; never throw the UI.
            if (typeof window !== "undefined") window.print();
          }}
          aria-label="Imprimir recibo"
          className="rounded bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white"
        >
          Imprimir
        </button>
      </div>

      <article
        data-testid="recibo-reprint"
        className="rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900"
      >
        <header className="border-b border-dashed border-zinc-300 pb-3 dark:border-zinc-700">
          <h1 className="text-base font-bold text-zinc-900 dark:text-zinc-50">
            {recibo.empresaNombre}
          </h1>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">Recibo de cobro</p>
        </header>

        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-zinc-500">Recibo #</dt>
          <dd data-testid="recibo-correlativo" className="font-mono text-zinc-900 dark:text-zinc-50">
            {recibo.correlativoRecibo}
          </dd>
          <dt className="text-zinc-500">Fecha</dt>
          <dd className="text-zinc-900 dark:text-zinc-50">
            {formatearFechaDO(fechaSDDesdeISO(recibo.fecha))}
          </dd>
          <dt className="text-zinc-500">Cliente</dt>
          <dd className="text-zinc-900 dark:text-zinc-50">{recibo.clienteNombre}</dd>
          <dt className="text-zinc-500">Factura (NCF)</dt>
          <dd className="font-mono text-xs text-zinc-900 dark:text-zinc-50">
            {recibo.facturaNcf}
          </dd>
          <dt className="text-zinc-500">Concepto</dt>
          <dd className="text-zinc-900 dark:text-zinc-50">
            {recibo.tipo === "REEMBOLSO" ? "Reembolso" : "Cobro"} · {recibo.metodoPago}
          </dd>
          <dt className="text-zinc-500">Atendió</dt>
          <dd className="text-zinc-900 dark:text-zinc-50">{recibo.usuarioNombre}</dd>
          <dt className="mt-2 text-base font-semibold text-zinc-900 dark:text-zinc-50">
            Monto
          </dt>
          <dd
            data-testid="recibo-monto"
            className="mt-2 text-right text-base font-bold text-zinc-900 dark:text-zinc-50"
          >
            {formatearMontoDO(recibo.monto)}
          </dd>
        </dl>

        {/* R-C4: this is explicitly NOT a fiscal document. */}
        <p className="mt-4 rounded bg-zinc-100 px-3 py-2 text-center text-[11px] uppercase tracking-wide text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
          Documento no fiscal — copia de recibo de cobro
        </p>
      </article>
    </div>
  );
}
