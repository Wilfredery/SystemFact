"use client";

/**
 * Clientes create/edit dialog (screens plan Step 3, S1/S3/S4).
 *
 * Client island for the interactivity only: the page already refused to render
 * the manage controls for a view-only role, and each write action re-checks the
 * role on the server. The RNC/cédula rule is the SHARED DGII mod-11 validator
 * (the same one the domain runs), so the form stops exactly what the server
 * would refuse; the credit limit is a Decimal(12,2) STRING end to end, never a
 * float.
 *
 * Credit fields (habilitar crédito, límite, plazo and the classification) are
 * Administrador-only even in view mode (S3): they are rendered only when the
 * permission seam reports credit visibility, and never sent otherwise. The
 * server re-checks that seam on create and on edit.
 *
 * Editing sends back the `version` the single-client read returned, so a
 * concurrent edit is refused instead of silently overwritten (S4).
 */

import { useState, type FormEvent } from "react";
import {
  actualizarClienteAction,
  crearClienteAction,
} from "@/modules/cliente/http/actions";
import type { ClienteDto } from "@/modules/cliente/http/shared";
import {
  IDENTIFICACION_FISCAL_INVALIDA,
  messageFor,
} from "@/modules/cliente/domain/errors";
import { validarIdentificacionFiscal } from "@/shared/domain/fiscal-id";
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
import {
  MENSAJE_MONTO_INVALIDO,
  TIPOS_CLIENTE,
  esMontoValido,
  esPlazoValido,
} from "./clientes-filtros";

const MENSAJE_FALLO_ACCION = "No se pudo guardar el cliente. Intente de nuevo.";
const MENSAJE_FISCAL_INVALIDO = messageFor(IDENTIFICACION_FISCAL_INVALIDA);
const CLASE_CONTROL =
  "min-h-11 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50";
const CLASE_ALERTA =
  "rounded-md bg-red-50 px-4 py-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-200";

export interface ClienteFormularioProps {
  readonly cliente: ClienteDto | null;
  readonly puedeVerCredito: boolean;
  readonly onGuardado: () => void;
  readonly onCancelar: () => void;
}

export function ClienteFormulario({
  cliente,
  puedeVerCredito,
  onGuardado,
  onCancelar,
}: ClienteFormularioProps) {
  const editando = cliente !== null;
  const [nombre, setNombre] = useState(cliente?.nombre ?? "");
  const [rnc, setRnc] = useState(cliente?.identificacionFiscal ?? "");
  const [telefono, setTelefono] = useState(cliente?.telefono ?? "");
  const [direccion, setDireccion] = useState(cliente?.direccion ?? "");
  const [tipo, setTipo] = useState(cliente?.tipoCliente ?? "MINORISTA");
  const [credito, setCredito] = useState(cliente?.creditoHabilitado ?? false);
  const [limite, setLimite] = useState(cliente?.limiteCredito ?? "0.00");
  const [plazo, setPlazo] = useState(String(cliente?.plazoCreditoDias ?? 30));
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fiscalVacio = rnc.trim() === "";
  const fiscalInvalido = !fiscalVacio && !validarIdentificacionFiscal(rnc.trim()).ok;
  const limiteInvalido = puedeVerCredito && !esMontoValido(limite);
  const plazoInvalido = puedeVerCredito && !esPlazoValido(plazo);
  const completo =
    nombre.trim() !== "" &&
    telefono.trim() !== "" &&
    direccion.trim() !== "" &&
    !fiscalInvalido &&
    !limiteInvalido &&
    !plazoInvalido &&
    !enviando;

  function camposBase() {
    return {
      nombre: nombre.trim(),
      identificacionFiscal: fiscalVacio ? null : rnc.trim(),
      telefono: telefono.trim(),
      direccion: direccion.trim(),
      tipoCliente: tipo,
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
        cliente === null
          ? await crearClienteAction(
              puedeVerCredito
                ? {
                    ...base,
                    creditoHabilitado: credito,
                    limiteCredito: limite.trim(),
                    plazoCreditoDias: Number(plazo),
                  }
                : base,
            )
          : await actualizarClienteAction(
              puedeVerCredito
                ? {
                    id: cliente.id,
                    version: cliente.version,
                    ...base,
                    creditoHabilitado: credito,
                    limiteCredito: limite.trim(),
                    plazoCreditoDias: Number(plazo),
                  }
                : { id: cliente.id, version: cliente.version, ...base },
            );
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
      <DialogContent aria-label={editando ? "Editar cliente" : "Nuevo cliente"}>
        <form onSubmit={(e) => void guardar(e)} noValidate className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{editando ? "Editar cliente" : "Nuevo cliente"}</DialogTitle>
            <DialogDescription>
              {editando
                ? "Los cambios se guardan sobre la versión leída; un cambio simultáneo se rechaza."
                : "Nombre o razón social, teléfono y dirección son obligatorios."}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-2">
            <Label htmlFor="cliente-nombre">Nombre o razón social *</Label>
            <Input
              id="cliente-nombre"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              maxLength={255}
              autoComplete="off"
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="cliente-rnc">RNC / Cédula</Label>
            <Input
              id="cliente-rnc"
              inputMode="numeric"
              value={rnc}
              onChange={(e) => setRnc(e.target.value)}
              maxLength={20}
              placeholder="131045677 o 00113918205"
              autoComplete="off"
              aria-describedby="cliente-rnc-detalle"
            />
          </div>
          <p id="cliente-rnc-detalle" aria-live="polite" className="min-h-5 text-sm">
            {fiscalInvalido && (
              <span className="text-red-700 dark:text-red-300">
                {MENSAJE_FISCAL_INVALIDO}
              </span>
            )}
          </p>

          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="cliente-telefono">Teléfono *</Label>
              <Input
                id="cliente-telefono"
                value={telefono}
                onChange={(e) => setTelefono(e.target.value)}
                maxLength={255}
                autoComplete="off"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="cliente-tipo">Tipo de cliente *</Label>
              <select
                id="cliente-tipo"
                value={tipo}
                onChange={(e) => setTipo(e.target.value)}
                className={CLASE_CONTROL}
              >
                {TIPOS_CLIENTE.map((t) => (
                  <option key={t.valor} value={t.valor}>
                    {t.etiqueta}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="cliente-direccion">Dirección *</Label>
            <Input
              id="cliente-direccion"
              value={direccion}
              onChange={(e) => setDireccion(e.target.value)}
              maxLength={255}
              autoComplete="off"
            />
          </div>

          {puedeVerCredito && (
            <fieldset className="flex flex-col gap-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
              <legend className="px-1 text-sm font-medium text-zinc-900 dark:text-zinc-50">
                Crédito
              </legend>
              <label className="flex min-h-11 items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
                <input
                  type="checkbox"
                  checked={credito}
                  onChange={(e) => setCredito(e.target.checked)}
                  aria-label="Habilitar crédito"
                />
                Habilitar crédito
              </label>
              <div className="grid grid-cols-2 gap-2">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="cliente-limite">Límite de crédito</Label>
                  <Input
                    id="cliente-limite"
                    inputMode="decimal"
                    value={limite}
                    onChange={(e) => setLimite(e.target.value)}
                    placeholder="0.00"
                    autoComplete="off"
                    aria-describedby="cliente-limite-detalle"
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="cliente-plazo">Plazo de crédito (días)</Label>
                  <Input
                    id="cliente-plazo"
                    type="number"
                    min={1}
                    value={plazo}
                    onChange={(e) => setPlazo(e.target.value)}
                    autoComplete="off"
                  />
                </div>
              </div>
              <p id="cliente-limite-detalle" aria-live="polite" className="min-h-5 text-sm">
                {limiteInvalido && (
                  <span className="text-red-700 dark:text-red-300">
                    {MENSAJE_MONTO_INVALIDO}
                  </span>
                )}
                {!limiteInvalido && plazoInvalido && (
                  <span className="text-red-700 dark:text-red-300">
                    El plazo debe ser un número entero de días mayor que cero.
                  </span>
                )}
              </p>
            </fieldset>
          )}

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
