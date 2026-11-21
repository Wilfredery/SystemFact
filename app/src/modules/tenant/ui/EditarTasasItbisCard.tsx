"use client";

/**
 * Edit card for the empresa's allowed ITBIS rate list (feature itbis-tasas-edit,
 * S2/S3). Administrador-only by server enforcement; the write is a
 * history-preserving window change (the server closes the current row and
 * opens a new one).
 *
 * Self-contained state: shows the row passed via props, and after a successful
 * save re-reads `consultarConfiguracionAction` so the card reflects the saved
 * windows without relying on the parent's state. Client-side validation uses
 * the SAME shared parser the server uses (`parsearListaTasasItbis`) so an
 * obviously malformed list never leaves the browser; the server re-checks and
 * owns the typed refusal.
 */

import { useRef, useState } from "react";
import { consultarConfiguracionAction } from "@/modules/tenant/http/actions.administracion";
import { editarTasasItbisAction } from "@/modules/tenant/http/actions.configuracion";
import {
  MENSAJE_TASA_ITBIS_CONFIG_FALTANTE,
  parsearListaTasasItbis,
} from "@/shared/domain/tasas-itbis";
import { TEN_CONCURRENCIA_CONFLICTO } from "@/modules/tenant/domain/errors";
import { formatearFechaSD } from "@/shared/ui/format/date";
import { mensajeErrorGestion } from "./administracion-tabs";

// Local copies of the shared style consts (they are module-private in
// AdministracionScreen.tsx; duplicating three class strings beats exporting
// them and widening the screen module's surface).
const CLASE_ALERTA =
  "rounded-md border border-danger bg-danger/10 px-4 py-3 text-sm text-danger";
const CLASE_BOTON =
  "min-h-11 rounded-md border border-line px-4 text-sm font-medium text-ink disabled:opacity-40";
const CLASE_CONTROL =
  "min-h-11 rounded-md border border-line bg-surface px-3 text-sm text-ink";

export interface FilaTasaItbisVista {
  readonly valor: string;
  readonly vigenciaInicio: string;
  readonly vigenciaFin: string;
}

const MENSAJE_GUARDADO = "Lista de tasas actualizada.";
const MENSAJE_SIN_CAMBIOS = "No había cambios que guardar.";
const MENSAJE_FALLO = "No se pudo guardar la lista de tasas. Intente de nuevo.";

export function EditarTasasItbisCard({
  inicial,
}: {
  readonly inicial: FilaTasaItbisVista | null;
}) {
  const [fila, setFila] = useState<FilaTasaItbisVista | null>(inicial);
  const [valor, setValor] = useState(inicial?.valor ?? "");
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const enviandoRef = useRef(false);
  const [enviando, setEnviando] = useState(false);

  async function recargar(): Promise<void> {
    const r = await consultarConfiguracionAction();
    if (r.ok) {
      setFila(r.data.tasaItbis);
      setValor(r.data.tasaItbis?.valor ?? valor);
    }
  }

  async function guardar(): Promise<void> {
    if (enviandoRef.current) return;
    // Client-side: the SAME parser the server runs (shape, duplicates, range).
    const parseo = parsearListaTasasItbis(valor);
    if (!parseo.ok) {
      setError("La lista no es válida: valores separados por comas, entre 0 y 100, sin repetir ni vacíos.");
      return;
    }
    enviandoRef.current = true;
    setEnviando(true);
    setError(null);
    setMensaje(null);
    try {
      const r = await editarTasasItbisAction({ valor });
      if (!r.ok) {
        setError(mensajeErrorGestion(r.error.code, r.error.message));
        if (r.error.code === TEN_CONCURRENCIA_CONFLICTO) {
          // A conflict re-reads but NEVER retries (the user decides).
          await recargar();
        }
        return;
      }
      setMensaje(r.data.cambioAplicado ? MENSAJE_GUARDADO : MENSAJE_SIN_CAMBIOS);
      // The save already succeeded: a failed re-read must NOT overwrite the
      // success message with the save-failure copy.
      try {
        await recargar();
      } catch {
        setMensaje(MENSAJE_GUARDADO + " (No se pudo refrescar la vista.)");
      }
    } catch {
      setError(MENSAJE_FALLO);
    } finally {
      enviandoRef.current = false;
      setEnviando(false);
    }
  }

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-lg font-semibold text-ink">
        Tasas de ITBIS permitidas
      </h2>
      {fila === null ? (
        <p className={CLASE_ALERTA} role="alert">
          {MENSAJE_TASA_ITBIS_CONFIG_FALTANTE}
        </p>
      ) : (
        <p className="text-sm text-ink-muted">
          {`Lista vigente: ${fila.valor} (desde ${formatearFechaSD(fila.vigenciaInicio)} hasta ${formatearFechaSD(fila.vigenciaFin)}).`}
        </p>
      )}
      <div className="flex max-w-xl flex-col gap-2">
        <label htmlFor="tasas-itbis-valor" className="text-sm font-medium text-ink">
          Nueva lista (separada por comas)
        </label>
        <input
          id="tasas-itbis-valor"
          className={CLASE_CONTROL}
          value={valor}
          onChange={(e) => setValor(e.target.value)}
          disabled={enviando}
        />
        <p className="text-xs text-ink-muted">
          Confirmar con su contador la legalidad de cualquier tasa nueva antes de
          guardarla. El cambio rige desde el momento del guardado; los documentos
          previos conservan su tasa.
        </p>
        <button
          type="button"
          className={`${CLASE_BOTON} justify-self-start`}
          onClick={() => void guardar()}
          disabled={enviando}
        >
          {enviando ? "Guardando…" : "Guardar lista"}
        </button>
        {error !== null && (
          <p className={CLASE_ALERTA} role="alert" data-testid="tasas-itbis-error">
            {error}
          </p>
        )}
        {mensaje !== null && (
          <p className="text-sm text-success-fg" role="status" data-testid="tasas-itbis-mensaje">
            {mensaje}
          </p>
        )}
      </div>
    </section>
  );
}
