"use client";

/**
 * Inventario adjust form (wireframe `04-Inventario-Ajuste`).
 *
 * Client island for the interactivity only; the server page already refused
 * anyone outside the manage group, and `ajustarInventarioAction` re-checks on
 * every call. The number is the AMOUNT to add (Entrada) or remove (Salida), not
 * the new total: the live line shows what the stock will become. Quantities are
 * Decimal strings end to end, never floats.
 *
 * The adjust action is idempotent by `requestId`: Confirmar stays disabled from
 * the first click, and when the outcome is unknown (the action rejects, i.e.
 * timeout/network) the fields stay locked and the retry repeats the same
 * `requestId`, so the server applies the request at most once.
 *
 * Board-04 S24: F0 primitives + token classes only (no raw palette, no
 * dark-mode overrides).
 */

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Decimal from "decimal.js";
import { NumericKeypad, type TeclaNumerica } from "@/components/ui/numeric-keypad";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { componerValor } from "@/modules/venta/ui/carro";
import {
  ajustarInventarioAction,
  consultarInventarioAction,
} from "@/modules/inventario/http/actions";
import {
  MOTIVOS_AJUSTE,
  STOCK_MAXIMO,
} from "@/modules/inventario/domain/inventario";

const DEBOUNCE_BUSQUEDA_MS = 300;
const LIMITE_BUSQUEDA = 25;
const MAX_OBSERVACIONES = 200;
const CANTIDAD_RE = /^\d{1,9}(\.\d{1,3})?$/;
const MENSAJE_FORMATO_CANTIDAD = "Use punto decimal y hasta 3 decimales (ejemplo: 1.5).";
const MENSAJE_CANTIDAD_CERO = "La cantidad debe ser mayor que 0.";
const MENSAJE_STOCK_MAXIMO = "La existencia resultante supera el máximo permitido (999,999,999.999).";
const MENSAJE_FALLO_BUSQUEDA = "No se pudo buscar productos. Intente de nuevo.";
const MENSAJE_RESULTADO_DESCONOCIDO =
  "No se pudo confirmar el ajuste. Puede reintentar: si el ajuste ya se aplicó, no se aplicará dos veces.";

type TipoAjuste = "ENTRADA" | "SALIDA";
type EstadoEnvio = "libre" | "enviando" | "desconocido";

interface ProductoElegible {
  readonly productoId: number;
  readonly codigo: string;
  readonly nombre: string;
  readonly cantidad: string;
}

/** Native <select>/<textarea> face, token-bound (the F0 Select is not used here). */
const CLASE_CONTROL =
  "min-h-11 w-full rounded-lg border border-line bg-surface px-2.5 text-sm text-ink";
const CLASE_ALERTA =
  "rounded-md bg-danger/10 px-3 py-2 text-sm text-danger";

/** Why an amount typed by the user is not accepted; null while untouched or valid. */
function explicarCantidad(texto: string): string | null {
  const limpio = texto.trim();
  if (limpio === "" || limpio === "0") return null;
  if (!CANTIDAD_RE.test(limpio)) return MENSAJE_FORMATO_CANTIDAD;
  return new Decimal(limpio).gt(0) ? null : MENSAJE_CANTIDAD_CERO;
}

function nuevaClaveDeSolicitud(): string {
  const c = globalThis.crypto;
  if (c !== undefined && typeof c.randomUUID === "function") return c.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

function leerCantidad(texto: string): Decimal | null {
  const limpio = texto.trim();
  if (!CANTIDAD_RE.test(limpio)) return null;
  const valor = new Decimal(limpio);
  return valor.gt(0) ? valor : null;
}

export function AjusteInventarioForm({
  productoPreseleccionado = "",
}: {
  /** Row-menu prefill (board-04 S19): the product's code from the ⋯ menu. */
  readonly productoPreseleccionado?: string;
}) {
  const router = useRouter();
  const [texto, setTexto] = useState("");
  const [producto, setProducto] = useState<ProductoElegible | null>(null);
  const [resultados, setResultados] = useState<readonly ProductoElegible[]>([]);
  const [avisoBusqueda, setAvisoBusqueda] = useState<string | null>(null);
  const [tipo, setTipo] = useState<TipoAjuste | null>(null);
  const [motivo, setMotivo] = useState("");
  const [cantidad, setCantidad] = useState("0");
  // Touch-first quantity entry (board-04 S21): the shared F0 keypad opens when
  // the quantity field takes focus and closes when any other field does.
  const [tecladoActivo, setTecladoActivo] = useState(false);
  const [observaciones, setObservaciones] = useState("");
  const [envio, setEnvio] = useState<EstadoEnvio>("libre");
  const [errorNegocio, setErrorNegocio] = useState<string | null>(null);
  const ultimaBusqueda = useRef(0);
  const [requestId] = useState(nuevaClaveDeSolicitud);

  // Debounced product search. Only the latest request may settle state: a slow
  // earlier answer must not overwrite the options of a newer text.
  useEffect(() => {
    const termino = texto.trim();
    if (producto !== null || termino === "") return;
    const timer = setTimeout(() => {
      const solicitud = ++ultimaBusqueda.current;
      void (async () => {
        try {
          const r = await consultarInventarioAction({
            page: 1,
            limit: LIMITE_BUSQUEDA,
            busqueda: termino,
          });
          if (solicitud !== ultimaBusqueda.current) return;
          if (r.ok) {
            setResultados(r.data.items);
            setAvisoBusqueda(null);
          } else {
            setResultados([]);
            setAvisoBusqueda(r.error.message);
          }
        } catch {
          if (solicitud !== ultimaBusqueda.current) return;
          setResultados([]);
          setAvisoBusqueda(MENSAJE_FALLO_BUSQUEDA);
        }
      })();
    }, DEBOUNCE_BUSQUEDA_MS);
    return () => clearTimeout(timer);
  }, [texto, producto]);

  // Prefill from the consulta ⋯ menu: resolve the code through the same search
  // action and pick the exact-code match once. Only the latest request settles.
  useEffect(() => {
    const codigo = productoPreseleccionado.trim();
    if (codigo === "") return;
    const solicitud = ++ultimaBusqueda.current;
    void (async () => {
      try {
        const r = await consultarInventarioAction({ page: 1, limit: LIMITE_BUSQUEDA, busqueda: codigo });
        if (solicitud !== ultimaBusqueda.current) return;
        if (r.ok) {
          const exacto = r.data.items.find((p) => p.codigo === codigo);
          if (exacto !== undefined) {
            setProducto(exacto);
            setTexto(`${exacto.codigo} — ${exacto.nombre}`);
          }
        }
      } catch {
        // Prefill is a courtesy: a failed lookup leaves the form untouched.
      }
    })();
    // Runs once per mount/preselection value; user choices below take over.
  }, [productoPreseleccionado]);

  function cambiarTexto(valor: string) {
    ultimaBusqueda.current++;
    setTexto(valor);
    setProducto(null);
    setResultados([]);
    setAvisoBusqueda(null);
  }

  function aplicarTecla(tecla: TeclaNumerica): void {
    setCantidad((prev) => {
      // The untouched "0" placeholder behaves like an empty base: the first
      // digit replaces it (never "010.5"), "0." stays a legal decimal state,
      // and BSP/CLR clear it entirely.
      if (prev === "0") {
        if (tecla === ".") return "0.";
        if (tecla === "BSP" || tecla === "CLR") return "";
        return tecla;
      }
      return componerValor(prev, tecla, 3);
    });
  }

  function elegirProducto(p: ProductoElegible) {
    ultimaBusqueda.current++;
    setProducto(p);
    setTexto(`${p.codigo} — ${p.nombre}`);
    setResultados([]);
    setAvisoBusqueda(null);
  }

  const monto = leerCantidad(cantidad);
  const existencia = producto === null ? null : new Decimal(producto.cantidad);
  const quedara =
    existencia === null || monto === null || tipo === null
      ? null
      : tipo === "ENTRADA"
        ? existencia.plus(monto)
        : existencia.minus(monto);
  const stockInsuficiente = quedara !== null && quedara.lt(0);
  // The column holds 9 integer digits and 3 decimals: stop an Entrada past it here
  // (the server enforces it too, with its own stable code).
  const excedeMaximo = quedara !== null && quedara.gt(STOCK_MAXIMO);
  const avisoCantidad = explicarCantidad(cantidad);
  const completo =
    producto !== null && tipo !== null && motivo !== "" && monto !== null && !stockInsuficiente && !excedeMaximo;
  // After an unknown outcome the user may retry: the fields are locked, so the
  // retry carries the same data and the same requestId, and the server applies
  // that request at most once.
  const puedeConfirmar = completo && (envio === "libre" || envio === "desconocido");
  const camposBloqueados = envio !== "libre";

  async function confirmar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (!puedeConfirmar || producto === null || monto === null || tipo === null) return;

    const detalle = observaciones.trim();
    setEnvio("enviando");
    setErrorNegocio(null);
    try {
      const r = await ajustarInventarioAction({
        productoId: producto.productoId,
        cantidad: `${tipo === "SALIDA" ? "-" : ""}${cantidad.trim()}`,
        motivo,
        // Board-04 S22: the reason rides as its frozen enum value and the
        // detail rides separately; the USE CASE composes "Motivo: detalle".
        ...(detalle === "" ? {} : { observaciones: detalle }),
        requestId,
      });
      if (r.ok) {
        router.push("/inventario");
        return;
      }
      // The server rejected it: nothing changed, the user may correct and retry.
      setErrorNegocio(r.error.message);
      setEnvio("libre");
    } catch {
      // Outcome unknown (timeout, network): the retry is safe because it repeats
      // the same requestId; the fields stay locked so the data cannot change.
      setEnvio("desconocido");
    }
  }

  return (
    <form onSubmit={(e) => void confirmar(e)} noValidate className="flex flex-col gap-6">
      <div className="flex items-center gap-2">
        <Link
          href="/inventario"
          aria-label="Volver"
          className={buttonVariants({ variant: "ghost", size: "icon", className: "text-xl" })}
        >
          <span aria-hidden="true">←</span>
        </Link>
        <h1 className="text-2xl font-semibold text-ink">Ajuste de Inventario</h1>
      </div>

      <fieldset disabled={camposBloqueados} className="m-0 flex min-w-0 flex-col gap-6 border-0 p-0">
      <div className="flex flex-col gap-2">
        <Label htmlFor="ajuste-producto">Producto *</Label>
        <Input
          id="ajuste-producto"
          type="search"
          autoComplete="off"
          value={texto}
          onChange={(e) => cambiarTexto(e.target.value)}
          onFocus={() => setTecladoActivo(false)}
          placeholder="Seleccionar producto..."
        />
        {avisoBusqueda !== null && (
          <p role="status" className="text-sm text-danger">
            {avisoBusqueda}
          </p>
        )}
        {resultados.length > 0 && (
          <ul
            aria-label="Productos encontrados"
            className="divide-y divide-line rounded-lg border border-line"
          >
            {resultados.map((p) => (
              <li key={p.productoId}>
                <button
                  type="button"
                  onClick={() => elegirProducto(p)}
                  className="flex min-h-11 w-full items-center justify-between gap-4 px-3 py-2 text-left text-sm text-ink"
                >
                  <span>
                    {p.codigo} — {p.nombre}
                  </span>
                  <span className="text-ink-muted">
                    Stock: {new Decimal(p.cantidad).toFixed()}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div role="group" aria-labelledby="ajuste-tipo" className="flex flex-col gap-2">
        <span id="ajuste-tipo" className="text-sm font-medium text-ink">
          Tipo de ajuste *
        </span>
        <div className="grid grid-cols-2 gap-2">
          {(["ENTRADA", "SALIDA"] as const).map((valor) => (
            <Button
              key={valor}
              type="button"
              size="pos"
              variant={tipo === valor ? "default" : "outline"}
              aria-pressed={tipo === valor}
              onClick={() => setTipo(valor)}
            >
              {valor === "ENTRADA" ? "Entrada" : "Salida"}
            </Button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="ajuste-motivo">Motivo *</Label>
        <select
          id="ajuste-motivo"
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          onFocus={() => setTecladoActivo(false)}
          className={CLASE_CONTROL}
        >
          <option value="">Seleccionar motivo...</option>
          {MOTIVOS_AJUSTE.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="ajuste-cantidad">Cantidad a ajustar *</Label>
        <Input
          id="ajuste-cantidad"
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={cantidad}
          onChange={(e) => setCantidad(e.target.value)}
          onFocus={(e) => {
            e.currentTarget.select();
            setTecladoActivo(true);
          }}
          placeholder="0"
          aria-describedby="ajuste-cantidad-detalle"
        />
        {tecladoActivo && (
          <NumericKeypad
            onTecla={aplicarTecla}
            ariaLabel="Teclado numérico cantidad a ajustar"
            className="max-w-64"
          />
        )}
        <p id="ajuste-cantidad-detalle" aria-live="polite" className="min-h-5 text-sm">
          {stockInsuficiente ? (
            <span className="text-danger">Stock insuficiente</span>
          ) : excedeMaximo ? (
            <span className="text-danger">{MENSAJE_STOCK_MAXIMO}</span>
          ) : avisoCantidad !== null ? (
            <span className="text-danger">{avisoCantidad}</span>
          ) : (
            existencia !== null &&
            quedara !== null && (
              <span className="text-ink-muted">
                Existencia actual {existencia.toFixed()} → quedará {quedara.toFixed()}
              </span>
            )
          )}
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="ajuste-observaciones">Observaciones</Label>
        <textarea
          id="ajuste-observaciones"
          value={observaciones}
          onChange={(e) => setObservaciones(e.target.value)}
          onFocus={() => setTecladoActivo(false)}
          maxLength={MAX_OBSERVACIONES}
          rows={3}
          placeholder="Detalle opcional del ajuste..."
          className={`${CLASE_CONTROL} py-2`}
        />
      </div>

      </fieldset>

      {errorNegocio !== null && (
        <p role="alert" className={CLASE_ALERTA}>
          {errorNegocio}
        </p>
      )}
      {envio === "desconocido" && (
        <div role="alert" className={`${CLASE_ALERTA} flex flex-col gap-2`}>
          <p>{MENSAJE_RESULTADO_DESCONOCIDO}</p>
          <Link href="/inventario" className="inline-flex min-h-11 items-center font-medium underline">
            Ir a Inventario
          </Link>
        </div>
      )}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Link
          href="/inventario"
          className={buttonVariants({ variant: "outline", size: "pos" })}
        >
          Cancelar
        </Link>
        <Button type="submit" size="pos" disabled={!puedeConfirmar}>
          {envio === "desconocido" ? "Reintentar ajuste" : "Confirmar Ajuste"}
        </Button>
      </div>
    </form>
  );
}
