"use client";

/**
 * Proveedores deactivation confirmation (screens plan Step 4, S4).
 *
 * A master entity is NEVER deleted: this dialog states what actually happens
 * (`activo=false`) and asks first. The server re-checks the role (Administrador
 * only) and the live-purchase guard; a refusal keeps the dialog open with the
 * fixed message.
 */

import type { ProveedorDto } from "@/modules/proveedor/http/shared";
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

export interface ConfirmarDesactivacionProveedorProps {
  readonly proveedor: ProveedorDto;
  readonly enviando: boolean;
  readonly error: string | null;
  readonly onConfirmar: () => void;
  readonly onCancelar: () => void;
}

export function ConfirmarDesactivacionProveedor({
  proveedor,
  enviando,
  error,
  onConfirmar,
  onCancelar,
}: ConfirmarDesactivacionProveedorProps) {
  return (
    <Dialog
      open
      onOpenChange={(abierto) => {
        if (!abierto && !enviando) onCancelar();
      }}
    >
      <DialogContent aria-label="Desactivar proveedor">
        <DialogHeader>
          <DialogTitle>Desactivar proveedor</DialogTitle>
          <DialogDescription>
            {proveedor.nombre}
            {proveedor.rnc === null ? "" : ` — ${proveedor.rnc}`}
          </DialogDescription>
        </DialogHeader>
        <p className="text-sm text-zinc-700 dark:text-zinc-300">
          No se elimina: el proveedor queda inactivo y deja de aparecer en las listas y en la
          búsqueda de compra. Su historial, sus compras y su RNC se conservan.
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
