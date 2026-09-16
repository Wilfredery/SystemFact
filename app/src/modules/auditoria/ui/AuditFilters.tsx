/**
 * Auditoria filter form — CLIENT island (Slice D, task 4.2; AC-2 / AC-3).
 *
 * The only genuinely interactive piece of the screen: a combinable filter form that,
 * on submit, pushes the new filter onto the URL so the SERVER page re-renders with a
 * fresh `searchParams` → fresh table. The form holds NO data of its own and issues NO
 * query — it only writes the querystring, which keeps the single source of truth on the
 * server (the same shape `./url` reads back). This is the Next server-component idiom,
 * mirroring how the cobros board reloads through the action rather than caching rows.
 *
 * It renders the SAME six facets the use case ANDs together (AC-3): `accion` select
 * (including the incidental `LEER` value as an ordinary option), usuario, sucursal,
 * a Santo-Domingo date range (interpreted downstream by `rangoFechasAUTC`), and free
 * text (targeting only `entidad`/`idEntidad`/`motivo` server-side). The submit control
 * is DISABLED while a transition is in flight (the "disabled submit while busy" rule)
 * so a double-click cannot stack two navigations. Nothing here mutates data — the form
 * is a navigation-only affordance (AC-5).
 */

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ACCION_AUDITORIA,
  type AccionAuditoria,
  type AuditoriaFiltroEntrada,
} from "../domain/auditoria";
import { ETIQUETA_ACCION } from "./format";

const CLASE_CAMPO =
  "rounded border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100";
const CLASE_ETIQUETA = "font-medium text-zinc-700 dark:text-zinc-300";

/** Every audit action value, as options for the `accion` select (AC-3: `LEER` is an
 *  ordinary option with no special handling). */
const OPCIONES_ACCION = Object.values(ACCION_AUDITORIA) as AccionAuditoria[];

interface EstadoFormulario {
  accion: string;
  usuarioId: string;
  sucursalId: string;
  desde: string;
  hasta: string;
  texto: string;
}

function desdeFiltro(f: AuditoriaFiltroEntrada): EstadoFormulario {
  return {
    accion: f.accion ?? "",
    usuarioId: f.usuarioId !== undefined ? String(f.usuarioId) : "",
    sucursalId: f.sucursalId !== undefined ? String(f.sucursalId) : "",
    desde: f.desde ?? "",
    hasta: f.hasta ?? "",
    texto: f.texto ?? "",
  };
}

const VACIO: EstadoFormulario = {
  accion: "",
  usuarioId: "",
  sucursalId: "",
  desde: "",
  hasta: "",
  texto: "",
};

/**
 * Trim + drop blank/NaN fields. Numeric text inputs become `null` when empty so the
 * server filter treats them as "no constraint" rather than a malformed id.
 */
function aQuery(val: EstadoFormulario): string {
  const p = new URLSearchParams();
  const poner = (clave: string, valor: string, numerico = false): void => {
    const t = valor.trim();
    if (t === "") return;
    if (numerico) {
      const n = Number(t);
      if (!Number.isInteger(n) || n < 1) return; // a bad locator id is simply not applied
    }
    p.set(clave, t);
  };
  poner("accion", val.accion);
  poner("usuarioId", val.usuarioId, true);
  poner("sucursalId", val.sucursalId, true);
  poner("desde", val.desde);
  poner("hasta", val.hasta);
  poner("texto", val.texto);
  // A filter change resets to the first page (page 1 → no `page` param).
  const qs = p.toString();
  return qs === "" ? "/auditoria" : `/auditoria?${qs}`;
}

export function AuditFilters({
  filtroInicial,
}: {
  readonly filtroInicial: AuditoriaFiltroEntrada;
}) {
  const router = useRouter();
  const [pendiente, iniciar] = useTransition();
  const [val, setVal] = useState<EstadoFormulario>(() => desdeFiltro(filtroInicial));

  function onCambio<K extends keyof EstadoFormulario>(
    campo: K,
    valor: string,
  ): void {
    setVal((prev) => ({ ...prev, [campo]: valor }));
  }

  return (
    <form
      aria-label="Filtros de auditoría"
      onSubmit={(e) => {
        e.preventDefault();
        // Debounce-free but transition-guarded: the submit button is disabled while
        // `pendiente` is true, so a second click cannot stack two navigations. Awaiting
        // the router call keeps the transition pending until navigation resolves.
        iniciar(async () => {
          await router.push(aQuery(val));
        });
      }}
      className="flex flex-wrap items-end gap-3 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
    >
      <div className="flex flex-col gap-1">
        <label htmlFor="aud-accion" className={CLASE_ETIQUETA}>
          Acción
        </label>
        <select
          id="aud-accion"
          aria-label="Acción"
          value={val.accion}
          onChange={(e) => onCambio("accion", e.target.value)}
          className={CLASE_CAMPO}
        >
          <option value="">Todas</option>
          {OPCIONES_ACCION.map((a) => (
            <option key={a} value={a}>
              {ETIQUETA_ACCION[a]}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="aud-usuario" className={CLASE_ETIQUETA}>
          Usuario
        </label>
        <input
          id="aud-usuario"
          aria-label="Usuario"
          inputMode="numeric"
          value={val.usuarioId}
          onChange={(e) => onCambio("usuarioId", e.target.value)}
          className={`w-24 ${CLASE_CAMPO}`}
          placeholder="#"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="aud-sucursal" className={CLASE_ETIQUETA}>
          Sucursal
        </label>
        <input
          id="aud-sucursal"
          aria-label="Sucursal"
          inputMode="numeric"
          value={val.sucursalId}
          onChange={(e) => onCambio("sucursalId", e.target.value)}
          className={`w-24 ${CLASE_CAMPO}`}
          placeholder="#"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="aud-desde" className={CLASE_ETIQUETA}>
          Desde
        </label>
        <input
          id="aud-desde"
          aria-label="Fecha desde"
          type="date"
          value={val.desde}
          onChange={(e) => onCambio("desde", e.target.value)}
          className={CLASE_CAMPO}
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="aud-hasta" className={CLASE_ETIQUETA}>
          Hasta
        </label>
        <input
          id="aud-hasta"
          aria-label="Fecha hasta"
          type="date"
          value={val.hasta}
          onChange={(e) => onCambio("hasta", e.target.value)}
          className={CLASE_CAMPO}
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="aud-texto" className={CLASE_ETIQUETA}>
          Texto libre
        </label>
        <input
          id="aud-texto"
          aria-label="Texto libre"
          value={val.texto}
          onChange={(e) => onCambio("texto", e.target.value)}
          className={`min-w-40 ${CLASE_CAMPO}`}
          placeholder="entidad, id o motivo"
        />
      </div>

      <div className="flex items-center gap-2">
        <button
          type="submit"
          aria-label="Aplicar filtros"
          disabled={pendiente}
          className="rounded border border-zinc-300 px-3 py-1 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          {pendiente ? "Aplicando…" : "Aplicar"}
        </button>
        <button
          type="button"
          aria-label="Limpiar filtros"
          disabled={pendiente}
          onClick={() => {
            setVal(VACIO);
            iniciar(async () => {
              await router.push("/auditoria");
            });
          }}
          className="rounded border border-zinc-300 px-3 py-1 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          Limpiar
        </button>
      </div>
    </form>
  );
}
