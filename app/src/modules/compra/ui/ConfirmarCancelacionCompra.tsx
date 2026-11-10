"use client";

/**
 * Compra cancellation dialog (screens plan Step 6, `odd/tasks/compras.md` S5).
 *
 * Mirrors the Proveedores deactivation confirmation: the motivo is MANDATORY
 * (the server's `zCancelarCompraInput` trims and rejects an empty one), so the
 * confirm control stays disabled until it is typed. Cancelling a purchase is
 * not a deletion and does not reverse inventory — the fiscal document set stays
 * intact — so the dialog states exactly what happens.
 */

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CLASE_ALERTA_COMPRA } from "./compra-form-utils";


export interface ConfirmarCancelacionCompraProps {
  readonly correlativoInterno: string;
  readonly motivo: string;
  readonly onMotivo: (motivo: string) => void;
  readonly enviando: boolean;
  readonly error: string | null;
  readonly onConfirmar: () => void;
  readonly onCerrar: () => void;
}

export function ConfirmarCancelacionCompra({
  correlativoInterno,
  motivo,
  onMotivo,
  enviando,
  error,
  onConfirmar,
  onCerrar,
}: ConfirmarCancelacionCompraProps) {
  return (
    <Dialog
      open
      onOpenChange={(abierto) => {
        if (!abierto && !enviando) onCerrar();
      }}
    >
      <DialogContent aria-label="Cancelar compra">
        <DialogHeader>
          <DialogTitle>Cancelar compra</DialogTitle>
          <DialogDescription>{correlativoInterno}</DialogDescription>
        </DialogHeader>

        <p className="text-sm text-zinc-700 dark:text-zinc-300">
          La compra queda cancelada y no se puede confirmar. No se elimina: su
          correlativo y su historial se conservan.
        </p>

        <div className="flex flex-col gap-2">
          <Label htmlFor="compra-motivo">Motivo de cancelación</Label>
          <Input
            id="compra-motivo"
            required
            value={motivo}
            onChange={(e) => onMotivo(e.target.value)}
            maxLength={255}
            autoComplete="off"
          />
        </div>

        {error !== null && (
          <p role="alert" className={CLASE_ALERTA_COMPRA}>
            {error}
          </p>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCerrar} disabled={enviando}>
            Volver
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={onConfirmar}
            disabled={enviando || motivo.trim() === ""}
          >
            Cancelar compra
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
