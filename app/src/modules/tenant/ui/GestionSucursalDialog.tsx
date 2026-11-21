"use client";

/**
 * "Nueva sucursal" / "Editar" dialog of the Sucursales tab
 * (`odd/tasks/administracion-sucursales-crear-editar.md` S9). One component for
 * both: create starts empty, edit is prefilled from the row.
 *
 * Presentational only — the screen owns the pending flag, the error text and the
 * action calls (server confirmation first, then a re-read; never optimistic).
 * The field rules mirror the server's zod schema (`z.string().trim().min(1).max(255)`):
 * they are UX, the action validates again. Edit with nothing changed keeps the
 * confirm button disabled, like "Cambiar roles" (the server would answer an
 * idempotent no-op anyway).
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
import type { SucursalAdministracionDto, SucursalGestionDto } from "@/modules/tenant/http/shared";
import { validarTextoSucursal } from "./administracion-tabs";

const CLASE_ALERTA =
  "rounded-md bg-danger/10 px-4 py-2 text-sm text-danger";
const CLASE_CONTROL =
  "min-h-11 rounded-md border border-line bg-surface px-3 text-sm font-normal text-ink";

export interface DatosSucursalFormulario {
  readonly nombre: string;
  readonly direccion: string;
  readonly telefono: string;
}

type CampoSucursal = keyof DatosSucursalFormulario;

const CAMPOS: readonly { clave: CampoSucursal; etiqueta: string }[] = [
  { clave: "nombre", etiqueta: "Nombre" },
  { clave: "direccion", etiqueta: "Dirección" },
  { clave: "telefono", etiqueta: "Teléfono" },
];

export interface SucursalDialogProps {
  /** `null` = create (empty fields); a row = edit (prefilled). */
  readonly sucursal: SucursalAdministracionDto | null;
  readonly enviando: boolean;
  readonly error: string | null;
  /** The three TRIMMED values. */
  readonly onConfirmar: (datos: DatosSucursalFormulario) => void;
  readonly onCerrar: () => void;
}

export function SucursalDialog({
  sucursal,
  enviando,
  error,
  onConfirmar,
  onCerrar,
}: SucursalDialogProps) {
  const editando = sucursal !== null;
  // The values live for one open dialog, so a conflict reload (new row props)
  // keeps what the person typed.
  const [valores, setValores] = useState<DatosSucursalFormulario>({
    nombre: sucursal?.nombre ?? "",
    direccion: sucursal?.direccion ?? "",
    telefono: sucursal?.telefono ?? "",
  });
  const [tocados, setTocados] = useState<ReadonlySet<CampoSucursal>>(new Set());

  const errores = {
    nombre: validarTextoSucursal(valores.nombre),
    direccion: validarTextoSucursal(valores.direccion),
    telefono: validarTextoSucursal(valores.telefono),
  };
  const valido = CAMPOS.every((c) => errores[c.clave] === null);
  const recortados: DatosSucursalFormulario = {
    nombre: valores.nombre.trim(),
    direccion: valores.direccion.trim(),
    telefono: valores.telefono.trim(),
  };
  const cambio =
    !editando ||
    CAMPOS.some((c) => recortados[c.clave] !== sucursal[c.clave]);
  const puedeConfirmar = !enviando && valido && cambio;
  const titulo = editando ? "Editar sucursal" : "Nueva sucursal";

  function marcar(clave: CampoSucursal): void {
    setTocados((actual) => new Set(actual).add(clave));
  }

  return (
    <Dialog
      open
      onOpenChange={(abierto) => {
        if (!abierto && !enviando) onCerrar();
      }}
    >
      <DialogContent aria-label={titulo}>
        <DialogHeader>
          <DialogTitle>{titulo}</DialogTitle>
          <DialogDescription>
            {editando
              ? `Sucursal actual: ${sucursal.nombre}`
              : "Todos los campos son obligatorios."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          {CAMPOS.map((c) => {
            const mensaje = tocados.has(c.clave) ? errores[c.clave] : null;
            const idError = `sucursal-${c.clave}-error`;
            return (
              <div key={c.clave} className="flex flex-col gap-1">
                <label className="flex flex-col gap-1 text-sm font-medium text-ink">
                  {c.etiqueta}
                  <input
                    type="text"
                    value={valores[c.clave]}
                    onChange={(e) => {
                      const texto = e.target.value;
                      setValores((actual) => ({ ...actual, [c.clave]: texto }));
                      marcar(c.clave);
                    }}
                    onBlur={() => marcar(c.clave)}
                    disabled={enviando}
                    aria-invalid={mensaje !== null}
                    aria-describedby={mensaje !== null ? idError : undefined}
                    className={CLASE_CONTROL}
                  />
                </label>
                {mensaje !== null && (
                  <span id={idError} className="text-xs text-danger">
                    {mensaje}
                  </span>
                )}
              </div>
            );
          })}
        </div>

        {valido && cambio && (
          <p className="text-sm text-ink">
            {editando
              ? `Se guardarán los cambios de la sucursal ${recortados.nombre}.`
              : `Se creará la sucursal ${recortados.nombre} y quedará activa. Las sucursales no se eliminan.`}
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
          <Button type="button" onClick={() => onConfirmar(recortados)} disabled={!puedeConfirmar}>
            {editando ? "Guardar cambios" : "Crear sucursal"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export interface ConfirmarEstadoSucursalDialogProps {
  readonly sucursal: SucursalGestionDto;
  /** The state the confirmation would set. */
  readonly activar: boolean;
  readonly enviando: boolean;
  readonly error: string | null;
  readonly onConfirmar: () => void;
  readonly onCerrar: () => void;
}

/**
 * Confirmation of "Desactivar" / "Activar" a branch (activate/deactivate slice S8):
 * names the branch and states the effect. Presentational: the screen owns the
 * pending flag and the action call; the new state is shown only after the server
 * answered ok and the list was re-read.
 */
export function ConfirmarEstadoSucursalDialog({
  sucursal,
  activar,
  enviando,
  error,
  onConfirmar,
  onCerrar,
}: ConfirmarEstadoSucursalDialogProps) {
  const accion = activar ? "Activar" : "Desactivar";
  const titulo = `${accion} sucursal`;

  return (
    <Dialog
      open
      onOpenChange={(abierto) => {
        if (!abierto && !enviando) onCerrar();
      }}
    >
      <DialogContent aria-label={titulo}>
        <DialogHeader>
          <DialogTitle>{titulo}</DialogTitle>
          <DialogDescription>{`Sucursal: ${sucursal.nombre}`}</DialogDescription>
        </DialogHeader>

        <p className="text-sm text-ink">
          {activar
            ? `Se activará la sucursal ${sucursal.nombre}: volverá a estar disponible para elegirla y mover usuarios a ella.`
            : `Se desactivará la sucursal ${sucursal.nombre}: dejará de estar disponible para elegirla y para mover usuarios a ella.`}
        </p>
        {!activar && (
          <p className="text-sm text-ink-muted">
            No se elimina: la sucursal queda inactiva, su historial se conserva y puede activarse de nuevo. Solo
            se puede desactivar sin usuarios activos, existencias, documentos abiertos ni facturas con saldo
            pendiente.
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
