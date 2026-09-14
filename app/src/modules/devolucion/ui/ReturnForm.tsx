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

import { useCallback, useEffect, useState } from "react";
import { obtenerVentaAction } from "@/modules/venta/http/actions";
import { devolverVentaAction } from "@/modules/devolucion/http/actions";
import { zDevolverVentaInput, VALIDATION_ERROR } from "@/modules/devolucion/http/validations";

/** One editable row: the ORIGINAL persisted sale line + the user's intent. */
interface LineaFormulario {
  readonly productoId: number;
  readonly productoNombre: string;
  /** Original sold quantity, `Decimal(12,3)` string. */
  readonly cantidadOriginal: string;
  readonly incluida: boolean;
  readonly cantidad: string;
  readonly tipoReposicion: "VENDIBLE" | "DANADO";
}

type Mensaje =
  | { readonly kind: "ok"; readonly text: string }
  | { readonly kind: "error"; readonly code: string; readonly text: string }
  | null;

export function ReturnForm({
  ventaId,
  onClose,
}: {
  ventaId: number;
  onClose: () => void;
}) {
  const [cargando, setCargando] = useState(true);
  const [lineas, setLineas] = useState<readonly LineaFormulario[]>([]);
  const [motivo, setMotivo] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [mensaje, setMensaje] = useState<Mensaje>(null);

  useEffect(() => {
    // Mount fetch settles state from the action's resolution callback (an
    // external-system boundary), never synchronously in the effect body
    // (same convention as `PosScreen`).
    void obtenerVentaAction({ id: ventaId }).then((r) => {
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
    if (enviando) return;
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
        text: "Complete the reason and a valid quantity for at least one line.",
      });
      return;
    }
    setEnviando(true);
    setMensaje(null);
    const r = await devolverVentaAction(parsed.data);
    if (r.ok) {
      const aviso90 = r.warnings !== undefined && r.warnings.length > 0;
      setMensaje({
        kind: "ok",
        text: aviso90
          ? `Credit note NC #${r.data.id} issued — NCF ${r.data.ncf}. NCF range at 90%.`
          : `Credit note NC #${r.data.id} issued — NCF ${r.data.ncf} (${r.data.monto} RD$).`,
      });
    } else {
      setMensaje({ kind: "error", code: r.error.code, text: r.error.message });
    }
    setEnviando(false);
  }

  const bloqueado = enviando || cargando || lineas.length === 0;

  return (
    <div
      data-testid={`devolucion-form-${ventaId}`}
      className="absolute right-0 top-full z-10 mt-1 max-h-[32rem] w-96 max-w-full overflow-y-auto rounded-lg border border-zinc-200 bg-white p-4 shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
          Return sale #{ventaId} (Nota de Crédito B04)
        </h3>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close return form"
          className="rounded border border-zinc-300 px-2 py-1 text-xs text-zinc-600 dark:border-zinc-700 dark:text-zinc-300"
        >
          Close
        </button>
      </div>

      {mensaje !== null && (
        <p
          role="status"
          aria-live="polite"
          className={
            mensaje.kind === "ok"
              ? "mt-2 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"
              : "mt-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-200"
          }
        >
          {mensaje.kind === "error" && (
            <span className="mr-2 font-mono text-xs">[{mensaje.code}]</span>
          )}
          {mensaje.text}
        </p>
      )}

      {cargando ? (
        <p className="mt-2 text-sm text-zinc-500">Loading sale lines…</p>
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
                className="block text-xs font-medium text-zinc-700 dark:text-zinc-300"
              >
                Reason for return
              </label>
              <input
                id={`devolucion-motivo-${ventaId}`}
                value={motivo}
                maxLength={255}
                onChange={(e) => setMotivo(e.target.value)}
                className="mt-1 w-full rounded border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-800"
              />
            </div>

            <ul className="flex flex-col gap-2">
              {lineas.map((l) => (
                <li
                  key={l.productoId}
                  data-testid={`devolucion-linea-${l.productoId}`}
                  className="flex flex-wrap items-center gap-2 rounded border border-zinc-200 px-2 py-2 text-xs dark:border-zinc-800"
                >
                  <label className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={l.incluida}
                      onChange={(e) =>
                        editarLinea(l.productoId, { incluida: e.target.checked })
                      }
                      aria-label={`Include line ${l.productoNombre}`}
                    />
                    <span className="font-medium text-zinc-900 dark:text-zinc-50">
                      {l.productoNombre}
                    </span>
                    <span className="text-zinc-500">
                      (sold {l.cantidadOriginal})
                    </span>
                  </label>
                  <label className="flex items-center gap-1">
                    <span>Qty</span>
                    <input
                      value={l.cantidad}
                      inputMode="decimal"
                      aria-label={`Qty to return for ${l.productoNombre}`}
                      onChange={(e) =>
                        editarLinea(l.productoId, { cantidad: e.target.value })
                      }
                      className="w-20 rounded border border-zinc-300 px-1 py-0.5 dark:border-zinc-700 dark:bg-zinc-800"
                    />
                  </label>
                  <label className="flex items-center gap-1">
                    <span>Restock</span>
                    <select
                      value={l.tipoReposicion}
                      aria-label={`Restock type for ${l.productoNombre}`}
                      onChange={(e) =>
                        editarLinea(l.productoId, {
                          tipoReposicion: e.target.value as "VENDIBLE" | "DANADO",
                        })
                      }
                      className="rounded border border-zinc-300 px-1 py-0.5 dark:border-zinc-700 dark:bg-zinc-800"
                    >
                      <option value="VENDIBLE">VENDIBLE (restock)</option>
                      <option value="DANADO">DANADO (loss)</option>
                    </select>
                  </label>
                </li>
              ))}
            </ul>

            <button
              type="submit"
              disabled={bloqueado}
              aria-label="Emit credit note"
              className="rounded bg-amber-600 px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {enviando ? "Issuing…" : "Emit credit note"}
            </button>
          </form>
        )
      )}
    </div>
  );
}
