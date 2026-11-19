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
import { formatearFechaSD, formatearMonto } from "@/shared/ui/format";

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
    return <p className="text-sm text-ink-muted">Cargando recibo…</p>;
  }
  if (error !== null || recibo === null) {
    return (
      <div className="flex flex-col gap-3">
        <p role="alert" className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
          {error ?? "Recibo no encontrado."}
        </p>
        <Link
          href="/cobros/cxc-board"
          className="text-xs text-link hover:underline"
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
          className="rounded border border-line px-2 py-1 text-xs font-medium text-ink"
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
          className="rounded bg-accent px-3 py-1.5 text-xs font-semibold text-accent-fg"
        >
          Imprimir
        </button>
      </div>

      <article
        data-testid="recibo-reprint"
        className="rounded-lg border border-line bg-surface p-6"
      >
        <header className="border-b border-dashed border-line pb-3">
          <h1 className="text-base font-bold text-ink">
            {recibo.empresaNombre}
          </h1>
          <p className="text-xs text-ink-muted">Recibo de cobro</p>
        </header>

        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-ink-muted">Recibo #</dt>
          <dd data-testid="recibo-correlativo" className="font-mono text-ink">
            {recibo.correlativoRecibo}
          </dd>
          <dt className="text-ink-muted">Fecha</dt>
          <dd className="text-ink">
            {formatearFechaSD(recibo.fecha)}
          </dd>
          <dt className="text-ink-muted">Cliente</dt>
          <dd className="text-ink">{recibo.clienteNombre}</dd>
          <dt className="text-ink-muted">Factura (NCF)</dt>
          <dd className="font-mono text-xs text-ink">
            {recibo.facturaNcf}
          </dd>
          <dt className="text-ink-muted">Concepto</dt>
          <dd className="text-ink">
            {recibo.tipo === "REEMBOLSO" ? "Reembolso" : "Cobro"} · {recibo.metodoPago}
          </dd>
          <dt className="text-ink-muted">Atendió</dt>
          <dd className="text-ink">{recibo.usuarioNombre}</dd>
          <dt className="mt-2 text-base font-semibold text-ink">
            Monto
          </dt>
          <dd
            data-testid="recibo-monto"
            className="mt-2 text-right text-base font-bold text-ink"
          >
            {formatearMonto(recibo.monto)}
          </dd>
        </dl>

        {/* R-C4: this is explicitly NOT a fiscal document. */}
        <p className="mt-4 rounded bg-surface-raised px-3 py-2 text-center text-[11px] uppercase tracking-wide text-ink-muted">
          Documento no fiscal — copia de recibo de cobro
        </p>
      </article>
    </div>
  );
}
