"use client";

/**
 * Clientes deactivation confirmation (screens plan Step 3, S4).
 *
 * A master entity is NEVER deleted: this dialog states what actually happens
 * (`activo=false`) and asks first. The server re-checks the role (Administrador
 * only) and the active-sales guard; a refusal keeps the dialog open with the
 * fixed message.
 */

import type { ClienteDto } from "@/modules/cliente/http/shared";
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
  "rounded-md bg-danger/10 px-4 py-2 text-sm text-danger";

export interface ConfirmarDesactivacionClienteProps {
  readonly cliente: ClienteDto;
  readonly enviando: boolean;
  readonly error: string | null;
  readonly onConfirmar: () => void;
  readonly onCancelar: () => void;
}

export function ConfirmarDesactivacionCliente({
  cliente,
  enviando,
  error,
  onConfirmar,
  onCancelar,
}: ConfirmarDesactivacionClienteProps) {
  return (
    <Dialog
      open
      onOpenChange={(abierto) => {
        if (!abierto && !enviando) onCancelar();
      }}
    >
      <DialogContent aria-label="Desactivar cliente">
        <DialogHeader>
          <DialogTitle>Desactivar cliente</DialogTitle>
          <DialogDescription>
            {cliente.nombre}
            {cliente.identificacionFiscal === null
              ? ""
              : ` — ${cliente.identificacionFiscal}`}
          </DialogDescription>
        </DialogHeader>
        <p className="text-sm text-ink">
          No se elimina: el cliente queda inactivo y deja de aparecer en las listas y en la
          búsqueda de venta. Su historial, sus documentos y su RNC se conservan.
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
