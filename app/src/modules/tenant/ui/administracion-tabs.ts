/**
 * Pure helpers of the Administración screen (screens plan Step 7,
 * `odd/tasks/administracion.md` S2/S6).
 *
 * Kept outside the `"use client"` island on purpose: a server component
 * importing a CONSTANT from a client module receives a client reference, not
 * the value (the learned bug recorded in the Compras/Clientes filter modules).
 *
 * The tab values and the tri-state `activo` spelling are the URL contract the
 * server page validates; the action re-validates the same spelling in
 * `tenant/http/validations.ts` (it deliberately does NOT coerce "false" as a
 * boolean, which would silently mean `true`).
 */

import type { DetalleBloqueoSucursal } from "../application/estado-sucursal";
import {
  TEN_AUTO_PROTECCION,
  TEN_ERROR_CODES,
  TEN_SUCURSAL_PROPIA_NO_DESACTIVABLE,
  TEN_SUCURSAL_ULTIMA_ACTIVA,
  messageFor,
} from "../domain/errors";

/** Rows per page of the Usuarios list (AGENTS.md: 25 default, 100 max). */
export const TAMANO_PAGINA = 25;

/** Debounce of the user search box, shared with the other list screens. */
export const DEBOUNCE_BUSQUEDA_MS = 300;

export type TabAdministracion =
  | "empresas"
  | "sucursales"
  | "usuarios"
  | "roles"
  | "configuracion";

/** Board 08 opens on Empresas (`odd/tasks/uiux-board-08-admin.md` S1). */
export const TAB_ADMINISTRACION_DEFAULT: TabAdministracion = "empresas";

/** Wireframe 08 labels, in board order (S1). */
export const TABS_ADMINISTRACION: readonly {
  valor: TabAdministracion;
  etiqueta: string;
}[] = [
  { valor: "empresas", etiqueta: "Empresas" },
  { valor: "sucursales", etiqueta: "Sucursales" },
  { valor: "usuarios", etiqueta: "Usuarios" },
  { valor: "roles", etiqueta: "Roles" },
  { valor: "configuracion", etiqueta: "Configuración" },
];

/** Only a known tab may reach the read action: no free strings. */
export function tabDesdeParam(valor: string): TabAdministracion {
  return TABS_ADMINISTRACION.find((t) => t.valor === valor)?.valor ?? TAB_ADMINISTRACION_DEFAULT;
}

export type ActivoParam = "" | "true" | "false";

/** Tri-state `activo`: `""` = all users, otherwise the two URL spellings. */
export function activoDesdeParam(valor: string): ActivoParam {
  return valor === "true" || valor === "false" ? valor : "";
}

export interface FiltrosUsuarios {
  readonly busqueda: string;
  readonly activo: ActivoParam;
}

export const FILTROS_ACTIVO: readonly { valor: ActivoParam; etiqueta: string }[] = [
  { valor: "", etiqueta: "Todos" },
  { valor: "true", etiqueta: "Activos" },
  { valor: "false", etiqueta: "Inactivos" },
];

/**
 * The action query for one page, with only the filters actually chosen. The
 * tri-state stays explicit: `activo` is a real boolean (or absent), never a
 * string the transport might coerce truthily.
 */
export function construirQueryUsuarios(filtros: FiltrosUsuarios, page: number) {
  const buscar = filtros.busqueda.trim();
  return {
    page,
    pageSize: TAMANO_PAGINA,
    ...(buscar === "" ? {} : { buscar }),
    ...(filtros.activo === "" ? {} : { activo: filtros.activo === "true" }),
  };
}

/**
 * `/administracion` URL for a tab, keeping the filters the user had chosen and
 * dropping the defaults so the URL stays readable. Tab switching is a server
 * navigation: the island pushes this and never loads another tab's data itself.
 */
export function construirHrefAdministracion(
  tab: TabAdministracion,
  filtros: FiltrosUsuarios,
  page: number,
): string {
  const params = new URLSearchParams();
  params.set("tab", tab);
  const buscar = filtros.busqueda.trim();
  if (buscar !== "") params.set("busqueda", buscar);
  if (filtros.activo !== "") params.set("activo", filtros.activo);
  if (page > 1) params.set("page", String(page));
  return `/administracion?${params.toString()}`;
}

/** Column limit of `SUCURSAL.nombre/direccion/telefono` (`VarChar(255)`), same as the server's zod rule. */
export const MAX_TEXTO_SUCURSAL = 255;

/**
 * Inline validation of one branch field, mirroring the server schema
 * (`z.string().trim().min(1).max(255)`). `null` = valid. UX only: the action
 * validates again.
 */
export function validarTextoSucursal(valor: string): string | null {
  const texto = valor.trim();
  if (texto.length === 0) return "Este campo es obligatorio.";
  if (texto.length > MAX_TEXTO_SUCURSAL) {
    return `Máximo ${MAX_TEXTO_SUCURSAL} caracteres.`;
  }
  return null;
}

/** Shown when a write action throws instead of answering (transport failure). */
export const MENSAJE_FALLO_ACCION = "No se pudo completar la acción. Intente de nuevo.";

/**
 * Moving a user: the catalog's self-protection text speaks of deactivation and
 * of losing the Administrador role, which is wrong for a move, so that ONE code
 * gets a move-specific message. Every other code keeps the catalog message.
 */
export const MENSAJE_AUTO_MOVER =
  "No puede moverse a sí mismo: use el selector de sucursal para cambiar la suya.";

export function mensajeErrorMover(code: string, mensajeServidor: string): string {
  return code === TEN_AUTO_PROTECCION
    ? MENSAJE_AUTO_MOVER
    : mensajeErrorGestion(code, mensajeServidor);
}

/**
 * The ONE code → Spanish message map of the user-management writes (S11): every
 * tenant catalog code reads its message from the catalog (`messageFor`), so the
 * component never spells a code or a text of its own. A transport code
 * (`VALIDATION_ERROR`, `SESION_INVALIDA`) is not in the tenant catalog: its
 * message is the server's, already Spanish and stable.
 */
export function mensajeErrorGestion(code: string, mensajeServidor: string): string {
  const conocido = TEN_ERROR_CODES.find((c) => c === code);
  return conocido === undefined ? mensajeServidor : messageFor(conocido);
}

function cantidad(n: number, singular: string, plural: string): string {
  return `${n} ${n === 1 ? singular : plural}`;
}

/**
 * ONE sentence listing EVERY blocker of a refused branch deactivation with its
 * count, zero counts skipped (activate/deactivate slice S8). `saldos` counts
 * INVOICES, not clients. `null` when no count is above zero.
 */
export function mensajeBloqueosSucursal(
  conteos: Pick<DetalleBloqueoSucursal, "usuarios" | "stock" | "documentosAbiertos" | "saldos">,
): string | null {
  const partes: string[] = [];
  if (conteos.usuarios > 0) partes.push(cantidad(conteos.usuarios, "usuario activo", "usuarios activos"));
  if (conteos.stock > 0) {
    partes.push(cantidad(conteos.stock, "producto con existencias", "productos con existencias"));
  }
  if (conteos.documentosAbiertos > 0) {
    partes.push(cantidad(conteos.documentosAbiertos, "documento abierto", "documentos abiertos"));
  }
  if (conteos.saldos > 0) {
    partes.push(cantidad(conteos.saldos, "factura con saldo pendiente", "facturas con saldo pendiente"));
  }
  return partes.length === 0 ? null : `No se puede desactivar: ${partes.join(", ")}.`;
}

/**
 * The message of a failed branch activate/deactivate. The own-branch and
 * last-active-branch refusals read their catalog text (they cannot be cleared by
 * the person); a deactivation blocked by data lists every blocker with its count
 * from `detalle`; every other code goes through the shared catalog mapping.
 */
export function mensajeErrorCambioEstadoSucursal(error: {
  readonly code: string;
  readonly message: string;
  readonly detalle?: DetalleBloqueoSucursal;
}): string {
  const codigos: readonly string[] = error.detalle?.codigos ?? [error.code];
  if (codigos.includes(TEN_SUCURSAL_PROPIA_NO_DESACTIVABLE)) {
    return messageFor(TEN_SUCURSAL_PROPIA_NO_DESACTIVABLE);
  }
  if (codigos.includes(TEN_SUCURSAL_ULTIMA_ACTIVA)) return messageFor(TEN_SUCURSAL_ULTIMA_ACTIVA);
  const bloqueos = error.detalle === undefined ? null : mensajeBloqueosSucursal(error.detalle);
  return bloqueos ?? mensajeErrorGestion(error.code, error.message);
}
