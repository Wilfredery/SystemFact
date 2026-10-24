"use client";

/**
 * "Mis borradores" list (spec R-V14, fase-5c slice): the acting user's own
 * BORRADOR drafts AND CONFIRMADA rows with their emitted NCF. Draft rows keep
 * load/edit, cancel and the fase-5c CONFIRM control (single-shot: disabled while
 * a confirm is in flight so a double-click never consumes twice, R-V15).
 * CONFIRMADA rows render their NCF, the return control and — for admin
 * sessions only — a `Void sale` control that opens the mandatory-reason Dialog
 * (R-V24, D5); the Dialog submit routes to `cancelarVentaAction` and the row
 * leaves the list. CONFIRMADA rows lose ALL draft affordances (no edit, no
 * confirm, no draft-cancel — a confirmed sale is no longer a draft). In-place
 * edit is offered only for zero-discount drafts (see `PosScreen.cargarBorrador`
 * — a persisted `PORCENTAJE` discount is not recoverable, ADR-018).
 */

import { ESTADO_VENTA, type EstadoVenta } from "../domain/venta";
import { DevolverButton } from "@/modules/devolucion/ui/DevolverButton";
import { formatearFechaSD, formatearMonto } from "@/shared/ui/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

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
  puedeAnular,
  onLoad,
  onCancel,
  onConfirm,
  onAnular,
}: {
  readonly items: readonly BorradorFila[];
  readonly cargando: boolean;
  readonly editandoId: number | null;
  /** Sale id whose confirm is in flight; its button is disabled (single-shot). */
  readonly confirmandoId: number | null;
  /** UI gate only (D5): non-admin sessions never see the Void control; the
   * server action's role path stays the real authorization (R-V16). */
  readonly puedeAnular: boolean;
  readonly onLoad: (id: number) => void;
  readonly onCancel: (id: number) => void;
  readonly onConfirm: (id: number) => void;
  /** Opens the mandatory-reason void Dialog (R-V24); never cancels directly. */
  readonly onAnular: (id: number) => void;
}) {
  return (
    <Card aria-label="My drafts">
      <CardHeader>
        <CardTitle className="text-sm font-semibold">My drafts</CardTitle>
      </CardHeader>
      <CardContent>
        {cargando && <p className="text-sm text-ink-muted">Loading…</p>}
        {!cargando && items.length === 0 && (
          <p className="text-sm text-ink-muted">No saved drafts yet.</p>
        )}
        {!cargando && items.length > 0 && (
          <ul className="divide-y divide-line">
            {items.map((d) => {
              // A discounted draft is view/cancel only (see `cargarBorrador`).
              const editable = d.descuento === DESCUENTO_CERO_MONEY;
              const esBorrador = d.estado === ESTADO_VENTA.BORRADOR;
              return (
                <li
                  key={d.id}
                  data-testid={`venta-fila-${d.id}`}
                  className="flex items-center justify-between gap-4 py-2"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-ink">
                      {esBorrador ? (
                        <>#{d.id} · {d.clienteNombre} · {formatearMonto(d.total)}</>
                      ) : (
                        <>
                          #{d.id} · <Badge variant="default">CONFIRMADA</Badge>
                          {d.ncf !== null && (
                            <span className="ml-1 font-mono text-xs text-ink-muted">
                              NCF {d.ncf}
                            </span>
                          )}
                          {" · "}{formatearMonto(d.total)}
                        </>
                      )}
                    </p>
                    <p className="text-xs text-ink-muted">
                      {formatearFechaSD(d.fecha)} · {d.usuarioNombre}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    {esBorrador ? (
                      <>
                        <Button
                          type="button"
                          variant="outline"
                          size="pos"
                          onClick={() => onLoad(d.id)}
                          disabled={!editable || editandoId === d.id}
                          aria-label={`Edit draft ${d.id}`}
                          title={editable ? undefined : "Discounted drafts cannot be re-edited here"}
                        >
                          {editandoId === d.id ? "Editing" : "Edit"}
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="pos"
                          className="text-danger"
                          onClick={() => onCancel(d.id)}
                          aria-label={`Cancel draft ${d.id}`}
                        >
                          Cancel
                        </Button>
                        <Button
                          type="button"
                          size="pos"
                          onClick={() => onConfirm(d.id)}
                          disabled={confirmandoId === d.id}
                          aria-label={`Confirm draft ${d.id}`}
                        >
                          {confirmandoId === d.id ? "Confirming…" : "Confirm"}
                        </Button>
                      </>
                    ) : (
                      <>
                        <DevolverButton ventaId={d.id} />
                        {puedeAnular && (
                          <Button
                            type="button"
                            variant="outline"
                            size="pos"
                            className="text-danger"
                            onClick={() => onAnular(d.id)}
                            aria-label={`Void sale ${d.id}`}
                            title="Void the sale and annul (anular) its fiscal invoice"
                          >
                            Void sale
                          </Button>
                        )}
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
