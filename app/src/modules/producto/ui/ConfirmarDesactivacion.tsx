"use client";

/**
 * Productos deactivation confirmation (plan Step 2, S4).
 *
 * A master entity is NEVER deleted: this dialog states what actually happens
 * (`activo=false`) and asks first. The server re-checks the role and the active
 * references; a refusal keeps the dialog open with the fixed message.
 */

import type { ProductoConsultaItem } from "@/modules/producto/application/producto-consulta-projection";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const CLASE_ALERTA =
  "rounded-md bg-red-50 px-4 py-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-200";

export interface ConfirmarDesactivacionProps {
  readonly producto: ProductoConsultaItem;
  readonly enviando: boolean;
  readonly error: string | null;
  readonly onConfirmar: () => void;
  readonly onCancelar: () => void;
}

export function ConfirmarDesactivacion({
  producto,
  enviando,
  error,
  onConfirmar,
  onCancelar,
}: ConfirmarDesactivacionProps) {
  return (
    <Dialog
      open
      onOpenChange={(abierto) => {
        if (!abierto && !enviando) onCancelar();
      }}
    >
      <DialogContent aria-label="Desactivar producto">
        <DialogHeader>
          <DialogTitle>Desactivar producto</DialogTitle>
          <DialogDescription>
            {producto.codigo} — {producto.nombre}
          </DialogDescription>
        </DialogHeader>
        <p className="text-sm text-zinc-700 dark:text-zinc-300">
          No se elimina: el producto queda inactivo y deja de aparecer en las listas y
          en la búsqueda de venta. Su historial y su código se conservan.
        </p>
        {error !== null && (
          <p role="alert" className={CLASE_ALERTA}>
            {error}
          </p>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancelar} disabled={enviando}>
            Cancelar
          </Button>
          <Button type="button" variant="destructive" onClick={onConfirmar} disabled={enviando}>
            Desactivar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
