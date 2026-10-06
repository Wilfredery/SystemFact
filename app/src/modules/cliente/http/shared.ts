import type { Cliente } from "../domain/cliente";
import { type ClienteErrorCode } from "../domain/errors";

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: ClienteErrorCode; message: string } };

// Regular client management (create/read/list/ordinary edit) is operational:
// Administrador + Operador per the role matrix.
export const ROLES_GESTION_CLIENTES = ["Administrador", "Operador"];
// Credit fields, tipoCliente and deactivation are reserved for Administrador and
// enforced SERVER-SIDE inside the transaction — never by hiding UI controls.
export const ROLES_ADMIN_ONLY = ["Administrador"];

export function ok<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}

export function error(code: ClienteErrorCode, message: string): ActionResult<never> {
  return { ok: false, error: { code, message } };
}

/**
 * Explicit read DTO — Prisma models and the raw `decimal.js` Decimal never
 * cross the HTTP boundary. Money serializes as a fixed-point STRING so a client
 * cannot round-trip it through a float. Credit fields are carried so 5b/5c/6
 * read them without re-plumbing (listing/detail projection requirement).
 */
export type ClienteDto = {
  id: number;
  nombre: string;
  telefono: string;
  direccion: string;
  identificacionFiscal: string | null;
  tipoCliente: string;
  esConsumidorFinal: boolean;
  creditoHabilitado: boolean;
  limiteCredito: string;
  plazoCreditoDias: number;
  activo: boolean;
  version: number;
};

export function toDto(c: Cliente): ClienteDto {
  return {
    id: c.id,
    nombre: c.nombre,
    telefono: c.telefono,
    direccion: c.direccion,
    identificacionFiscal: c.identificacionFiscal,
    tipoCliente: c.tipoCliente,
    esConsumidorFinal: c.esConsumidorFinal,
    creditoHabilitado: c.creditoHabilitado,
    limiteCredito: c.limiteCredito.toFixed(2),
    plazoCreditoDias: c.plazoCreditoDias,
    activo: c.activo,
    version: c.version,
  };
}
