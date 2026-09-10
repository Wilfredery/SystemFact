"use client";

/**
 * "Mis borradores" list (spec R-V14): the user's own BORRADOR drafts with
 * load/edit and cancel actions wired to the PR-2 server actions. There is
 * deliberately NO confirm button: confirmation, NCF consumption and inventory
 * debit are reserved for fase 5c. In-place edit is offered only for
 * zero-discount drafts (see `PosScreen.cargarBorrador` — a persisted
 * `PORCENTAJE` discount is not recoverable, ADR-018).
 */

import type { EstadoVenta } from "../domain/venta";
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
}

export function DraftList({
  items,
  cargando,
  editandoId,
  onLoad,
  onCancel,
}: {
  items: readonly BorradorFila[];
  cargando: boolean;
  editandoId: number | null;
  onLoad: (id: number) => void;
  onCancel: (id: number) => void;
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
            return (
              <li key={d.id} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-50">
                    #{d.id} · {d.clienteNombre} · RD$ {formatearMonto(d.total)}
                  </p>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    {formatearFechaSD(d.fecha)} · {d.usuarioNombre}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
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
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
