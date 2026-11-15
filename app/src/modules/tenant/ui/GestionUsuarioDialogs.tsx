"use client";

/**
 * Administración user-management dialogs (Step 7b, `odd/tasks/administracion-writes.md`
 * S11): "Cambiar roles" and the Activar/Desactivar confirmation, plus the
 * "Mover de sucursal" dialog (`odd/tasks/administracion-mover-usuario.md` S10).
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
import type {
  RolCatalogoDto,
  SucursalAdministracionDto,
  UsuarioAdministracionDto,
} from "@/modules/tenant/http/shared";

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

/** The company's active branches as the move dialog receives them. */
export type SucursalesDestino =
  | { readonly estado: "cargando" }
  | { readonly estado: "error"; readonly mensaje: string }
  | { readonly estado: "listo"; readonly sucursales: readonly SucursalAdministracionDto[] };

export interface MoverUsuarioDialogProps {
  readonly usuario: UsuarioAdministracionDto;
  readonly destinos: SucursalesDestino;
  readonly enviando: boolean;
  readonly error: string | null;
  /** The chosen destination branch id. */
  readonly onConfirmar: (sucursalDestinoId: number) => void;
  readonly onCerrar: () => void;
}

/**
 * "Mover de sucursal": pick one of the OTHER active branches, read the explicit
 * confirmation and confirm. Presentational: the screen owns the pending flag and
 * the action call; the new branch is shown only after the server answered ok.
 * Every rule here is UX (the server re-validates destination, last Administrador,
 * self-move and version).
 */
export function MoverUsuarioDialog({
  usuario,
  destinos,
  enviando,
  error,
  onConfirmar,
  onCerrar,
}: MoverUsuarioDialogProps) {
  const [elegida, setElegida] = useState("");

  const candidatas =
    destinos.estado === "listo"
      ? destinos.sucursales.filter((s) => s.id !== usuario.sucursalId)
      : [];
  const destino = candidatas.find((s) => String(s.id) === elegida);

  return (
    <Dialog
      open
      onOpenChange={(abierto) => {
        if (!abierto && !enviando) onCerrar();
      }}
    >
      <DialogContent aria-label="Mover de sucursal">
        <DialogHeader>
          <DialogTitle>Mover de sucursal</DialogTitle>
          <DialogDescription>
            {`${descripcionUsuario(usuario)} · Sucursal actual: ${usuario.sucursalNombre}`}
          </DialogDescription>
        </DialogHeader>

        {destinos.estado === "cargando" && (
          <p role="status" className="text-sm text-zinc-500 dark:text-zinc-400">
            Cargando sucursales...
          </p>
        )}
        {destinos.estado === "error" && (
          <p role="alert" className={CLASE_ALERTA}>
            {destinos.mensaje}
          </p>
        )}
        {destinos.estado === "listo" && candidatas.length === 0 && (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            No hay otra sucursal activa a la que mover a este usuario.
          </p>
        )}
        {candidatas.length > 0 && (
          <>
            <label className="flex flex-col gap-1 text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Sucursal destino
              <select
                value={elegida}
                onChange={(e) => setElegida(e.target.value)}
                disabled={enviando}
                className="min-h-11 rounded-md border border-zinc-300 bg-white px-3 text-sm font-normal text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
              >
                <option value="">Seleccione una sucursal</option>
                {candidatas.map((s) => (
                  <option key={s.id} value={String(s.id)}>
                    {s.nombre}
                  </option>
                ))}
              </select>
            </label>
            {destino !== undefined && (
              <p className="text-sm text-zinc-700 dark:text-zinc-300">
                {`Se moverá a ${descripcionUsuario(usuario)} de ${usuario.sucursalNombre} a ${destino.nombre}. Operará en la nueva sucursal desde su próxima solicitud; su historial se conserva en la sucursal donde se generó.`}
              </p>
            )}
          </>
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
          {candidatas.length > 0 && (
            <Button
              type="button"
              onClick={() => {
                if (destino !== undefined) onConfirmar(destino.id);
              }}
              disabled={enviando || destino === undefined}
            >
              Mover usuario
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
