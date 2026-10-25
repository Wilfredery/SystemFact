"use client";

import { Button } from "@/components/ui/button";

/**
 * F0 numeric keypad (F2 slice D, D4/R-V23) — the ONLY new primitive F2 adds.
 *
 * 13 F0 Button primitives (48px `size="pos"`) inside a `role="group"` container.
 * `onPointerDown` runs with `preventDefault()` AND an `onClick` handler so a
 * physical press never steals focus from the paired input (DOM-order tabbable,
 * keyboard users keep the input). Visual design stays structural (F0 outline
 * buttons; board `02-Venta-Credito` owns later polish).
 */

export type TeclaNumerica = "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "." | "BSP" | "CLR";

export interface NumericKeypadProps {
  readonly onTecla: (tecla: TeclaNumerica) => void;
  readonly ariaLabel?: string;
  readonly className?: string;
}

const FILAS: readonly TeclaNumerica[][] = [
  ["7", "8", "9"],
  ["4", "5", "6"],
  ["1", "2", "3"],
  ["0", ".", "BSP"],
];

const ETIQUETA: Partial<Record<TeclaNumerica, string>> = {
  BSP: "⌫",
  CLR: "CLR",
};

export function NumericKeypad({ onTecla, ariaLabel = "Numeric keypad", className }: NumericKeypadProps) {
  return (
    <div role="group" aria-label={ariaLabel} className={className}>
      {FILAS.map((fila) => (
        <div key={fila.join("")} className="grid grid-cols-3 gap-2">
          {fila.map((tecla) => (
            <Button
              key={tecla}
              type="button"
              variant="outline"
              size="pos"
              aria-label={tecla}
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => onTecla(tecla)}
            >
              {ETIQUETA[tecla] ?? tecla}            </Button>
          ))}
        </div>
      ))}
      <div className="mt-2 grid grid-cols-3 gap-2">
        <Button
          type="button"
          variant="outline"
          size="pos"
          className="col-span-3"
          aria-label="CLR"
          onPointerDown={(e) => e.preventDefault()}
          onClick={() => onTecla("CLR")}
        >
          CLR
        </Button>
      </div>
    </div>
  );
}
