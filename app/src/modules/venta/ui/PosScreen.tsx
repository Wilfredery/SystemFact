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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
  editarDescuentoLinea,
  limpiarDescuentoLinea,
  componerValor,
  type CarroLinea,
  type SeleccionCliente,
} from "./carro";
import type { TeclaNumerica } from "@/components/ui/numeric-keypad";
import { NumericKeypad } from "@/components/ui/numeric-keypad";
import { CartTable } from "./CartTable";
import { ClienteSelector, type PerfilClienteSeleccion } from "./ClienteSelector";
import { DiscountPanel } from "./DiscountPanel";
import { DraftList, type BorradorFila } from "./DraftList";
import { ProductSearch } from "./ProductSearch";
import { Totales } from "./Totales";
import { derivarFormaVenta, derivarVencimiento, superficieRechazoCredito, type SuperficieRechazoCredito } from "./credito";

type Mensaje =
  | { kind: "ok"; text: string }
  | {
      kind: "error";
      code: string;
      text: string;
      /** Matched credit-gate surface (R-V20) — replaces the raw-code-only copy. */
      superficie?: SuperficieRechazoCredito | null;
    }
  | null;

/** A stock warning enriched with the cart product name for display only. */
type AvisoStock = StockWarning & { nombre: string };

export function PosScreen({ esAdmin }: { readonly esAdmin: boolean }) {
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
  // F2 (D6/R-V19): the selected client's credit facts (selector-reported, owned
  // state) and the display-only verdict of the last confirm (defensive read, D7).
  const [perfil, setPerfil] = useState<PerfilClienteSeleccion | null>(null);
  // Display-only credit verdict of the last confirm (D7); read defensively so a
  // later slice-B revert cannot break the UI.
  type VeredictoCredito =
    | { forma: "CONTADO" }
    | { forma: "CREDITO"; plazoCreditoDias: number; fechaEmision: string };
  const [veredicto, setVeredicto] = useState<VeredictoCredito | null>(null);
  // D3/R-V22: money received is CLIENT STATE ONLY — never a payload field.
  const [dineroRecibido, setDineroRecibido] = useState("");
  // D4/R-V23 (task 4.6): ONE keypad instance beside Totales; its edits map
  // through `componerValor` onto the active target (a cart line's quantity or
  // price, or the vuelto field). Default target: the first line's quantity.
  type KeypadObjetivo =
    | { campo: "vuelto" }
    | { campo: "cantidad" | "precioUnitario"; productoId: number };
  const [keypadObjetivo, setKeypadObjetivo] = useState<KeypadObjetivo | null>(null);
  const targetKey = keypadObjetivo === null
    ? (lineas[0] !== undefined
        ? { campo: "cantidad" as const, productoId: lineas[0].productoId }
        : null)
    : keypadObjetivo;
  function aplicarTecla(tecla: TeclaNumerica): void {
    if (targetKey === null) return;
    if (targetKey.campo === "vuelto") {
      setDineroRecibido((prev) => componerValor(prev, tecla, 2));
      return;
    }
    setLineas((prev) =>
      editarLinea(
        prev,
        targetKey.productoId,
        targetKey.campo,
        componerValor(
          prev.find((l) => l.productoId === targetKey.productoId)?.[
            targetKey.campo === "cantidad" ? "cantidad" : "precioUnitario"
          ] ?? "",
          tecla,
          targetKey.campo === "cantidad" ? 3 : 2,
        ),
      ),
    );
  }

  const vista = useMemo(
    () => calcularVistaPrevia(lineas, descuento),
    [lineas, descuento],
  );
  const forma = derivarFormaVenta(perfil);

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
        descuento: l.descuento,
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
        descuento: DESCUENTO_CERO,
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
      // Display-only verdict (D7/R-V19): derive the due date for presentation,
      // persist nothing, send nothing. Absent/CONTADO → no due-date block.
      if (
        "credito" in r.data &&
        r.data.credito !== undefined &&
        r.data.credito.forma === "CREDITO"
      ) {
        setVeredicto(r.data.credito);
      } else {
        setVeredicto(null);
      }
      void recargarBorradores();
    } else {
      // R-V20 (D6): the credit-gate surface check runs FIRST — a cataloged
      // credit rejection renders its dedicated Card+Badge surface; nothing
      // else changes (the sale stays BORRADOR, fixed backend semantics).
      setMensaje({
        kind: "error",
        code: r.error.code,
        text: r.error.message,
        superficie: superficieRechazoCredito(r.error.code),
      });
    }
    setConfirmandoId(null);
  }

  // Save-button caption: flat if/else instead of the previous nested ternary
  // (S3358). Same state → same label; no behavior change.
  let etiquetaBotonGuardar: string;
  if (guardando) {
    etiquetaBotonGuardar = "Saving…";
  } else if (editandoId === null) {
    etiquetaBotonGuardar = "Save draft";
  } else {
    etiquetaBotonGuardar = `Update draft #${editandoId}`;
  }

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4 md:p-6">
      <h1 className="text-2xl font-semibold text-ink">
        Point of sale
      </h1>
      <p className="text-sm text-ink-muted">
        Build a cart and save it as a draft, then confirm it to emit its fiscal
        invoice (NCF). Payments arrive in a later phase.
      </p>

      {mensaje !== null && mensaje.kind === "error" && mensaje.superficie ? (
        <Card role="status" aria-live="polite" className="bg-danger/10" aria-label="Credit rejection">
          <CardContent className="flex items-start gap-3 p-4">
            <Badge variant="destructive">{mensaje.superficie.titulo}</Badge>
            <div className="flex flex-col gap-1">
              <span className="text-sm font-medium">{mensaje.superficie.texto}</span>
              <span className="text-sm text-muted">{mensaje.text}</span>
            </div>
          </CardContent>
        </Card>
      ) : mensaje !== null && (
        <Card
          role="status"
          aria-live="polite"
          className={mensaje.kind === "ok" ? "bg-success-bg" : "bg-danger/10"}
        >
          <CardContent className="flex items-start gap-2 p-4">
            {mensaje.kind === "error" ? (
              <Badge variant="destructive" className="font-mono text-xs">
                [{mensaje.code}]
              </Badge>
            ) : (
              <Badge variant="outline">OK</Badge>
            )}
            <span className="text-sm">{mensaje.text}</span>
          </CardContent>
        </Card>
      )}

      {avisoNcf !== null && (
        <Card
          role="alert"
          aria-label="NCF range warning"
          className="bg-warn-bg ring-warn"
        >
          <CardContent className="p-4">
            <Badge variant="outline">
              NCF range at 90% — {avisoNcf}
            </Badge>
            <p className="mt-2 text-sm text-ink">
              The current sequence range is nearly exhausted; request a new range
              before confirmation becomes blocked.
            </p>
          </CardContent>
        </Card>
      )}

      {warnings.length > 0 && (
        <Card
          role="alert"
          aria-live="assertive"
          className="bg-warn-bg ring-warn"
        >
          <CardContent className="p-4">
            <Badge variant="destructive">
              Insufficient stock (warning — the draft was still saved)
            </Badge>
            <ul className="mt-2 list-inside list-disc text-sm text-ink">
              {warnings.map((w) => (
                <li key={w.productoId} data-producto-id={w.productoId}>
                  {w.nombre}: requested {w.requested}, available {w.available}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="flex flex-col gap-4">
          <ClienteSelector
            value={cliente}
            onChange={setCliente}
            onPerfilSeleccionado={setPerfil}
          />
          <ProductSearch onAdd={(p) => setLineas((prev) => agregarAlCarrito(prev, p))} />
          {esAdmin && <DiscountPanel descuento={descuento} onChange={setDescuento} />}
        </div>
        <div className="flex flex-col gap-4">
          <CartTable
            lineas={vista.porLinea}
            puedeDescontar={esAdmin}
            keypadObjetivo={targetKey}
            onSetKeypadTarget={setKeypadObjetivo}
            onCantidadChange={(id, v) =>
              setLineas((prev) => editarLinea(prev, id, "cantidad", v))
            }
            onPrecioChange={(id, v) =>
              setLineas((prev) => editarLinea(prev, id, "precioUnitario", v))
            }
            onRemove={(id) => setLineas((prev) => quitarDelCarrito(prev, id))}
            onDescuentoLineaChange={(id, parcial) =>
              setLineas((prev) => editarDescuentoLinea(prev, id, parcial))
            }
            onDescuentoLineaClear={(id) =>
              setLineas((prev) => limpiarDescuentoLinea(prev, id))
            }
          />
          {/* Credit context strip (D6/R-V19): derived indicator — NO toggle
              control exists anywhere. "Cash (Consumidor Final)" when no client
              is selected; "Crédito · N días" when credit is derived; "Cash"
              otherwise. Post-confirm CREDITO verdicts add the derived due date
              as presentation-only text (ADR-017: nothing is persisted). */}
          <div className="flex flex-wrap items-center gap-3">
            <Badge
              variant={forma === "CREDITO" ? "secondary" : "outline"}
            >
              {forma === "CREDITO"
                ? `Crédito · ${perfil?.plazoCreditoDias ?? 0} días`
                : cliente.id === null
                  ? "Cash (Consumidor Final)"
                  : "Cash"}
            </Badge>
            {veredicto !== null && veredicto.forma === "CREDITO" && (
              <span className="text-sm text-muted">
                Due date:{" "}
                {derivarVencimiento(
                  veredicto.fechaEmision,
                  veredicto.plazoCreditoDias,
                )}
              </span>
            )}
          </div>
          <Totales
            totales={vista.totales}
            dineroRecibido={dineroRecibido}
            onDineroRecibidoChange={setDineroRecibido}
            onFocusDineroRecibido={() => setKeypadObjetivo({ campo: "vuelto" })}
          />
          {/* One keypad instance (D4): target picked by input focus or the
              visible row affordance inside CartTable; edits recompose the value
              with the same regexes the domain validates, re-running the preview. */}
          <NumericKeypad onTecla={aplicarTecla} />
          <div className="flex items-center gap-4">
            <Button
              type="button"
              size="pos"
              onClick={guardar}
              disabled={lineas.length === 0 || guardando}
            >
              {etiquetaBotonGuardar}
            </Button>
            {editandoId !== null && (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setEditandoId(null);
                  setLineas([]);
                  setDescuento(DESCUENTO_CERO);
                  setCliente({ id: null, nombre: CONSUMIDOR_FINAL_LABEL });
                  setMensaje(null);
                }}
              >
                Discard edit
              </Button>
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
