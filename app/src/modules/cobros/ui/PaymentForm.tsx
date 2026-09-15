"use client";

/**
 * Cobros payment form (fase-6 PR-4, spec R-C7 / R-C1 / R-C2).
 *
 * A single-invoice collection widget mounted inline on a board/estado-de-cuenta
 * row. It owns ONLY presentation + the transport contract:
 *   • it validates the payload with the SHARED `zRegistrarCobroInput` schema the
 *     action itself uses (one transport grammar, no duplication), so an empty or
 *     malformed amount is rejected with `VALIDATION_ERROR` BEFORE any call;
 *   • the submit control is DISABLED ON THE FIRST CLICK — the button is disabled
 *     while `enviando`, AND `enviar()` early-returns on a same-render-cycle double
 *     event — so a rapid double-click can never fire two collections;
 *   • it then delegates to `registrarCobroAction`, which ALWAYS revalidates
 *     everything server-side (tenant + VIGENTE invoice + row-locked in-transaction
 *     balance recompute + `COBRO_EXCEDE_SALDO` guard) inside `withTenantTransaction`.
 *
 * NO balance, money or authorization decision lives here (ADR-013): the client can
 * type any amount, and the server is the sole authority that rejects an over-payment
 * or a non-current invoice. The success surface shows the issued (non-fiscal) receipt
 * number and the new derived pending balance; the error surface shows the cobros
 * catalog's stable code + user message verbatim, never a stack trace or a Prisma
 * internal.
 */

import { useState } from "react";
import Link from "next/link";
import { registrarCobroAction } from "@/modules/cobros/http/actions";
import { zRegistrarCobroInput, VALIDATION_ERROR } from "@/modules/cobros/http/validations";
import { formatearMontoDO } from "./format";

type Mensaje =
  | { readonly kind: "ok"; readonly text: string }
  | { readonly kind: "error"; readonly code: string; readonly text: string }
  | null;

export function PaymentForm({
  facturaId,
  saldoPendiente,
  onCobrado,
  onCerrar,
}: {
  readonly facturaId: number;
  /** The derived pending balance to prefill a full payment (`Decimal(12,2)` string). */
  readonly saldoPendiente: string;
  /** Notified after a committed collection so the parent can reload the canonical view. */
  readonly onCobrado: () => void;
  readonly onCerrar: () => void;
}) {
  // Prefill a full collection; the user can lower it to register an abono (R-C1).
  const [monto, setMonto] = useState(saldoPendiente);
  const [enviando, setEnviando] = useState(false);
  const [mensaje, setMensaje] = useState<Mensaje>(null);
  // The receipt number of the last committed collection (links to its reprint page).
  const [reciboEmitido, setReciboEmitido] = useState<number | null>(null);

  async function enviar(): Promise<void> {
    // Single-flight guard (belt-and-braces with the disabled button below): a
    // second event in the SAME render cycle must never fire a second collection.
    if (enviando) return;

    const cuerpo = { facturaId, monto: monto.trim() };
    const parsed = zRegistrarCobroInput.safeParse(cuerpo);
    if (!parsed.success) {
      setMensaje({
        kind: "error",
        code: VALIDATION_ERROR,
        text: "Ingresa un monto válido mayor que cero.",
      });
      return;
    }

    // Disable on FIRST click (R-C7 non-droppable line): flips `enviando` before the
    // await so the button is already disabled when the second click can land.
    setEnviando(true);
    setMensaje(null);
    const r = await registrarCobroAction(parsed.data);
    if (r.ok) {
      setReciboEmitido(r.data.correlativoRecibo);
      setMensaje({
        kind: "ok",
        text: `Cobro registrado. Nuevo saldo: ${formatearMontoDO(r.data.saldoPendiente)}.`,
      });
      onCobrado();
    } else {
      setMensaje({ kind: "error", code: r.error.code, text: r.error.message });
    }
    setEnviando(false);
  }

  return (
    <div
      data-testid={`cobro-form-${facturaId}`}
      className="mt-2 rounded-md border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-700 dark:bg-zinc-800"
    >
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-xs font-semibold text-zinc-900 dark:text-zinc-50">
          Registrar cobro · Factura #{facturaId}
        </h4>
        <button
          type="button"
          onClick={onCerrar}
          disabled={enviando}
          aria-label={`Cerrar cobro factura ${facturaId}`}
          className="rounded border border-zinc-300 px-2 py-0.5 text-xs text-zinc-600 disabled:opacity-50 dark:border-zinc-600 dark:text-zinc-300"
        >
          Cerrar
        </button>
      </div>

      {mensaje !== null && (
        <p
          role="status"
          aria-live="polite"
          className={
            mensaje.kind === "ok"
              ? "mt-2 rounded-md bg-emerald-50 px-3 py-2 text-xs text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"
              : "mt-2 rounded-md bg-red-50 px-3 py-2 text-xs text-red-800 dark:bg-red-950 dark:text-red-200"
          }
        >
          {mensaje.kind === "error" && (
            <span className="mr-2 font-mono text-xs">[{mensaje.code}]</span>
          )}
          {mensaje.text}
        </p>
      )}

      {mensaje?.kind === "ok" && reciboEmitido !== null && (
        <Link
          href={`/cobros/recibo/${reciboEmitido}`}
          data-testid={`recibo-reprint-link-${reciboEmitido}`}
          aria-label={`Reimprimir recibo ${reciboEmitido}`}
          className="mt-1 inline-block text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400"
        >
          Ver / reimprimir recibo #{reciboEmitido} (no fiscal)
        </Link>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void enviar();
        }}
        className="mt-2 flex items-end gap-2"
      >
        <label className="flex flex-col text-xs font-medium text-zinc-700 dark:text-zinc-300">
          Monto (RD$)
          <input
            value={monto}
            inputMode="decimal"
            disabled={enviando}
            aria-label={`Monto de cobro para factura ${facturaId}`}
            onChange={(e) => setMonto(e.target.value)}
            className="mt-1 w-40 rounded border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
        </label>
        <button
          type="submit"
          // R-C7: disabled on the FIRST click (and while in flight) — a double
          // click must never register two collections; the server revalidates all.
          disabled={enviando}
          aria-label={`Confirmar cobro factura ${facturaId}`}
          className="rounded bg-emerald-600 px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {enviando ? "Registrando…" : "Cobrar"}
        </button>
      </form>
    </div>
  );
}
