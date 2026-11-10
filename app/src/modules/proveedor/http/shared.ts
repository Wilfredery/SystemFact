import type { Proveedor } from "../domain/proveedor";
import { type ProveedorErrorCode } from "../domain/errors";

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: ProveedorErrorCode; message: string } };

// One named group per capability (owner L9: Operador and Despachador are
// view-only, Administrador manages), so a future change of who may do what is a
// one-line edit here. Screens and actions read these groups, never a literal
// role name.
//
// View: list and read suppliers. Operador and Despachador receive purchases, so
// they must see the supplier list even though they cannot change it.
export const ROLES_VER_PROVEEDORES = ["Administrador", "Operador", "Despachador"];

// Manage: create and edit suppliers (owner L9 / screens plan Step 4).
export const ROLES_GESTION_PROVEEDORES = ["Administrador"];

// Deactivation is a lifecycle decision with downstream purchase effects
// (fase 4 CxP); the role matrix reserves it for Administrador.
export const ROLES_ADMIN_ONLY = ["Administrador"];

export function ok<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}

export function error(
  code: ProveedorErrorCode,
  message: string,
): ActionResult<never> {
  return { ok: false, error: { code, message } };
}

/**
 * Explicit read DTO: Prisma models never cross the HTTP boundary. The listing
 * row carries the identity and contact fields the screen shows.
 */
export type ProveedorDto = {
  id: number;
  nombre: string;
  contacto: string;
  telefono: string;
  rnc: string | null;
  tipoProveedor: string;
  tipoPersona: string;
  activo: boolean;
};

/**
 * Detail DTO of the single-supplier read: the listing row plus `version`, which
 * the edit dialog sends back so a concurrent edit is refused (optimistic lock).
 */
export type ProveedorDetalleDto = ProveedorDto & { version: number };

export function toDetalleDto(p: Proveedor): ProveedorDetalleDto {
  return {
    id: p.id,
    nombre: p.nombre,
    contacto: p.contacto,
    telefono: p.telefono,
    rnc: p.rnc,
    tipoProveedor: p.tipoProveedor,
    tipoPersona: p.tipoPersona,
    activo: p.activo,
    version: p.version,
  };
}
