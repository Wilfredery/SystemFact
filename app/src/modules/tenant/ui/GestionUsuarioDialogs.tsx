"use client";

/**
 * Administración user-management dialogs (Step 7b, `odd/tasks/administracion-writes.md`
 * S11): "Cambiar roles" and the Activar/Desactivar confirmation.
 *
 * Presentational only — the screen owns the pending flag, the error text and the
 * action calls (server confirmation first, then a re-read; never optimistic).
 * Same dialog pattern as Clientes/Compras (`Dialog` + `aria-label` on the
 * content, an in-dialog `role="alert"`, a destructive primary for deactivation).
 * A refusal keeps the dialog open with the catalog message; every rule here
 * (at least one role, nothing to save) is UX, the server enforces them again.
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { RolCatalogoDto, UsuarioAdministracionDto } from "@/modules/tenant/http/shared";

const CLASE_ALERTA =
  "rounded-md bg-red-50 px-4 py-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-200";

function descripcionUsuario(usuario: UsuarioAdministracionDto): string {
  return `${usuario.nombre} (${usuario.nombreUsuario})`;
}

function mismosIds(a: ReadonlySet<number>, b: readonly number[]): boolean {
  return a.size === b.length && b.every((id) => a.has(id));
}

export interface CambiarRolesDialogProps {
  readonly usuario: UsuarioAdministracionDto;
  readonly catalogo: readonly RolCatalogoDto[];
  readonly enviando: boolean;
  readonly error: string | null;
  /** Selected role ids, in catalog order. */
  readonly onGuardar: (rolIds: number[]) => void;
  readonly onCerrar: () => void;
}

export function CambiarRolesDialog({
  usuario,
  catalogo,
  enviando,
  error,
  onGuardar,
  onCerrar,
}: CambiarRolesDialogProps) {
  // Preselect what the user holds today. The set lives for one open dialog, so a
  // conflict reload (new `usuario.version`/roles props) keeps the person's edits.
  const [seleccion, setSeleccion] = useState<ReadonlySet<number>>(
    () => new Set(usuario.rolIds.filter((id) => catalogo.some((r) => r.id === id))),
  );

  const cambio = !mismosIds(seleccion, usuario.rolIds);
  const puedeGuardar = !enviando && seleccion.size > 0 && cambio;

  function alternar(id: number): void {
    setSeleccion((actual) => {
      const siguiente = new Set(actual);
      if (siguiente.has(id)) siguiente.delete(id);
      else siguiente.add(id);
      return siguiente;
    });
  }

  return (
    <Dialog
      open
      onOpenChange={(abierto) => {
        if (!abierto && !enviando) onCerrar();
      }}
    >
      <DialogContent aria-label="Cambiar roles">
        <DialogHeader>
          <DialogTitle>Cambiar roles</DialogTitle>
          <DialogDescription>{descripcionUsuario(usuario)}</DialogDescription>
        </DialogHeader>

        <fieldset className="flex flex-col gap-2" disabled={enviando}>
          <legend className="mb-1 text-sm font-medium text-zinc-700 dark:text-zinc-300">Roles</legend>
          {catalogo.map((rol) => (
            <label key={rol.id} className="flex min-h-11 items-center gap-3 text-sm">
              <input
                type="checkbox"
                className="size-4"
                checked={seleccion.has(rol.id)}
                onChange={() => alternar(rol.id)}
              />
              {rol.nombre}
            </label>
          ))}
        </fieldset>

        {seleccion.size === 0 && (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">Seleccione al menos un rol.</p>
        )}

        {error !== null && (
          <p role="alert" className={CLASE_ALERTA}>
            {error}
          </p>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCerrar} disabled={enviando}>
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={() => onGuardar(catalogo.filter((r) => seleccion.has(r.id)).map((r) => r.id))}
            disabled={!puedeGuardar}
          >
            Guardar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export interface ConfirmarEstadoUsuarioDialogProps {
  readonly usuario: UsuarioAdministracionDto;
  /** The state the confirmation would set. */
  readonly activar: boolean;
  readonly enviando: boolean;
  readonly error: string | null;
  readonly onConfirmar: () => void;
  readonly onCerrar: () => void;
}

export function ConfirmarEstadoUsuarioDialog({
  usuario,
  activar,
  enviando,
  error,
  onConfirmar,
  onCerrar,
}: ConfirmarEstadoUsuarioDialogProps) {
  const accion = activar ? "Activar" : "Desactivar";

  return (
    <Dialog
      open
      onOpenChange={(abierto) => {
        if (!abierto && !enviando) onCerrar();
      }}
    >
      <DialogContent aria-label={`${accion} usuario`}>
        <DialogHeader>
          <DialogTitle>{`${accion} usuario`}</DialogTitle>
          <DialogDescription>{descripcionUsuario(usuario)}</DialogDescription>
        </DialogHeader>

        <p className="text-sm text-zinc-700 dark:text-zinc-300">
          {activar
            ? "Podrá iniciar sesión y operar de nuevo con sus roles actuales."
            : "No podrá iniciar sesión ni operar desde su próxima solicitud."}
        </p>
        {!activar && (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            No se elimina: el usuario queda inactivo y su historial se conserva.
          </p>
        )}

        {error !== null && (
          <p role="alert" className={CLASE_ALERTA}>
            {error}
          </p>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCerrar} disabled={enviando}>
            Cancelar
          </Button>
          <Button
            type="button"
            variant={activar ? "default" : "destructive"}
            onClick={onConfirmar}
            disabled={enviando}
          >
            {accion}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
