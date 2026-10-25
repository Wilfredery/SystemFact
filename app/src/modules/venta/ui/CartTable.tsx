"use client";

/**
 * Ephemeral cart table (spec R-V14): add/remove plus quantity and unit-price
 * editing, each row showing the live per-line ITBIS at its rate. Editing a
 * field keeps the raw string in state (the preview skips not-yet-valid lines);
 * money never round-trips through a float.
 */

import { formatearMonto } from "@/shared/ui/format";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { DESCUENTO_TIPO, type Descuento } from "../domain/venta";
import type { LineaPreview } from "./carro";

export function CartTable({
  lineas,
  puedeDescontar,
  keypadObjetivo,
  onSetKeypadTarget,
  onCantidadChange,
  onPrecioChange,
  onRemove,
  onDescuentoLineaChange,
  onDescuentoLineaClear,
}: {
  readonly lineas: readonly LineaPreview[];
  /** Admin gate (D2/R-V21): only admins get per-line discount inputs — the
   * server's role-gated (_, patch) path remains the real authorization. */
  readonly puedeDescontar: boolean;
  /** F2 4.6 (D4/R-V23): keypad target display affordance — read-only here. */
  readonly keypadObjetivo:
    | { campo: "vuelto" }
    | { campo: "cantidad" | "precioUnitario"; productoId: number }
    | null;
  readonly onSetKeypadTarget: (
    t: { campo: "cantidad" | "precioUnitario"; productoId: number } | null,
  ) => void;
  readonly onCantidadChange: (productoId: number, valor: string) => void;
  readonly onPrecioChange: (productoId: number, valor: string) => void;
  readonly onRemove: (productoId: number) => void;
  readonly onDescuentoLineaChange: (
    productoId: number,
    parcial: Partial<Descuento>,
  ) => void;
  readonly onDescuentoLineaClear: (productoId: number) => void;
}) {
  return (
    <Card aria-label="Cart">
      <CardHeader>
        <CardTitle className="text-sm font-semibold">Cart</CardTitle>
      </CardHeader>
      <CardContent>
        {lineas.length === 0 ? (
          <p className="text-sm text-ink-muted">No products yet. Search and add a product.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="text-xs uppercase text-ink-muted">
                <TableHead className="pr-3 text-xs uppercase text-ink-muted">Product</TableHead>
                <TableHead className="pr-3 text-xs uppercase text-ink-muted">Qty</TableHead>
                <TableHead className="pr-3 text-xs uppercase text-ink-muted">Unit price</TableHead>
                {puedeDescontar && (
                  <TableHead className="pr-3 text-xs uppercase text-ink-muted">Line discount</TableHead>
                )}
                <TableHead className="pr-3 text-xs uppercase text-ink-muted">ITBIS</TableHead>
                <TableHead className="pr-3 text-xs uppercase text-ink-muted">Subtotal</TableHead>
                <TableHead className="text-xs uppercase text-ink-muted">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lineas.map(({ linea, calculo, computable }) => (
                <TableRow key={linea.productoId} className="py-2">
                  <TableCell className="py-2 pr-3">
                    <p className="font-medium text-ink">{linea.nombre}</p>
                    <p className="text-xs text-ink-muted">{linea.codigo}</p>
                  </TableCell>
                  <TableCell className="py-2 pr-3">
                    <Input
                      type="text"
                      inputMode="decimal"
                      value={linea.cantidad}
                      onChange={(e) => onCantidadChange(linea.productoId, e.target.value)}
                      onFocus={() =>
                        onSetKeypadTarget({ campo: "cantidad", productoId: linea.productoId })
                      }
                      aria-label={`Quantity for ${linea.nombre}`}
                      className="h-12 w-16 px-2 text-right"
                    />
                    {keypadObjetivo !== null &&
                      keypadObjetivo.campo === "cantidad" &&
                      keypadObjetivo.productoId === linea.productoId && (
                        <span className="text-xs text-link">⌨</span>
                      )}
                  </TableCell>
                  <TableCell className="py-2 pr-3">
                    <Input
                      type="text"
                      inputMode="decimal"
                      value={linea.precioUnitario}
                      onChange={(e) => onPrecioChange(linea.productoId, e.target.value)}
                      onFocus={() =>
                        onSetKeypadTarget({ campo: "precioUnitario", productoId: linea.productoId })
                      }
                      aria-label={`Unit price for ${linea.nombre}`}
                      className="h-12 w-24 px-2 text-right"
                    />
                  </TableCell>
                  {puedeDescontar && (
                    <TableCell className="py-2 pr-3">
                      <div className="flex items-center gap-1">
                        <select
                          aria-label={`Discount type for ${linea.nombre}`}
                          value={linea.descuento.descuentoTipo}
                          onChange={(e) =>
                            onDescuentoLineaChange(linea.productoId, {
                              descuentoTipo: e.target.value as Descuento["descuentoTipo"],
                            })
                          }
                          className="min-h-11 w-28 rounded-lg border border-line bg-surface px-2 text-xs text-ink"
                        >
                          {Object.values(DESCUENTO_TIPO).map((t) => (
                            <option key={t} value={t}>
                              {t}
                            </option>
                          ))}
                        </select>
                        <Input
                          type="text"
                          inputMode="decimal"
                          value={linea.descuento.descuentoValor}
                          onChange={(e) =>
                            onDescuentoLineaChange(linea.productoId, {
                              descuentoValor: e.target.value,
                            })
                          }
                          aria-label={`Discount value for ${linea.nombre}`}
                          className="h-11 w-16 px-2 text-right text-xs"
                        />
                        {linea.descuento.descuentoValor !== "0.00" && (
                          <Button
                            type="button"
                            variant="outline"
                            size="pos"
                            onClick={() => onDescuentoLineaClear(linea.productoId)}
                            aria-label={`Clear discount for ${linea.nombre}`}
                            className="text-xs"
                          >
                            ×
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  )}
                  <TableCell className="py-2 pr-3 text-ink">
                    {computable && calculo !== null ? (
                      <>
                        {formatearMonto(calculo.itbisLinea)}{" "}
                        <span className="text-xs text-ink-muted">({linea.tasaItbis}%)</span>
                      </>
                    ) : (
                      <span className="text-xs text-warn">invalid</span>
                    )}
                  </TableCell>
                  <TableCell className="py-2 pr-3 text-ink">
                    {computable && calculo !== null ? formatearMonto(calculo.baseLinea) : "—"}
                  </TableCell>
                  <TableCell className="py-2 text-right">
                    <Button
                      type="button"
                      variant="destructive"
                      size="pos"
                      onClick={() => onRemove(linea.productoId)}
                      aria-label={`Remove ${linea.nombre}`}
                    >
                      Remove
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
