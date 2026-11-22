"use client";

/**
 * Return control for a confirmed sale (fase-5d, task 2.1).
 *
 * A small client wrapper mounted on CONFIRMADA rows of the venta "My drafts"
 * list: the button carries the first-click disable guard (single-flight, the
 * same single-shot pattern as the fase-5c confirm control — a double click
 * must never open two dialogs or fire the action twice), and toggles the
 * inline `ReturnForm` panel that consumes `devolverVentaAction`.
 *
 * Mounted from `app/src/modules/venta/ui/DraftList.tsx` (the minimal venta-UI
 * mounting point agreed in the design): CONFIRMADA rows are exactly the sales
 * with a VIGENTE invoice a return may reference.
 */

import { useState } from "react";
import { ReturnForm } from "./ReturnForm";

export function DevolverButton({ ventaId }: { readonly ventaId: number }) {
  const [abierto, setAbierto] = useState(false);
  // While a dialog toggle is in flight (a click already processed), the button
  // stays disabled so a same-cycle double event cannot flip it twice.
  const [cerrando, setCerrando] = useState(false);
  // A credit note is being issued: the opener must not unmount the form and hide the result.
  const [ocupado, setOcupado] = useState(false);

  function alternar(): void {
    setAbierto((prev) => !prev);
  }

  function cerrar(): void {
    // Debounce the close toggle so the guard is observable (first-click
    // disable) on both directions; re-enables on the next frame via the
    // form unmount below.
    if (cerrando) return;
    setCerrando(true);
    setAbierto(false);
    setTimeout(() => setCerrando(false), 0);
  }

  return (
    <div className="relative flex items-center gap-2">
      <button
        type="button"
        onClick={alternar}
        disabled={cerrando || ocupado}
        aria-label={`Devolver venta ${ventaId}`}
        aria-expanded={abierto}
        data-testid={`devolucion-boton-${ventaId}`}
        className="rounded border border-warn px-2 py-1 text-xs font-medium text-warn hover:bg-warn-bg disabled:cursor-not-allowed disabled:opacity-50"
      >
        Devolver
      </button>
      {abierto && <ReturnForm ventaId={ventaId} onClose={cerrar} onOcupado={setOcupado} />}
    </div>
  );
}
