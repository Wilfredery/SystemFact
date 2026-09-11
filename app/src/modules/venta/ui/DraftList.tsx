"use client";

/**
 * "Mis borradores" list (spec R-V14, fase-5c slice): the acting user's own
 * BORRADOR drafts AND CONFIRMADA rows with their emitted NCF. Draft rows keep
 * load/edit, cancel and the fase-5c CONFIRM control (single-shot: disabled while
 * a confirm is in flight so a double-click never consumes twice, R-V15).
 * CONFIRMADA rows render their NCF plus a cancel (608 void) control routed
 * through `cancelarVentaAction`; they lose ALL draft affordances (no edit, no
 * confirm, no draft-cancel — a confirmed sale is no longer a draft). In-place
 * edit is offered only for zero-discount drafts (see `PosScreen.cargarBorrador`
 * — a persisted `PORCENTAJE` discount is not recoverable, ADR-018).
 */

import { ESTADO_VENTA, type EstadoVenta } from "../domain/venta";
import { formatearMonto } from "./carro";
import { formatearFechaSD } from "./fecha";

/** `Decimal(12,2)` canonical zero-discount money (the persisted `descuento`). */
const DESCUENTO_CERO_MONEY = "0.00";

export interface BorradorFila {
  readonly id: number;
  readonly fecha: string;
  readonly estado: EstadoVenta;
  readonly total: string;
  readonly descuento: string;
  readonly clienteNombre: string;
  readonly usuarioNombre: string;
  /** NCF of the emitted invoice — CONFIRMADA rows only. */
  readonly ncf: string | null;
}

export function DraftList({
  items,
  cargando,
  editandoId,
  confirmandoId,
  onLoad,
  onCancel,
  onConfirm,
}: {
  items: readonly BorradorFila[];
  cargando: boolean;
  editandoId: number | null;
  /** Sale id whose confirm is in flight; its button is disabled (single-shot). */
  confirmandoId: number | null;
  onLoad: (id: number) => void;
  onCancel: (id: number) => void;
  onConfirm: (id: number) => void;
}) {
  return (
    <section aria-label="My drafts" className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="mb-3 text-sm font-semibold text-zinc-900 dark:text-zinc-50">My drafts</h2>
      {cargando && <p className="text-sm text-zinc-500">Loading…</p>}
      {!cargando && items.length === 0 && (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">No saved drafts yet.</p>
      )}
      {!cargando && items.length > 0 && (
        <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {items.map((d) => {
            // A discounted draft is view/cancel only (see `cargarBorrador`).
            const editable = d.descuento === DESCUENTO_CERO_MONEY;
            const esBorrador = d.estado === ESTADO_VENTA.BORRADOR;
            return (
              <li
                key={d.id}
                data-testid={`venta-fila-${d.id}`}
                className="flex items-center justify-between gap-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-50">
                    {esBorrador ? (
                      <>#{d.id} · {d.clienteNombre} · RD$ {formatearMonto(d.total)}</>
                    ) : (
                      <>
                        #{d.id} · <span className="font-semibold text-emerald-700 dark:text-emerald-300">CONFIRMADA</span>
                        {d.ncf !== null && (
                          <span className="ml-1 font-mono text-xs text-zinc-600 dark:text-zinc-300">
                            NCF {d.ncf}
                          </span>
                        )}
                        {" · "}RD$ {formatearMonto(d.total)}
                      </>
                    )}
                  </p>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    {formatearFechaSD(d.fecha)} · {d.usuarioNombre}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  {esBorrador ? (
                    <>
                      <button
                        type="button"
                        onClick={() => onLoad(d.id)}
                        disabled={!editable || editandoId === d.id}
                        aria-label={`Edit draft ${d.id}`}
                        title={editable ? undefined : "Discounted drafts cannot be re-edited here"}
                        className="rounded border border-zinc-300 px-2 py-1 text-xs font-medium text-zinc-700 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300"
                      >
                        {editandoId === d.id ? "Editing" : "Edit"}
                      </button>
                      <button
                        type="button"
                        onClick={() => onCancel(d.id)}
                        aria-label={`Cancel draft ${d.id}`}
                        className="rounded border border-red-300 px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 dark:hover:bg-zinc-800"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={() => onConfirm(d.id)}
                        disabled={confirmandoId === d.id}
                        aria-label={`Confirm draft ${d.id}`}
                        className="rounded border border-emerald-300 px-2 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-emerald-700 dark:text-emerald-300 dark:hover:bg-zinc-800"
                      >
                        {confirmandoId === d.id ? "Confirming…" : "Confirm"}
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onCancel(d.id)}
                      aria-label={`Cancel sale ${d.id}`}
                      title="Cancel the sale and void (anular) its fiscal invoice"
                      className="rounded border border-red-300 px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 dark:hover:bg-zinc-800"
                    >
                      Cancel sale
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}