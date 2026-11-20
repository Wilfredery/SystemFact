"use client";

/**
 * Purchase create/edit dialog (screens plan Step 6, `odd/tasks/compras.md` T3:
 * S1, S2, S5, S6). Cloned from the Proveedores dialog pattern
 * (`ProveedorFormulario`): the page already refused to render the manage
 * controls for a view-only role, and every write action re-checks the role on
 * the server.
 *
 * S1: supplier (+RNC), fecha, tipo de compra with its receipt NCF kind as text,
 * the tenant's sucursal READ-ONLY (the backend takes `sucursalId` from the
 * session context — there is deliberately no branch selector), the lines editor
 * and the fiscal breakdown.
 *
 * S2: "Recibir mercancía al confirmar compra" chains confirm → receive. When the
 * receipt is refused, the typed message is shown and the purchase stays visible:
 * the confirmation already happened, so nothing is rolled back or retried.
 *
 * S6: quantities and costs leave the dialog as the exact strings the user typed
 * (`Decimal(12,3)` / `Decimal(12,2)`) and the breakdown is computed by the
 * purchase DOMAIN calculators (`compra-form-utils`), never by float math.
 */

import { useEffect, useRef, useState } from "react";
import { formatInTimeZone } from "date-fns-tz";
import {
  actualizarCompraAction,
  confirmarCompraAction,
  crearCompraAction,
  recibirCompraAction,
} from "@/modules/compra/http/actions";
import { consultarProductosAction } from "@/modules/producto/http/actions";
import { listarProveedoresAction } from "@/modules/proveedor/http/actions";
import type { ProveedorDto } from "@/modules/proveedor/http/shared";
import { componerValor } from "@/modules/venta/ui/carro";
import { formatearMonto } from "@/shared/ui/format/money";
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
import { DEBOUNCE_BUSQUEDA_MS, etiquetaEstadoCompra } from "./compras-filtros";
import { CLASE_ALERTA_COMPRA } from "./compra-form-utils";
import {
  TIPOS_COMPRA_FORMULARIO,
  etiquetaComprobanteCompra,
  lineaCompraVacia,
  lineasParaAccion,
  validarFormularioCompra,
  vistaPreviaCompra,
  type CompraDetalleEditable,
  type LineaCompraFormulario,
  type ProductoCompraOpcion,
} from "./compra-form-utils";

const MENSAJE_FALLO_ACCION = "No se pudo guardar la compra. Intente de nuevo.";
const MENSAJE_FALLO_PROVEEDORES = "No se pudo cargar la lista de proveedores.";
const MENSAJE_FALLO_PRODUCTOS = "No se pudo buscar productos. Intente de nuevo.";
const CLASE_CONTROL =
  "min-h-11 w-full rounded-md border border-line bg-surface px-3 text-sm text-ink";
const CLASE_AVISO = "rounded-md bg-success-bg px-4 py-2 text-sm text-success-fg";
const CLASE_SUCURSAL =
  "min-h-11 rounded-md border border-line bg-surface-muted px-3 py-2 text-sm text-ink";

const ZONA_SD = "America/Santo_Domingo";
const PROVEEDORES_POR_CONSULTA = 100;
const PRODUCTOS_POR_CONSULTA = 10;

/** Display name of the chosen product (`codigo — nombre`, or just the name). */
function nombreProducto(producto: ProductoCompraOpcion): string {
  return producto.codigo === ""
    ? producto.nombre
    : `${producto.codigo} — ${producto.nombre}`;
}

/**
 * `hoy` in the `YYYY-MM-DD` shape a date input needs. AGENTS.md "Dates & time":
 * "today" is a BUSINESS day, so it is resolved in `America/Santo_Domingo` (never
 * the device/UTC calendar day). This business day IS the persisted `fecha`.
 */
function hoyIso(): string {
  return formatInTimeZone(new Date(), ZONA_SD, "yyyy-MM-dd");
}

/** Prefills the editable lines of a stored draft (S5). */
function lineasDesdeCompra(compra: CompraDetalleEditable): LineaCompraFormulario[] {
  return compra.lineas.map((linea, i) => ({
    clave: `l${i + 1}`,
    producto: {
      id: linea.productoId,
      codigo: "",
      nombre: linea.productoNombre,
      unidadMedida: "",
      tasaItbis: linea.tasaItbis,
    },
    cantidad: linea.cantidad,
    costoUnitario: linea.costoUnitario,
  }));
}

export interface CompraFormularioProps {
  /** `null` = new purchase; otherwise the draft being edited. */
  readonly compra: CompraDetalleEditable | null;
  /** Read-only branch of the session (the backend reads it from the context). */
  readonly sucursalNombre: string;
  /** Saved (draft or confirmed): close and refresh the list. */
  readonly onGuardado: () => void;
  /** The purchase changed but the dialog must stay open (S2 receipt failure). */
  readonly onActualizado: () => void;
  readonly onCancelar: () => void;
}

export function CompraFormulario({
  compra,
  sucursalNombre,
  onGuardado,
  onActualizado,
  onCancelar,
}: CompraFormularioProps) {
  const editando = compra !== null;
  const [proveedores, setProveedores] = useState<readonly ProveedorDto[]>([]);
  const [errorProveedores, setErrorProveedores] = useState<string | null>(null);
  const [proveedorId, setProveedorId] = useState<number | null>(
    compra?.proveedor.id ?? null,
  );
  const [fecha, setFecha] = useState(compra?.fecha.slice(0, 10) ?? hoyIso());
  const [tipoCompra, setTipoCompra] = useState<string>(
    compra?.tipoCompra ?? TIPOS_COMPRA_FORMULARIO[0].valor,
  );
  const [lineas, setLineas] = useState<LineaCompraFormulario[]>(() =>
    compra === null
      ? [lineaCompraVacia("l1")]
      : lineasDesdeCompra(compra),
  );
  const [recibirMercancia, setRecibirMercancia] = useState(false);
  // Touch-first entry (board-05 S28): the shared F0 keypad opens when the
  // quantity or unit-cost field takes focus; only one is open at a time. The
  // base snapshot is the value the field showed at focus. `pristinoRef` marks
  // it UNTOUCHED and is consumed SYNCHRONOUSLY by the first tap (or any
  // keyboard change) — never by value equality (JD-B-106: a tap equal to the
  // base must extend). Batched taps still chain correctly because the flag is
  // read from the ref, not the render closure.
  const [tecladoActivo, setTecladoActivo] = useState<
    { readonly clave: string; readonly campo: "cantidad" | "costo" } | null
  >(null);
  const pristinoRef = useRef(false);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmada, setConfirmada] = useState<string | null>(null);
  const [retenciones, setRetenciones] = useState<{
    readonly isr: string;
    readonly itbis: string;
  } | null>(null);
  const siguienteClave = useRef(lineas.length + 1);

  // Supplier options come from the existing read action (view capability).
  useEffect(() => {
    let vigente = true;
    void (async () => {
      try {
        const r = await listarProveedoresAction({
          page: 1,
          limit: PROVEEDORES_POR_CONSULTA,
        });
        if (!vigente) return;
        if (!r.ok) {
          setErrorProveedores(r.error.message);
          return;
        }
        setProveedores(r.data.items);
      } catch {
        if (vigente) setErrorProveedores(MENSAJE_FALLO_PROVEEDORES);
      }
    })();
    return () => {
      vigente = false;
    };
  }, []);

  const proveedor = proveedores.find((p) => p.id === proveedorId) ?? null;
  const esInformal = proveedor?.tipoProveedor === "INFORMAL";
  const vistaPrevia = vistaPreviaCompra(lineas);

  function agregarLinea() {
    const clave = `l${siguienteClave.current}`;
    siguienteClave.current += 1;
    setLineas((previas) => [...previas, lineaCompraVacia(clave)]);
  }

  function quitarLinea(clave: string) {
    setLineas((previas) => previas.filter((l) => l.clave !== clave));
  }

  function actualizarLinea(clave: string, cambios: Partial<LineaCompraFormulario>) {
    setLineas((previas) =>
      previas.map((l) => (l.clave === clave ? { ...l, ...cambios } : l)),
    );
  }

  /** Keypad digit rules (S28, JD-A-001/JD-B-101/JD-B-106): while the field is
   *  untouched (`pristino`), the first tap REPLACES the value it showed at
   *  focus (the "1" quantity default, an empty cost, or an edited draft's
   *  stored value) — never "010.5" and never a silently extended draft; a
   *  lone "." is the legal decimal state "0."; BSP/CLR delete. After the
   *  first tap (or any keyboard change) every tap APPENDS — the base is
   *  consumed once, never re-created by value equality. Quantity keeps 3
   *  decimals, cost 2. */
  function aplicarTecla(tecla: TeclaNumerica): void {
    if (tecladoActivo === null) return;
    const { clave, campo } = tecladoActivo;
    const decimales = campo === "cantidad" ? 3 : 2;
    const pristino = pristinoRef.current;
    pristinoRef.current = false;
    setLineas((previas) =>
      previas.map((previa) => {
        if (previa.clave !== clave) return previa;
        const prev = campo === "cantidad" ? previa.cantidad : previa.costoUnitario;
        let siguiente: string;
        if (pristino) {
          if (tecla === ".") siguiente = "0.";
          else if (tecla === "BSP" || tecla === "CLR") siguiente = "";
          else siguiente = tecla;
        } else if (prev === "" && tecla === ".") {
          siguiente = "0.";
        } else {
          siguiente = componerValor(prev, tecla, decimales);
        }
        return campo === "cantidad"
          ? { ...previa, cantidad: siguiente }
          : { ...previa, costoUnitario: siguiente };
      }),
    );
  }

  /** Non-keypad controls close the keypad on focus (board-04 precedent). */
  function cerrarTeclado() {
    setTecladoActivo(null);
    pristinoRef.current = false;
  }

  /** Creates the draft or replaces the edited draft's lines; never confirms. */
  async function persistirBorrador(): Promise<
    { readonly ok: true; readonly id: number } | { readonly ok: false; readonly message: string }
  > {
    const lineasInput = lineasParaAccion(lineas);
    if (compra === null) {
      const r = await crearCompraAction({
        proveedorId,
        tipoCompra,
        // The business CALENDAR DAY is the value: the transport coerces it to
        // the stored UTC midnight instant (`z.coerce.date`).
        fecha,
        lineas: lineasInput,
      });
      return r.ok ? { ok: true, id: r.data.id } : { ok: false, message: r.error.message };
    }
    const r = await actualizarCompraAction({ id: compra.id, lineas: lineasInput });
    return r.ok ? { ok: true, id: compra.id } : { ok: false, message: r.error.message };
  }

  async function guardar(confirmar: boolean) {
    const mensajeLocal = validarFormularioCompra({ proveedorId, fecha, lineas });
    if (mensajeLocal !== null) {
      setError(mensajeLocal);
      return;
    }

    setEnviando(true);
    setError(null);
    try {
      const borrador = await persistirBorrador();
      if (!borrador.ok) {
        setError(borrador.message);
        return;
      }
      if (!confirmar) {
        onGuardado();
        return;
      }

      const confirmacion = await confirmarCompraAction({ id: borrador.id });
      if (!confirmacion.ok) {
        setError(confirmacion.error.message);
        return;
      }
      setConfirmada(confirmacion.data.correlativoInterno);
      setRetenciones({
        isr: confirmacion.data.retencionIsr,
        itbis: confirmacion.data.retencionItbis,
      });
      if (!recibirMercancia) {
        onGuardado();
        return;
      }

      // S2: the receipt runs AFTER a settled confirmation. Its refusal is shown
      // as-is — the confirm already happened, so it is not rolled back.
      const recepcion = await recibirCompraAction({ id: borrador.id });
      if (!recepcion.ok) {
        setError(recepcion.error.message);
        onActualizado();
        return;
      }
      onGuardado();
    } catch {
      setError(MENSAJE_FALLO_ACCION);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(abierto) => {
        if (!abierto && !enviando) onCancelar();
      }}
    >
      <DialogContent
        aria-label={editando ? "Editar compra" : "Nueva compra"}
        className="sm:max-w-2xl max-h-[calc(100vh-2rem)] overflow-y-auto"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void guardar(false);
          }}
          noValidate
          className="flex flex-col gap-4"
        >
          <DialogHeader>
            <DialogTitle>{editando ? "Editar compra" : "Nueva compra"}</DialogTitle>
            <DialogDescription>
              {editando
                ? "El borrador se edita por líneas; el proveedor no cambia."
                : "El comprobante y las retenciones se calculan al confirmar la compra."}
            </DialogDescription>
          </DialogHeader>

          {editando && (
            <p className="text-sm text-ink-muted" data-testid="compra-estado">
              {compra.correlativoInterno} · {etiquetaEstadoCompra(compra.estado)}
            </p>
          )}

          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="compra-proveedor">Proveedor</Label>
              <select
                id="compra-proveedor"
                required
                value={proveedorId ?? ""}
                onChange={(e) =>
                  setProveedorId(e.target.value === "" ? null : Number(e.target.value))
                }
                onFocus={cerrarTeclado}
                disabled={editando}
                className={CLASE_CONTROL}
              >
                <option value="">Seleccione un proveedor</option>
                {proveedores.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nombre}
                    {p.rnc === null ? "" : ` — ${p.rnc}`}
                  </option>
                ))}
                {/* Editing a draft whose supplier is not in the first page: keep it shown. */}
                {editando && proveedor === null && (
                  <option value={compra.proveedor.id}>{compra.proveedor.nombre}</option>
                )}
              </select>
              {errorProveedores !== null && (
                <p role="alert" className="text-sm text-danger">
                  {errorProveedores}
                </p>
              )}
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="compra-fecha">Fecha</Label>
              <Input
                id="compra-fecha"
                type="date"
                required
                value={fecha}
                onChange={(e) => setFecha(e.target.value)}
                onFocus={cerrarTeclado}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="compra-tipo">Tipo de compra</Label>
              <select
                id="compra-tipo"
                value={tipoCompra}
                onChange={(e) => setTipoCompra(e.target.value)}
                onFocus={cerrarTeclado}
                className={CLASE_CONTROL}
              >
                {TIPOS_COMPRA_FORMULARIO.map((t) => (
                  <option key={t.valor} value={t.valor}>
                    {t.etiqueta}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium">Sucursal</span>
              <p data-testid="compra-sucursal" className={CLASE_SUCURSAL}>
                {sucursalNombre}
              </p>
            </div>
          </div>

          <p className="text-sm text-ink-muted">
            Comprobante:{" "}
            <span data-testid="compra-comprobante" className="font-mono">
              {etiquetaComprobanteCompra(tipoCompra)}
            </span>
          </p>

          {/* Board 05 S26 (wireframe 05b): the nota-fiscal banner is the
              wireframe's STATIC informational copy, verbatim (owner-approved
              as static copy, L17 D3; JD round 2 JD-B-107/109 — single NCF
              source: the Comprobante line above; per-line amounts and the
              Desglose carry the dynamic figures; rates come from
              configuration on confirm). */}
          <p
            role="note"
            data-testid="compra-nota-fiscal"
            aria-label="Nota fiscal"
            className="rounded-md bg-warn-bg ring-1 ring-warn px-4 py-2 text-sm text-ink"
          >
            Nota fiscal: NCF tipo B01 (Compra Formal). Retención ISR 2% (Art.
            106 CT). En compras informales (B11) se retiene el 100% del ITBIS
            (Art. 339 CT).
          </p>

          <div className="flex flex-col gap-3">
            {lineas.map((linea, i) => {
              const numero = i + 1;
              const calculada = vistaPrevia.porClave.get(linea.clave) ?? null;
              return (
                <div
                  key={linea.clave}
                  data-testid={`compra-linea-form-${numero}`}
                  className="grid grid-cols-2 gap-2 rounded-md border border-line p-3"
                >
                  <div className="col-span-2 flex flex-col gap-2">
                    <BuscadorProducto
                      clave={linea.clave}
                      numero={numero}
                      producto={linea.producto}
                      onSeleccionar={(producto) =>
                        actualizarLinea(linea.clave, {
                          producto,
                          costoUnitario: linea.costoUnitario,
                        })
                      }
                      onEnfoqueBuscador={cerrarTeclado}
                    />
                  </div>

                  <div className="flex flex-col gap-2">
                    <Label htmlFor={`compra-cantidad-${linea.clave}`}>
                      Cantidad línea {numero}
                    </Label>
                    <Input
                      id={`compra-cantidad-${linea.clave}`}
                      inputMode="decimal"
                      value={linea.cantidad}
                      onFocus={(e) => {
                        e.currentTarget.select();
                        pristinoRef.current = true;
                        setTecladoActivo({
                          clave: linea.clave,
                          campo: "cantidad",
                        });
                      }}
                      onChange={(e) => {
                        actualizarLinea(linea.clave, { cantidad: e.target.value });
                        // A keyboard change consumes the untouched base too.
                        pristinoRef.current = false;
                      }}
                      autoComplete="off"
                    />
                    {tecladoActivo?.clave === linea.clave &&
                      tecladoActivo.campo === "cantidad" && (
                        <NumericKeypad
                          onTecla={aplicarTecla}
                          ariaLabel={`Teclado numérico cantidad línea ${numero}`}
                          className="max-w-64"
                        />
                      )}
                  </div>

                  <div className="flex flex-col gap-2">
                    <Label htmlFor={`compra-costo-${linea.clave}`}>
                      Costo unitario línea {numero}
                    </Label>
                    <Input
                      id={`compra-costo-${linea.clave}`}
                      inputMode="decimal"
                      value={linea.costoUnitario}
                      onFocus={(e) => {
                        e.currentTarget.select();
                        pristinoRef.current = true;
                        setTecladoActivo({
                          clave: linea.clave,
                          campo: "costo",
                        });
                      }}
                      onChange={(e) => {
                        actualizarLinea(linea.clave, {
                          costoUnitario: e.target.value,
                        });
                        pristinoRef.current = false;
                      }}
                      autoComplete="off"
                    />
                    {tecladoActivo?.clave === linea.clave &&
                      tecladoActivo.campo === "costo" && (
                        <NumericKeypad
                          onTecla={aplicarTecla}
                          ariaLabel={`Teclado numérico costo unitario línea ${numero}`}
                          className="max-w-64"
                        />
                      )}
                  </div>

                  <dl className="col-span-2 grid grid-cols-4 gap-2 text-xs text-ink-muted">
                    <div>
                      <dt>Unidad</dt>
                      <dd data-testid={`compra-linea-${numero}-unidad`}>
                        {linea.producto?.unidadMedida ?? "—"}
                      </dd>
                    </div>
                    <div>
                      <dt>ITBIS %</dt>
                      <dd data-testid={`compra-linea-${numero}-itbis`}>
                        {linea.producto === null ? "—" : `${linea.producto.tasaItbis}%`}
                      </dd>
                    </div>
                    <div>
                      <dt>Costo total</dt>
                      <dd
                        data-testid={`compra-linea-${numero}-subtotal`}
                        className="tabular-nums"
                      >
                        {calculada === null ? "—" : formatearMonto(calculada.subtotalLinea)}
                      </dd>
                    </div>
                    <div className="flex items-end justify-end">
                      <button
                        type="button"
                        aria-label={`Quitar línea ${numero}`}
                        onClick={() => quitarLinea(linea.clave)}
                        onFocus={cerrarTeclado}
                        className="min-h-8 rounded-md border border-line px-2 text-sm"
                      >
                        ✕
                      </button>
                    </div>
                  </dl>
                </div>
              );
            })}
          </div>

          <Button
            type="button"
            variant="outline"
            onClick={agregarLinea}
            onFocus={cerrarTeclado}
          >
            + Agregar producto
          </Button>

          <dl
            aria-label="Desglose fiscal"
            className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-md bg-surface-muted p-3 text-sm"
          >
            <dt className="text-ink-muted">Subtotal</dt>
            <dd data-testid="compra-subtotal" className="text-right tabular-nums">
              {formatearMonto(vistaPrevia.totales.subtotal)}
            </dd>
            <dt className="text-ink-muted">ITBIS por línea</dt>
            <dd data-testid="compra-itbis" className="text-right tabular-nums">
              {formatearMonto(vistaPrevia.totales.itbis)}
            </dd>
            <dt className="text-ink-muted">Ret. ISR</dt>
            <dd data-testid="compra-ret-isr" className="text-right tabular-nums">
              {retenciones === null ? "—" : formatearMonto(retenciones.isr)}
            </dd>
            {esInformal && (
              <>
                <dt className="text-ink-muted">Ret. ITBIS (B11)</dt>
                <dd data-testid="compra-ret-itbis" className="text-right tabular-nums">
                  {retenciones === null ? "—" : formatearMonto(retenciones.itbis)}
                </dd>
              </>
            )}
            <dt className="font-medium text-ink">Total</dt>
            <dd
              data-testid="compra-total"
              className="text-right font-medium tabular-nums text-ink"
            >
              {formatearMonto(vistaPrevia.totales.total)}
            </dd>
          </dl>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              id="compra-recibir"
              checked={recibirMercancia}
              onChange={(e) => setRecibirMercancia(e.target.checked)}
              onFocus={cerrarTeclado}
            />
            Recibir mercancía al confirmar compra
          </label>

          {error !== null && (
            <p role="alert" className={CLASE_ALERTA_COMPRA}>
              {error}
            </p>
          )}

          {confirmada !== null && retenciones !== null && (
            <p role="status" data-testid="compra-confirmada" className={CLASE_AVISO}>
              Compra {confirmada} confirmada. Retención ISR{" "}
              {formatearMonto(retenciones.isr)} · Retención ITBIS{" "}
              {formatearMonto(retenciones.itbis)}.
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onCancelar} disabled={enviando}>
              Cancelar
            </Button>
            <Button type="submit" variant="outline" disabled={enviando}>
              Guardar Borrador
            </Button>
            <Button
              type="button"
              onClick={() => void guardar(true)}
              disabled={enviando}
            >
              Confirmar Compra
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Product search of one line: debounced read through `consultarProductosAction`. */
function BuscadorProducto({
  clave,
  numero,
  producto,
  onSeleccionar,
  onEnfoqueBuscador,
}: {
  readonly clave: string;
  readonly numero: number;
  readonly producto: ProductoCompraOpcion | null;
  readonly onSeleccionar: (producto: ProductoCompraOpcion) => void;
  /** Closes the keypad when the search field takes focus (JD-A-008). */
  readonly onEnfoqueBuscador: () => void;
}) {
  const [texto, setTexto] = useState("");
  const [resultados, setResultados] = useState<readonly ProductoCompraOpcion[]>([]);
  const [error, setError] = useState<string | null>(null);
  const ultimaSolicitud = useRef(0);
  const idCampo = `compra-producto-${clave}`;

  useEffect(() => {
    const busqueda = texto.trim();
    if (busqueda === "") return;
    const timer = setTimeout(() => {
      const solicitud = ++ultimaSolicitud.current;
      void (async () => {
        try {
          const r = await consultarProductosAction({
            page: 1,
            limit: PRODUCTOS_POR_CONSULTA,
            busqueda,
          });
          if (solicitud !== ultimaSolicitud.current) return;
          if (!r.ok) {
            setError(r.error.message);
            setResultados([]);
            return;
          }
          setError(null);
          setResultados(
            r.data.items.map((p) => ({
              id: p.id,
              codigo: p.codigo,
              nombre: p.nombre,
              unidadMedida: p.unidadMedida,
              tasaItbis: p.tasaItbis,
            })),
          );
        } catch {
          if (solicitud === ultimaSolicitud.current) setError(MENSAJE_FALLO_PRODUCTOS);
        }
      })();
    }, DEBOUNCE_BUSQUEDA_MS);
    return () => clearTimeout(timer);
  }, [texto]);

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={idCampo}>Producto línea {numero}</Label>
      <Input
        id={idCampo}
        type="search"
        value={texto}
        onChange={(e) => {
          setTexto(e.target.value);
          // A cleared box hides the previous result list immediately.
          if (e.target.value.trim() === "") setResultados([]);
        }}
        placeholder="Buscar producto por código o nombre..."
        autoComplete="off"
        onFocus={onEnfoqueBuscador}
      />
      {producto !== null && (
        <p data-testid={`compra-linea-${numero}-producto`} className="text-sm">
          {nombreProducto(producto)}
        </p>
      )}
      {error !== null && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      {resultados.length > 0 && (
        <ul aria-label={`Resultados línea ${numero}`} className="flex flex-col gap-1">
          {resultados.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => {
                  onSeleccionar(p);
                  setTexto("");
                  setResultados([]);
                }}
                className="w-full rounded-md border border-line px-3 py-1 text-left text-sm"
              >
                {nombreProducto(p)}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
