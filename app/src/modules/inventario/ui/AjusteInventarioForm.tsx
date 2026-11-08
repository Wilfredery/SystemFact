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
 * The adjust action is not idempotent (odd/tasks/inventario-ajuste.md, L2), so
 * Confirmar stays disabled from the first click, and when the outcome is unknown
 * (the action rejects) it stays disabled for good and sends the user to check
 * the Inventario list instead of offering a retry.
 */

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Decimal from "decimal.js";
import {
  ajustarInventarioAction,
  consultarInventarioAction,
} from "@/modules/inventario/http/actions";

const DEBOUNCE_BUSQUEDA_MS = 300;
const LIMITE_BUSQUEDA = 25;
const MAX_OBSERVACIONES = 200;
const CANTIDAD_RE = /^\d{1,9}(\.\d{1,3})?$/;
const MOTIVOS = [
  "Conteo físico",
  "Merma",
  "Producto dañado",
  "Producto vencido",
  "Corrección de error",
  "Otro",
] as const;
const MENSAJE_FALLO_BUSQUEDA = "No se pudo buscar productos. Intente de nuevo.";
const MENSAJE_RESULTADO_DESCONOCIDO =
  "No se pudo confirmar el ajuste. Revise la existencia en Inventario antes de reintentar.";

type TipoAjuste = "ENTRADA" | "SALIDA";
type EstadoEnvio = "libre" | "enviando" | "desconocido";

interface ProductoElegible {
  readonly productoId: number;
  readonly codigo: string;
  readonly nombre: string;
  readonly cantidad: string;
}

const CLASE_CONTROL =
  "min-h-11 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50";
const CLASE_ETIQUETA = "text-sm font-medium text-zinc-900 dark:text-zinc-50";
const CLASE_ALERTA =
  "rounded-md bg-red-50 px-4 py-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-200";

function leerCantidad(texto: string): Decimal | null {
  const limpio = texto.trim();
  if (!CANTIDAD_RE.test(limpio)) return null;
  const valor = new Decimal(limpio);
  return valor.gt(0) ? valor : null;
}

export function AjusteInventarioForm() {
  const router = useRouter();
  const [texto, setTexto] = useState("");
  const [producto, setProducto] = useState<ProductoElegible | null>(null);
  const [resultados, setResultados] = useState<readonly ProductoElegible[]>([]);
  const [avisoBusqueda, setAvisoBusqueda] = useState<string | null>(null);
  const [tipo, setTipo] = useState<TipoAjuste | null>(null);
  const [motivo, setMotivo] = useState("");
  const [cantidad, setCantidad] = useState("0");
  const [observaciones, setObservaciones] = useState("");
  const [envio, setEnvio] = useState<EstadoEnvio>("libre");
  const [errorNegocio, setErrorNegocio] = useState<string | null>(null);
  const ultimaBusqueda = useRef(0);

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

  function cambiarTexto(valor: string) {
    ultimaBusqueda.current++;
    setTexto(valor);
    setProducto(null);
    setResultados([]);
    setAvisoBusqueda(null);
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
  const completo =
    producto !== null && tipo !== null && motivo !== "" && monto !== null && !stockInsuficiente;
  const puedeConfirmar = completo && envio === "libre";

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
        motivo: detalle === "" ? motivo : `${motivo}: ${detalle}`,
      });
      if (r.ok) {
        router.push("/inventario");
        return;
      }
      // The server rejected it: nothing changed, the user may correct and retry.
      setErrorNegocio(r.error.message);
      setEnvio("libre");
    } catch {
      // Outcome unknown (timeout, network): never offer a blind retry.
      setEnvio("desconocido");
    }
  }

  return (
    <form onSubmit={(e) => void confirmar(e)} noValidate className="flex flex-col gap-6">
      <div className="flex items-center gap-2">
        <Link
          href="/inventario"
          aria-label="Volver"
          className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md text-xl text-zinc-700 dark:text-zinc-300"
        >
          <span aria-hidden="true">←</span>
        </Link>
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Ajuste de Inventario</h1>
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="ajuste-producto" className={CLASE_ETIQUETA}>
          Producto *
        </label>
        <input
          id="ajuste-producto"
          type="search"
          autoComplete="off"
          value={texto}
          onChange={(e) => cambiarTexto(e.target.value)}
          placeholder="Seleccionar producto..."
          className={CLASE_CONTROL}
        />
        {avisoBusqueda !== null && (
          <p role="status" className="text-sm text-red-700 dark:text-red-300">
            {avisoBusqueda}
          </p>
        )}
        {resultados.length > 0 && (
          <ul
            aria-label="Productos encontrados"
            className="divide-y divide-zinc-100 rounded-md border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800"
          >
            {resultados.map((p) => (
              <li key={p.productoId}>
                <button
                  type="button"
                  onClick={() => elegirProducto(p)}
                  className="flex min-h-11 w-full items-center justify-between gap-4 px-3 py-2 text-left text-sm text-zinc-900 dark:text-zinc-50"
                >
                  <span>
                    {p.codigo} — {p.nombre}
                  </span>
                  <span className="text-zinc-500 dark:text-zinc-400">
                    Stock: {new Decimal(p.cantidad).toFixed()}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div role="group" aria-labelledby="ajuste-tipo" className="flex flex-col gap-2">
        <span id="ajuste-tipo" className={CLASE_ETIQUETA}>
          Tipo de ajuste *
        </span>
        <div className="grid grid-cols-2 gap-2">
          {(["ENTRADA", "SALIDA"] as const).map((valor) => (
            <button
              key={valor}
              type="button"
              aria-pressed={tipo === valor}
              onClick={() => setTipo(valor)}
              className={`min-h-12 rounded-md border px-4 text-sm font-medium ${
                tipo === valor
                  ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-50 dark:bg-zinc-50 dark:text-zinc-900"
                  : "border-zinc-300 text-zinc-700 dark:border-zinc-700 dark:text-zinc-300"
              }`}
            >
              {valor === "ENTRADA" ? "Entrada" : "Salida"}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="ajuste-motivo" className={CLASE_ETIQUETA}>
          Motivo *
        </label>
        <select
          id="ajuste-motivo"
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          className={CLASE_CONTROL}
        >
          <option value="">Seleccionar motivo...</option>
          {MOTIVOS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="ajuste-cantidad" className={CLASE_ETIQUETA}>
          Nueva cantidad *
        </label>
        <input
          id="ajuste-cantidad"
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={cantidad}
          onChange={(e) => setCantidad(e.target.value)}
          onFocus={(e) => e.currentTarget.select()}
          placeholder="0"
          aria-describedby="ajuste-cantidad-detalle"
          className={CLASE_CONTROL}
        />
        <p id="ajuste-cantidad-detalle" aria-live="polite" className="min-h-5 text-sm">
          {stockInsuficiente ? (
            <span className="text-red-700 dark:text-red-300">Stock insuficiente</span>
          ) : (
            existencia !== null &&
            quedara !== null && (
              <span className="text-zinc-600 dark:text-zinc-400">
                Existencia actual {existencia.toFixed()} → quedará {quedara.toFixed()}
              </span>
            )
          )}
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="ajuste-observaciones" className={CLASE_ETIQUETA}>
          Observaciones
        </label>
        <textarea
          id="ajuste-observaciones"
          value={observaciones}
          onChange={(e) => setObservaciones(e.target.value)}
          maxLength={MAX_OBSERVACIONES}
          rows={3}
          placeholder="Detalle opcional del ajuste..."
          className={`${CLASE_CONTROL} py-2`}
        />
      </div>

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
          className="inline-flex min-h-12 items-center justify-center rounded-md border border-zinc-300 px-5 text-sm font-medium text-zinc-700 dark:border-zinc-700 dark:text-zinc-300"
        >
          Cancelar
        </Link>
        <button
          type="submit"
          disabled={!puedeConfirmar}
          className="min-h-12 rounded-md bg-zinc-900 px-5 text-sm font-medium text-white disabled:opacity-40 dark:bg-zinc-50 dark:text-zinc-900"
        >
          Confirmar Ajuste
        </button>
      </div>
    </form>
  );
}
