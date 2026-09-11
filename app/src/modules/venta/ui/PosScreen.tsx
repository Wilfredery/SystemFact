"use client";

/**
 * POS screen — fase 5b draft engine + fase 5c confirm control (spec R-V14/R-V15).
 *
 * Ephemeral cart + live fiscal preview computed client-side by the SAME pure
 * domain calculators the server uses; saving delegates to the PR-2 server
 * actions, which always recompute authoritatively inside a tenant transaction.
 * Confirming a BORRADOR (R-V15) flips it to CONFIRMADA and emits its VIGENTE
 * invoice with a consumed NCF; the NCF_UMBRAL_90 threshold renders as a
 * non-blocking banner. The screen still renders NO payment control (Fase 6).
 */

import { useEffect, useMemo, useState } from "react";
import {
  actualizarVentaAction,
  cancelarVentaAction,
  confirmarVentaAction,
  crearVentaAction,
  obtenerVentaAction,
  listarVentasAction,
} from "../http/actions";
import type { StockWarning } from "../domain/errors";
import {
  DESCUENTO_CERO,
  ESTADO_VENTA,
  estadoVentaDesdeDb,
  type Descuento,
} from "../domain/venta";
import {
  CONSUMIDOR_FINAL_LABEL,
  agregarAlCarrito,
  calcularVistaPrevia,
  editarLinea,
  quitarDelCarrito,
  type CarroLinea,
  type SeleccionCliente,
} from "./carro";
import { CartTable } from "./CartTable";
import { ClienteSelector } from "./ClienteSelector";
import { DiscountPanel } from "./DiscountPanel";
import { DraftList, type BorradorFila } from "./DraftList";
import { ProductSearch } from "./ProductSearch";
import { Totales } from "./Totales";

type Mensaje =
  | { kind: "ok"; text: string }
  | { kind: "error"; code: string; text: string }
  | null;

/** A stock warning enriched with the cart product name for display only. */
type AvisoStock = StockWarning & { nombre: string };

export function PosScreen({ esAdmin }: { esAdmin: boolean }) {
  const [lineas, setLineas] = useState<readonly CarroLinea[]>([]);
  const [cliente, setCliente] = useState<SeleccionCliente>({
    id: null,
    nombre: CONSUMIDOR_FINAL_LABEL,
  });
  const [descuento, setDescuento] = useState<Descuento>(DESCUENTO_CERO);
  const [editandoId, setEditandoId] = useState<number | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [confirmandoId, setConfirmandoId] = useState<number | null>(null);
  const [mensaje, setMensaje] = useState<Mensaje>(null);
  const [warnings, setWarnings] = useState<readonly AvisoStock[]>([]);
  const [avisoNcf, setAvisoNcf] = useState<string | null>(null);
  const [borradores, setBorradores] = useState<readonly BorradorFila[]>([]);
  const [listaCargando, setListaCargando] = useState(true);

  const vista = useMemo(
    () => calcularVistaPrevia(lineas, descuento),
    [lineas, descuento],
  );

  function aplicarBorradores(
    r: Awaited<ReturnType<typeof listarVentasAction>>,
  ): void {
    if (r.ok) {
      // Map the raw DB state through the fail-loud domain mapper (never trust a
      // bare string) before the enum compare — spec R-V13. The list keeps
      // BORRADOR (draft engine) AND CONFIRMADA (5c confirm seam) rows and drops
      // CANCELADA rows: a cancelled sale has no actionable state in the POS.
      setBorradores(
        r.data.items
          .map((i) => ({ ...i, estado: estadoVentaDesdeDb(i.estado) }))
          .filter(
            (i) =>
              i.estado === ESTADO_VENTA.BORRADOR ||
              i.estado === ESTADO_VENTA.CONFIRMADA,
          ),
      );
    }
    setListaCargando(false);
  }

  async function recargarBorradores(): Promise<void> {
    aplicarBorradores(await listarVentasAction({ page: 1, limit: 25, soloMios: true }));
  }

  // The mount fetch settles state from the action's resolution callback (an
  // external-system boundary), never synchronously in the effect body
  // (`react-hooks/set-state-in-effect`). `listaCargando` starts true.
  useEffect(() => {
    void listarVentasAction({ page: 1, limit: 25, soloMios: true }).then(aplicarBorradores);
  }, []);

  async function guardar() {
    if (lineas.length === 0) return;
    setGuardando(true);
    setMensaje(null);
    const nombres = new Map(lineas.map((l) => [l.productoId, l.nombre]));
    const fecha = new Date().toISOString();
    const cuerpo = {
      clienteId: cliente.id,
      fecha,
      lineas: lineas.map((l) => ({
        productoId: l.productoId,
        cantidad: l.cantidad,
        precioUnitario: l.precioUnitario,
      })),
      descuentoCabecera: descuento,
    };
    const r =
      editandoId === null
        ? await crearVentaAction(cuerpo)
        : await actualizarVentaAction({ ...cuerpo, id: editandoId });

    if (r.ok) {
      const avisos = r.warnings ?? [];
      setWarnings(
        avisos.map((w) => ({ ...w, nombre: nombres.get(w.productoId) ?? `#${w.productoId}` })),
      );
      setMensaje({
        kind: "ok",
        text:
          editandoId === null
            ? `Draft #${r.data.id} saved. Review it in "My drafts".`
            : `Draft #${r.data.id} updated.`,
      });
      setLineas([]);
      setDescuento(DESCUENTO_CERO);
      setCliente({ id: null, nombre: CONSUMIDOR_FINAL_LABEL });
      setEditandoId(null);
      void recargarBorradores();
    } else {
      setMensaje({ kind: "error", code: r.error.code, text: r.error.message });
    }
    setGuardando(false);
  }

  async function cargarBorrador(id: number) {
    const r = await obtenerVentaAction({ id });
    if (!r.ok) {
      setMensaje({ kind: "error", code: r.error.code, text: r.error.message });
      return;
    }
    const d = r.data;
    // ADR-018 / R-V7: a persisted discount stores only its RESOLVED MONEY — a
    // `PORCENTAJE` authorization's original percentage is not recoverable from
    // the DTO. Re-entering a non-zero discount as `MONTO` would silently change
    // the frozen `descuentoTipo`, so in-place editing is offered ONLY for
    // zero-discount drafts (`"0.00"` is the canonical stored zero). Discounted
    // drafts are view/cancel only in 5b.
    if (d.descuento !== "0.00") {
      setMensaje({
        kind: "error",
        code: "EDICION_DESCUENTO_NO_DISPONIBLE",
        text: "Drafts with a discount cannot be re-edited here (the percentage is not recoverable); cancel and recreate instead.",
      });
      return;
    }
    setLineas(
      d.lineas.map((l) => ({
        productoId: l.productoId,
        codigo: `#${l.productoId}`,
        nombre: l.productoNombre,
        cantidad: l.cantidad,
        precioUnitario: l.precioUnitario,
        tasaItbis: l.tasaItbis,
      })),
    );
    // Zero-discount drafts round-trip faithfully as the canonical zero.
    setDescuento(DESCUENTO_CERO);
    setCliente({ id: d.clienteId, nombre: d.clienteNombre });
    setEditandoId(d.id);
    setMensaje({ kind: "ok", text: `Editing draft #${d.id}.` });
  }

  async function cancelarBorrador(id: number) {
    const r = await cancelarVentaAction({ id });
    if (!r.ok) {
      setMensaje({ kind: "error", code: r.error.code, text: r.error.message });
      return;
    }
    setMensaje({ kind: "ok", text: `Sale #${id} cancelled.` });
    void recargarBorradores();
  }

  async function confirmarBorrador(id: number) {
    // Single-flight guard: the button is also disabled, but a double event in
    // the same render cycle must never fire a second consume (R-V15).
    if (confirmandoId !== null) return;
    setConfirmandoId(id);
    setMensaje(null);
    setAvisoNcf(null);
    const r = await confirmarVentaAction({ id });
    if (r.ok) {
      setMensaje({
        kind: "ok",
        text: `Sale #${r.data.id} confirmed — invoice ${r.data.ncf}.`,
      });
      if (r.data.ncfWarning !== null) setAvisoNcf(r.data.ncfWarning);
      void recargarBorradores();
    } else {
      setMensaje({ kind: "error", code: r.error.code, text: r.error.message });
    }
    setConfirmandoId(null);
  }

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4 md:p-6">
      <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
        Point of sale
      </h1>
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        Build a cart and save it as a draft, then confirm it to emit its fiscal
        invoice (NCF). Payments arrive in a later phase.
      </p>

      {mensaje !== null && (
        <p
          role="status"
          aria-live="polite"
          className={
            mensaje.kind === "ok"
              ? "rounded-lg bg-emerald-50 px-4 py-2 text-sm text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"
              : "rounded-lg bg-red-50 px-4 py-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-200"
          }
        >
          {mensaje.kind === "error" && (
            <span className="mr-2 font-mono text-xs">[{mensaje.code}]</span>
          )}
          {mensaje.text}
        </p>
      )}

      {avisoNcf !== null && (
        <div
          role="alert"
          aria-label="NCF range warning"
          className="rounded-lg border border-amber-300 bg-amber-50 p-4 dark:border-amber-700 dark:bg-amber-950"
        >
          <p className="text-sm font-semibold text-amber-900 dark:text-amber-100">
            NCF range at 90% — {avisoNcf}
          </p>
          <p className="mt-1 text-sm text-amber-800 dark:text-amber-200">
            The current sequence range is nearly exhausted; request a new range
            before confirmation becomes blocked.
          </p>
        </div>
      )}

      {warnings.length > 0 && (
        <div
          role="alert"
          aria-live="assertive"
          className="rounded-lg border border-amber-300 bg-amber-50 p-4 dark:border-amber-700 dark:bg-amber-950"
        >
          <p className="text-sm font-semibold text-amber-900 dark:text-amber-100">
            Insufficient stock (warning — the draft was still saved)
          </p>
          <ul className="mt-1 list-inside list-disc text-sm text-amber-800 dark:text-amber-200">
            {warnings.map((w) => (
              <li key={w.productoId} data-producto-id={w.productoId}>
                {w.nombre}: requested {w.requested}, available {w.available}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="flex flex-col gap-4">
          <ClienteSelector value={cliente} onChange={setCliente} />
          <ProductSearch onAdd={(p) => setLineas((prev) => agregarAlCarrito(prev, p))} />
          {esAdmin && <DiscountPanel descuento={descuento} onChange={setDescuento} />}
        </div>
        <div className="flex flex-col gap-4">
          <CartTable
            lineas={vista.porLinea}
            onCantidadChange={(id, v) =>
              setLineas((prev) => editarLinea(prev, id, "cantidad", v))
            }
            onPrecioChange={(id, v) =>
              setLineas((prev) => editarLinea(prev, id, "precioUnitario", v))
            }
            onRemove={(id) => setLineas((prev) => quitarDelCarrito(prev, id))}
          />
          <Totales totales={vista.totales} />
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={guardar}
              disabled={lineas.length === 0 || guardando}
              className="h-11 rounded-lg bg-indigo-600 px-5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {guardando
                ? "Saving…"
                : editandoId === null
                  ? "Save draft"
                  : `Update draft #${editandoId}`}
            </button>
            {editandoId !== null && (
              <button
                type="button"
                onClick={() => {
                  setEditandoId(null);
                  setLineas([]);
                  setDescuento(DESCUENTO_CERO);
                  setCliente({ id: null, nombre: CONSUMIDOR_FINAL_LABEL });
                  setMensaje(null);
                }}
                className="h-11 rounded-lg border border-zinc-300 px-4 text-sm font-medium text-zinc-700 dark:border-zinc-700 dark:text-zinc-300"
              >
                Discard edit
              </button>
            )}
          </div>
        </div>
      </div>

      <DraftList
        items={borradores}
        cargando={listaCargando}
        editandoId={editandoId}
        confirmandoId={confirmandoId}
        onLoad={(id) => void cargarBorrador(id)}
        onCancel={(id) => void cancelarBorrador(id)}
        onConfirm={(id) => void confirmarBorrador(id)}
      />
    </main>
  );
}
