"use client";

/**
 * Proveedores create/edit dialog (screens plan Step 4, S1/S3/S4).
 *
 * Client island for the interactivity only: the page already refused to render
 * the manage controls for a view-only role, and each write action re-checks the
 * role on the server. The RNC rule is the DOMAIN's own (separators stripped,
 * 9–11 digits, blank = informal supplier), so the form stops exactly what the
 * server would refuse.
 *
 * The screen offers the identity and contact fields the domain owns: nombre
 * (razón social), RNC, contacto, teléfono and the two frozen fiscal
 * classifications. Editing sends back the `version` the single-supplier read
 * returned, so a concurrent edit is refused instead of silently overwritten
 * (S4).
 */

import { useState, type FormEvent } from "react";
import {
  actualizarProveedorAction,
  crearProveedorAction,
} from "@/modules/proveedor/http/actions";
import type { ProveedorDetalleDto } from "@/modules/proveedor/http/shared";
import { RNC_FORMATO_INVALIDO, messageFor } from "@/modules/proveedor/domain/errors";
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
import { TIPOS_PERSONA, TIPOS_PROVEEDOR, esRncValido } from "./proveedores-filtros";

const MENSAJE_FALLO_ACCION = "No se pudo guardar el proveedor. Intente de nuevo.";
const MENSAJE_RNC_INVALIDO = messageFor(RNC_FORMATO_INVALIDO);
const CLASE_CONTROL =
  "min-h-11 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50";
const CLASE_ALERTA =
  "rounded-md bg-red-50 px-4 py-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-200";

export interface ProveedorFormularioProps {
  readonly proveedor: ProveedorDetalleDto | null;
  readonly onGuardado: () => void;
  readonly onCancelar: () => void;
}

export function ProveedorFormulario({
  proveedor,
  onGuardado,
  onCancelar,
}: ProveedorFormularioProps) {
  const editando = proveedor !== null;
  const [nombre, setNombre] = useState(proveedor?.nombre ?? "");
  const [rnc, setRnc] = useState(proveedor?.rnc ?? "");
  const [contacto, setContacto] = useState(proveedor?.contacto ?? "");
  const [telefono, setTelefono] = useState(proveedor?.telefono ?? "");
  const [tipoProveedor, setTipoProveedor] = useState(proveedor?.tipoProveedor ?? "FORMAL");
  const [tipoPersona, setTipoPersona] = useState(proveedor?.tipoPersona ?? "JURIDICA");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rncVacio = rnc.trim() === "";
  const rncInvalido = !rncVacio && !esRncValido(rnc);
  const completo =
    nombre.trim() !== "" &&
    contacto.trim() !== "" &&
    telefono.trim() !== "" &&
    !rncInvalido &&
    !enviando;

  function camposBase() {
    return {
      nombre: nombre.trim(),
      rnc: rncVacio ? null : rnc.trim(),
      contacto: contacto.trim(),
      telefono: telefono.trim(),
      tipoProveedor,
      tipoPersona,
    };
  }

  async function guardar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (!completo) return;

    setEnviando(true);
    setError(null);
    const base = camposBase();
    try {
      const r =
        proveedor === null
          ? await crearProveedorAction(base)
          : await actualizarProveedorAction({
              id: proveedor.id,
              version: proveedor.version,
              ...base,
            });
      if (r.ok) {
        onGuardado();
        return;
      }
      setError(r.error.message);
      setEnviando(false);
    } catch {
      setError(MENSAJE_FALLO_ACCION);
      setEnviando(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(abierto) => {
        if (!abierto && !enviando) onCancelar();
      }}
    >
      <DialogContent aria-label={editando ? "Editar proveedor" : "Nuevo proveedor"}>
        <form onSubmit={(e) => void guardar(e)} noValidate className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{editando ? "Editar proveedor" : "Nuevo proveedor"}</DialogTitle>
            <DialogDescription>
              {editando
                ? "Los cambios se guardan sobre la versión leída; un cambio simultáneo se rechaza."
                : "Nombre o razón social, contacto y teléfono son obligatorios. El RNC es opcional para un suplidor informal."}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-2">
            <Label htmlFor="proveedor-nombre">Nombre o razón social *</Label>
            <Input
              id="proveedor-nombre"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              maxLength={255}
              autoComplete="off"
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="proveedor-rnc">RNC</Label>
            <Input
              id="proveedor-rnc"
              inputMode="numeric"
              value={rnc}
              onChange={(e) => setRnc(e.target.value)}
              maxLength={20}
              placeholder="138000001"
              autoComplete="off"
              aria-describedby="proveedor-rnc-detalle"
            />
          </div>
          <p id="proveedor-rnc-detalle" aria-live="polite" className="min-h-5 text-sm">
            {rncInvalido && (
              <span className="text-red-700 dark:text-red-300">{MENSAJE_RNC_INVALIDO}</span>
            )}
          </p>

          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="proveedor-contacto">Contacto *</Label>
              <Input
                id="proveedor-contacto"
                value={contacto}
                onChange={(e) => setContacto(e.target.value)}
                maxLength={255}
                autoComplete="off"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="proveedor-telefono">Teléfono *</Label>
              <Input
                id="proveedor-telefono"
                value={telefono}
                onChange={(e) => setTelefono(e.target.value)}
                maxLength={255}
                autoComplete="off"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="proveedor-tipo">Tipo de proveedor *</Label>
              <select
                id="proveedor-tipo"
                value={tipoProveedor}
                onChange={(e) => setTipoProveedor(e.target.value)}
                className={CLASE_CONTROL}
              >
                {TIPOS_PROVEEDOR.map((t) => (
                  <option key={t.valor} value={t.valor}>
                    {t.etiqueta}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="proveedor-persona">Tipo de persona *</Label>
              <select
                id="proveedor-persona"
                value={tipoPersona}
                onChange={(e) => setTipoPersona(e.target.value)}
                className={CLASE_CONTROL}
              >
                {TIPOS_PERSONA.map((t) => (
                  <option key={t.valor} value={t.valor}>
                    {t.etiqueta}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {error !== null && (
            <p role="alert" className={CLASE_ALERTA}>
              {error}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onCancelar} disabled={enviando}>
              Cancelar
            </Button>
            <Button type="submit" disabled={!completo}>
              Guardar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
