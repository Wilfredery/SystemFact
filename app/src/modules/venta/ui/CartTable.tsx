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
import type { LineaPreview } from "./carro";

export function CartTable({
  lineas,
  onCantidadChange,
  onPrecioChange,
  onRemove,
}: {
  readonly lineas: readonly LineaPreview[];
  readonly onCantidadChange: (productoId: number, valor: string) => void;
  readonly onPrecioChange: (productoId: number, valor: string) => void;
  readonly onRemove: (productoId: number) => void;
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
                      aria-label={`Quantity for ${linea.nombre}`}
                      className="h-12 w-16 px-2 text-right"
                    />
                  </TableCell>
                  <TableCell className="py-2 pr-3">
                    <Input
                      type="text"
                      inputMode="decimal"
                      value={linea.precioUnitario}
                      onChange={(e) => onPrecioChange(linea.productoId, e.target.value)}
                      aria-label={`Unit price for ${linea.nombre}`}
                      className="h-12 w-24 px-2 text-right"
                    />
                  </TableCell>
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
