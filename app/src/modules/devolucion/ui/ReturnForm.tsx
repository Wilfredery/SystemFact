"use client";

/**
 * Return-form dialog for a confirmed sale (fase-5d, task 2.2).
 *
 * Client interactivity only — no ORM access, no business rules. The form:
 *   1. loads the sale's persisted lines through the thin `obtenerVentaAction`
 *      (already tenant+branch scoped; the SERVER is the branch-match guard —
 *      `leerVentaParaDevolucionEnTx` rejects a foreign sucursal, so the form
 *      simply renders only rows that listing already scoped to this branch);
 *   2. lets the user pick per line: include, `Decimal(12,3)` quantity (string,
 *      never a float) and the frozen `VENDIBLE`/`DANADO` restock type;
 *   3. validates the payload with the SHARED `zDevolverVentaInput` schema the
 *      action itself uses (one transport contract, no duplicated grammar);
 *   4. calls `devolverVentaAction` once per submission (single-flight, the
 *      submit button is disabled on first click and the server revalidates).
 *
 * Money is never computed here: prices, ITBIS and the NC total are re-derived
 * from the ORIGINAL sale rows server-side (frozen mirror R-D5). The error
 * surface is the action's own composed catalog — code + user message verbatim,
 * no stack traces or Prisma internals.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { obtenerVentaAction } from "@/modules/venta/http/actions";
import { devolverVentaAction } from "@/modules/devolucion/http/actions";
import {
  zDevolverVentaInput,
  VALIDATION_ERROR,
  type DevolverVentaInputDto,
} from "@/modules/devolucion/http/validations";

/** Restock type derived from the shared transport schema (no hand-copied enum). */
type TipoReposicion = DevolverVentaInputDto["lineas"][number]["tipoReposicion"];

/** Shown when an action call itself fails (network, server crash): no code, no internals. */
const MENSAJE_FALLO_CONEXION =
  "No se pudo completar la operación. Revise su conexión e intente de nuevo.";

/**
 * A rejected submit may have committed on the server (the response, not the
 * write, was lost): never invite a blind retry.
 */
const MENSAJE_RESULTADO_INCIERTO =
  "No se pudo confirmar si la nota de crédito fue emitida. Revise las devoluciones de esta venta antes de reintentar.";

/** One editable row: the ORIGINAL persisted sale line + the user's intent. */
interface LineaFormulario {
  readonly productoId: number;
  readonly productoNombre: string;
  /** Original sold quantity, `Decimal(12,3)` string. */
  readonly cantidadOriginal: string;
  readonly incluida: boolean;
  readonly cantidad: string;
  readonly tipoReposicion: TipoReposicion;
}

type Mensaje =
  | { readonly kind: "ok"; readonly text: string }
  | { readonly kind: "error"; readonly code?: string; readonly text: string }
  | null;

export function ReturnForm({
  ventaId,
  onClose,
  onOcupado,
}: {
  readonly ventaId: number;
  readonly onClose: () => void;
  /** Tells the opener a submission is in flight so it cannot unmount the form mid-send. */
  readonly onOcupado?: (ocupado: boolean) => void;
}) {
  const [cargando, setCargando] = useState(true);
  const [lineas, setLineas] = useState<readonly LineaFormulario[]>([]);
  const [motivo, setMotivo] = useState("");
  const [enviando, setEnviando] = useState(false);
  // Set synchronously before the await: state alone is stale inside the same render cycle.
  const enCurso = useRef(false);
  const [mensaje, setMensaje] = useState<Mensaje>(null);

  useEffect(() => {
    // Mount fetch settles state from the action's resolution callback (an
    // external-system boundary), never synchronously in the effect body
    // (same convention as `PosScreen`).
    void obtenerVentaAction({ id: ventaId })
      .then((r) => {
        if (r.ok) {
          setLineas(
            r.data.lineas.map((l) => ({
              productoId: l.productoId,
              productoNombre: l.productoNombre,
              cantidadOriginal: l.cantidad,
              incluida: true,
              cantidad: "1",
              tipoReposicion: "VENDIBLE" as const,
            })),
          );
        } else {
          setMensaje({ kind: "error", code: r.error.code, text: r.error.message });
        }
      })
      .catch(() => {
        setMensaje({ kind: "error", text: MENSAJE_FALLO_CONEXION });
      })
      .finally(() => {
        setCargando(false);
      });
  }, [ventaId]);

  const editarLinea = useCallback((productoId: number, cambios: Partial<LineaFormulario>) => {
    setLineas((prev) =>
      prev.map((l) => (l.productoId === productoId ? { ...l, ...cambios } : l)),
    );
  }, []);

  async function enviar(): Promise<void> {
    // Single-flight guard: disabled button PLUS this early return, so a double
    // event in the same render cycle never burns a second B04 (R-V15 pattern).
    if (enCurso.current) return;
    const candidatos = lineas
      .filter((l) => l.incluida)
      .map((l) => ({
        productoId: l.productoId,
        cantidad: l.cantidad.trim(),
        tipoReposicion: l.tipoReposicion,
      }));
    const cuerpo = { ventaId, motivo: motivo.trim(), lineas: candidatos };
    const parsed = zDevolverVentaInput.safeParse(cuerpo);
    if (!parsed.success) {
      setMensaje({
        kind: "error",
        code: VALIDATION_ERROR,
        text: "Complete el motivo y una cantidad válida en al menos una línea.",
      });
      return;
    }
    enCurso.current = true;
    setEnviando(true);
    onOcupado?.(true);
    setMensaje(null);
    try {
      const r = await devolverVentaAction(parsed.data);
      if (r.ok) {
        const aviso90 = r.warnings !== undefined && r.warnings.length > 0;
        setMensaje({
          kind: "ok",
          text: aviso90
            ? `Nota de crédito NC #${r.data.id} emitida — NCF ${r.data.ncf}. Rango de NCF al 90%.`
            : `Nota de crédito NC #${r.data.id} emitida — NCF ${r.data.ncf} (${r.data.monto} RD$).`,
        });
      } else {
        setMensaje({ kind: "error", code: r.error.code, text: r.error.message });
      }
    } catch {
      setMensaje({ kind: "error", text: MENSAJE_RESULTADO_INCIERTO });
    } finally {
      enCurso.current = false;
      setEnviando(false);
      onOcupado?.(false);
    }
  }

  const bloqueado = enviando || cargando || lineas.length === 0;

  return (
    <div
      data-testid={`devolucion-form-${ventaId}`}
      className="absolute right-0 top-full z-10 mt-1 max-h-[32rem] w-96 max-w-full overflow-y-auto rounded-lg border border-line bg-surface p-4 shadow-lg"
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-ink">
          Devolver venta #{ventaId} (Nota de Crédito B04)
        </h3>
        <button
          type="button"
          onClick={onClose}
          disabled={enviando}
          aria-label="Cerrar formulario de devolución"
          className="rounded border border-line px-2 py-1 text-xs text-ink-muted disabled:cursor-not-allowed disabled:opacity-50"
        >
          Cerrar
        </button>
      </div>

      {mensaje !== null && (
        <p
          role="status"
          aria-live="polite"
          className={
            mensaje.kind === "ok"
              ? "mt-2 rounded-md bg-success-bg px-3 py-2 text-sm text-success-fg"
              : "mt-2 rounded-md bg-danger/10 px-3 py-2 text-sm text-danger"
          }
        >
          {mensaje.kind === "error" && mensaje.code !== undefined && (
            <span className="mr-2 font-mono text-xs">[{mensaje.code}]</span>
          )}
          {mensaje.text}
        </p>
      )}

      {cargando ? (
        <p className="mt-2 text-sm text-ink-muted">Cargando las líneas de la venta…</p>
      ) : (
        lineas.length > 0 && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void enviar();
            }}
            className="mt-3 flex flex-col gap-3"
          >
            <div>
              <label
                htmlFor={`devolucion-motivo-${ventaId}`}
                className="block text-xs font-medium text-ink"
              >
                Motivo de la devolución
              </label>
              <input
                id={`devolucion-motivo-${ventaId}`}
                value={motivo}
                maxLength={255}
                onChange={(e) => setMotivo(e.target.value)}
                className="mt-1 w-full rounded border border-line px-2 py-1 text-sm"
              />
            </div>

            <ul className="flex flex-col gap-2">
              {lineas.map((l) => (
                <li
                  key={l.productoId}
                  data-testid={`devolucion-linea-${l.productoId}`}
                  className="flex flex-wrap items-center gap-2 rounded border border-line px-2 py-2 text-xs"
                >
                  <label className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={l.incluida}
                      onChange={(e) =>
                        editarLinea(l.productoId, { incluida: e.target.checked })
                      }
                      aria-label={`Incluir la línea ${l.productoNombre}`}
                    />
                    <span className="font-medium text-ink">
                      {l.productoNombre}
                    </span>
                    <span className="text-ink-muted">
                      (vendidas {l.cantidadOriginal})
                    </span>
                  </label>
                  <label className="flex items-center gap-1">
                    <span>Cant.</span>
                    <input
                      value={l.cantidad}
                      inputMode="decimal"
                      aria-label={`Cantidad a devolver de ${l.productoNombre}`}
                      onChange={(e) =>
                        editarLinea(l.productoId, { cantidad: e.target.value })
                      }
                      className="w-20 rounded border border-line px-1 py-0.5"
                    />
                  </label>
                  <label className="flex items-center gap-1">
                    <span>Reposición</span>
                    <select
                      value={l.tipoReposicion}
                      aria-label={`Tipo de reposición de ${l.productoNombre}`}
                      onChange={(e) =>
                        editarLinea(l.productoId, {
                          tipoReposicion: e.target.value as TipoReposicion,
                        })
                      }
                      className="rounded border border-line px-1 py-0.5"
                    >
                      <option value="VENDIBLE">VENDIBLE (reponer)</option>
                      <option value="DANADO">DANADO (pérdida)</option>
                    </select>
                  </label>
                </li>
              ))}
            </ul>

            <button
              type="submit"
              disabled={bloqueado}
              aria-label="Emitir nota de crédito"
              className="rounded bg-warn px-3 py-2 text-sm font-semibold text-accent-fg disabled:cursor-not-allowed disabled:opacity-50"
            >
              {enviando ? "Emitiendo…" : "Emitir nota de crédito"}
            </button>
          </form>
        )
      )}
    </div>
  );
}
