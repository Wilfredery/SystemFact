"use client";

/**
 * Shared payment-confirmation modal (board 03 S15 — wireframe
 * `03-Modal-Confirmar-Pago`).
 *
 * ONE payment surface for the whole Cobros module: the board's inline `Cobrar`
 * affordance, the per-invoice `Registrar Pago` panel and the customer statement
 * all open THIS F0 `Dialog`, so the modal content, the amount entry and the
 * single-flight guard cannot drift between screens.
 *
 * What it owns (and what it deliberately never owns):
 *   • the wireframe content — Monto del pago, Saldo pendiente note, Método de pago
 *     (FROZEN `EFECTIVO` display, no selector: V1 schema `MetodoPago`), the
 *     optional Fecha del pago and Referencia (S14) and `Confirmar Pago`;
 *   • amount entry through the SHARED `NumericKeypad` (touch-first, board-02 S2
 *     precedent): focusing the monto input retargets the keypad, exactly like
 *     `PosScreen`, and the quick-amounts row (`MontosRapidos`, reused from
 *     `venta/ui/Totales`) makes an exact payment one tap;
 *   • the composition through the SAME `componerValor` parser the POS uses, so
 *     `Decimal(12,2)` grammar has one implementation in the codebase;
 *   • transport validation with the SHARED `zRegistrarCobroInput`, the payload
 *     grammar the action itself applies;
 *   • the first-click disable (button disabled while `enviando` + a same-render
 *     early return), so a rapid double click can never fire two collections.
 *
 * CONFIRMATION IS FISCAL, NOT VISUAL: opening the modal confirms nothing. The
 * server remains the authority — `registrarCobroAction` revalidates tenant,
 * VIGENTE invoice, the row-locked balance, the SD payment-date band (S14) and
 * records the audit row inside `withTenantTransaction`. The success feedback is
 * inline (new derived balance + the non-fiscal receipt link); the error surface
 * shows the cobros catalog's stable code + message verbatim, never a stack trace.
 *
 * Token classes only (S16): no raw palette, no `dark:` overrides.
 */

import { useState } from "react";
import Link from "next/link";
import { registrarCobroAction } from "@/modules/cobros/http/actions";
import {
  zRegistrarCobroInput,
  VALIDATION_ERROR,
} from "@/modules/cobros/http/validations";
import { hoyEnSD } from "@/modules/cobros/domain/fecha-cobro";
import { METODO_PAGO } from "@/modules/cobros/domain/pago";
import { formatearMonto } from "@/shared/ui/format";
import { MontosRapidos } from "@/modules/venta/ui/Totales";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NumericKeypad, type TeclaNumerica } from "@/components/ui/numeric-keypad";
import { componerValor } from "@/modules/venta/ui/carro";

type Mensaje =
  | { readonly kind: "ok"; readonly text: string }
  | { readonly kind: "error"; readonly code: string; readonly text: string }
  | null;

/** Today in `America/Santo_Domingo` — the S14 default Fecha del pago. */
function fechaDeHoySD(): string {
  return hoyEnSD(new Date());
}

export function ModalRegistrarPago({
  abierto,
  facturaId,
  saldoPendiente,
  onCerrar,
  onCobrado,
}: {
  readonly abierto: boolean;
  readonly facturaId: number;
  /** The derived pending balance to prefill a full payment (`Decimal(12,2)`). */
  readonly saldoPendiente: string;
  readonly onCerrar: () => void;
  /** Notified after a committed collection so the parent reloads the canonical view. */
  readonly onCobrado?: () => Promise<void> | void;
}) {
  // Prefill a full collection; the user can lower it to register an abono (R-C1).
  const [monto, setMonto] = useState(saldoPendiente);
  const [fechaCobro, setFechaCobro] = useState(fechaDeHoySD);
  const [referencia, setReferencia] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [mensaje, setMensaje] = useState<Mensaje>(null);
  // The receipt number of the last committed collection (links to its reprint page).
  const [reciboEmitido, setReciboEmitido] = useState<number | null>(null);
  // Which field the SHARED keypad edits (D4/R-V23 retarget semantics): the monto
  // input on focus, nothing while the user types the date/reference.
  const [tecladoActivo, setTecladoActivo] = useState(true);
  // Reopening the modal starts a clean collection attempt (never the previous
  // attempt's amount or message). Adjusting state during render is the React
  // pattern for "reset on prop change" — no effect, no extra render pass.
  const [abiertoPrevio, setAbiertoPrevio] = useState(false);
  if (abierto !== abiertoPrevio) {
    setAbiertoPrevio(abierto);
    if (abierto) {
      setMonto(saldoPendiente);
      setFechaCobro(fechaDeHoySD());
      setReferencia("");
      setMensaje(null);
      setReciboEmitido(null);
      setEnviando(false);
      setTecladoActivo(true);
    }
  }

  function aplicarTecla(tecla: TeclaNumerica): void {
    setMonto((prev) => componerValor(prev, tecla, 2));
  }

  async function enviar(): Promise<void> {
    // Single-flight guard (belt-and-braces with the disabled button): a second
    // event in the SAME render cycle must never fire a second collection.
    if (enviando) return;

    // The reference rides the payload ONLY when it carries text: a blank field is
    // "no reference", not an empty-string column value.
    const conReferencia = referencia.trim();
    const parsed = zRegistrarCobroInput.safeParse(
      conReferencia === ""
        ? { facturaId, monto: monto.trim(), fechaCobro }
        : { facturaId, monto: monto.trim(), fechaCobro, referencia: conReferencia },
    );
    if (!parsed.success) {
      setMensaje({
        kind: "error",
        code: VALIDATION_ERROR,
        text: "Ingresa un monto válido mayor que cero.",
      });
      return;
    }

    // Disable on the FIRST click (R-C7 non-droppable line): flips `enviando` before
    // the await so the button is already disabled when the second click can land.
    setEnviando(true);
    setMensaje(null);
    const r = await registrarCobroAction(parsed.data);
    if (r.ok) {
      setReciboEmitido(r.data.correlativoRecibo);
      setMensaje({
        kind: "ok",
        text: `Pago registrado. Nuevo saldo: ${formatearMonto(r.data.saldoPendiente)}.`,
      });
      await onCobrado?.();
    } else {
      setMensaje({ kind: "error", code: r.error.code, text: r.error.message });
    }
    setEnviando(false);
  }

  return (
    <Dialog
      open={abierto}
      onOpenChange={(open) => {
        // JD-A remediation: Escape/overlay close is BLOCKED while a confirm is
        // in flight — closing would reset `enviando` and let a second Confirm
        // fire a second COBRO while the first is still pending.
        if (!open && !enviando) onCerrar();
      }}
    >
      <DialogContent
        data-testid={`modal-cobro-${facturaId}`}
        aria-label={`Confirmar pago factura ${facturaId}`}
        // The keypad + quick-amounts content can exceed a short viewport: the
        // panel itself must scroll or Confirmar Pago is unreachable (e2e
        // screenshot proof, cobros.spec.ts:208).
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto"
      >
        <DialogHeader>
          <DialogTitle>Confirmar Pago</DialogTitle>
          <DialogDescription>
            Factura #{facturaId} · el saldo se recalcula con la consulta canónica
            al confirmar.
          </DialogDescription>
        </DialogHeader>

        {mensaje !== null && (
          <p
            role="status"
            aria-live="polite"
            className={
              mensaje.kind === "ok"
                ? "rounded-md bg-success-bg px-3 py-2 text-xs text-ink"
                : "rounded-md bg-danger/10 px-3 py-2 text-xs text-danger"
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
            data-testid={`cobro-recibo-link-${reciboEmitido}`}
            aria-label={`Reimprimir recibo ${reciboEmitido}`}
            className="text-xs font-medium text-link hover:underline"
          >
            Ver / reimprimir recibo #{reciboEmitido} (no fiscal)
          </Link>
        )}

        <div className="flex flex-col gap-1">
          <Label htmlFor={`cobro-monto-${facturaId}`}>Monto del pago (RD$)</Label>
          <Input
            id={`cobro-monto-${facturaId}`}
            value={monto}
            inputMode="decimal"
            disabled={enviando}
            aria-label={`Monto del pago factura ${facturaId}`}
            onFocus={() => setTecladoActivo(true)}
            onChange={(e) => setMonto(e.target.value)}
            className="max-w-48"
          />
        </div>

        <p
          data-testid={`cobro-saldo-pendiente-${facturaId}`}
          className="text-sm text-ink-muted"
        >
          Saldo pendiente:{" "}
          <span className="font-medium tabular-nums text-ink">
            {formatearMonto(saldoPendiente)}
          </span>
        </p>

        <div className="flex flex-col gap-1 text-sm text-ink">
          <span className="text-xs text-ink-muted">Método de pago</span>
          {/* V1 exposes EFECTIVO only: a frozen display, never a selector. */}
          <span
            data-testid={`cobro-metodo-pago-${facturaId}`}
            className="text-sm font-medium text-ink"
          >
            {METODO_PAGO.EFECTIVO}
          </span>
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor={`cobro-fecha-${facturaId}`}>Fecha del pago</Label>
          <Input
            id={`cobro-fecha-${facturaId}`}
            type="date"
            value={fechaCobro}
            disabled={enviando}
            aria-label={`Fecha del pago factura ${facturaId}`}
            onFocus={() => setTecladoActivo(false)}
            onChange={(e) => setFechaCobro(e.target.value)}
            className="max-w-48"
          />
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor={`cobro-referencia-${facturaId}`}>
            Referencia (opcional)
          </Label>
          <Input
            id={`cobro-referencia-${facturaId}`}
            value={referencia}
            maxLength={80}
            disabled={enviando}
            aria-label={`Referencia factura ${facturaId}`}
            onFocus={() => setTecladoActivo(false)}
            onChange={(e) => setReferencia(e.target.value)}
          />
        </div>

        <MontosRapidos onSeleccion={(v) => setMonto(v)} total={saldoPendiente} />

        {tecladoActivo && (
          <NumericKeypad
            onTecla={aplicarTecla}
            ariaLabel={`Teclado numérico pago factura ${facturaId}`}
            className="max-w-64"
          />
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={enviando}
            onClick={onCerrar}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            // R-C7: disabled on the FIRST click (and while in flight) — a double
            // click must never register two collections; the server revalidates all.
            disabled={enviando}
            aria-label={`Confirmar pago factura ${facturaId}`}
            onClick={() => void enviar()}
          >
            {enviando ? "Registrando…" : "Confirmar Pago"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
