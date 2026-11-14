/**
 * Tenant domain — invariants of the user-management writes (Step 7b, S4/S5/S7).
 *
 * Pure TypeScript: no Next.js/React/Prisma/Supabase, no DB. Role NAMES are never
 * written here: the Administrador group is passed in by the caller (the one
 * place it is spelled is `ROLES_GESTION_USUARIOS` in `http/shared.ts`).
 *
 * The functions decide from FACTS the use case read under the row locks
 * (counts, current roles, current state); they never read anything themselves.
 */

import {
  TEN_AUTO_PROTECCION,
  TEN_ULTIMO_ADMINISTRADOR,
  type TenantErrorCode,
} from "./errors";

export interface RolCatalogo {
  readonly id: number;
  readonly nombre: string;
}

export type DecisionCambio =
  | { readonly tipo: "SIN_CAMBIO" }
  | { readonly tipo: "APLICAR" }
  | { readonly tipo: "RECHAZAR"; readonly code: TenantErrorCode };

/**
 * S4: SET semantics need a non-empty list, no duplicates, every id present in
 * the ACTIVE catalog (`activos` is already filtered to active ROL rows).
 */
export function validarConjuntoRoles(
  rolIds: readonly number[],
  activos: readonly RolCatalogo[],
): boolean {
  if (rolIds.length === 0) return false;
  if (new Set(rolIds).size !== rolIds.length) return false;
  const idsActivos = new Set(activos.map((rol) => rol.id));
  return rolIds.every((id) => idsActivos.has(id));
}

/** Order-insensitive equality of two id lists (idempotent no-op detection). */
export function mismoConjuntoDeIds(
  a: readonly number[],
  b: readonly number[],
): boolean {
  const conjuntoA = new Set(a);
  const conjuntoB = new Set(b);
  if (conjuntoA.size !== conjuntoB.size) return false;
  for (const id of conjuntoA) if (!conjuntoB.has(id)) return false;
  return true;
}

function incluyeAdministrador(
  roles: readonly RolCatalogo[],
  rolesAdministrador: readonly string[],
): boolean {
  return roles.some((rol) => rolesAdministrador.includes(rol.nombre));
}

/** True when the user is ACTIVE and holds at least one role of the Administrador group. */
export function esAdministradorActivo(
  usuario: { readonly activo: boolean; readonly roles: readonly RolCatalogo[] },
  rolesAdministrador: readonly string[],
): boolean {
  return usuario.activo && incluyeAdministrador(usuario.roles, rolesAdministrador);
}

export interface DecidirCambioRolesInput {
  readonly actorId: number;
  readonly objetivoId: number;
  readonly objetivoActivo: boolean;
  readonly rolesActuales: readonly RolCatalogo[];
  readonly rolesNuevos: readonly RolCatalogo[];
  /** Role names that count as "Administrador" for this capability. */
  readonly rolesAdministrador: readonly string[];
  /** ACTIVE administrators of the branch, counted under the lock (target included). */
  readonly administradoresActivos: number;
}

/**
 * Order: no-op first (nothing changes, nothing to protect), then S7a (self),
 * then S7b (last administrator). The no-op test never overrides a version
 * conflict: that check happens BEFORE this decision, in the use case.
 */
export function decidirCambioRoles(
  input: DecidirCambioRolesInput,
): DecisionCambio {
  const actuales = input.rolesActuales.map((rol) => rol.id);
  const nuevos = input.rolesNuevos.map((rol) => rol.id);
  if (mismoConjuntoDeIds(actuales, nuevos)) return { tipo: "SIN_CAMBIO" };

  const eraAdministrador = incluyeAdministrador(
    input.rolesActuales,
    input.rolesAdministrador,
  );
  const seraAdministrador = incluyeAdministrador(
    input.rolesNuevos,
    input.rolesAdministrador,
  );
  const quitaAdministrador = eraAdministrador && !seraAdministrador;

  if (quitaAdministrador && input.actorId === input.objetivoId) {
    return { tipo: "RECHAZAR", code: TEN_AUTO_PROTECCION };
  }
  // An inactive administrator is not in the count, so removing its role cannot
  // reduce the number of ACTIVE administrators.
  if (
    quitaAdministrador &&
    input.objetivoActivo &&
    input.administradoresActivos <= 1
  ) {
    return { tipo: "RECHAZAR", code: TEN_ULTIMO_ADMINISTRADOR };
  }
  return { tipo: "APLICAR" };
}

export interface DecidirCambioEstadoInput {
  readonly actorId: number;
  readonly objetivoId: number;
  readonly objetivoActivo: boolean;
  readonly activoNuevo: boolean;
  readonly objetivoEsAdministrador: boolean;
  readonly administradoresActivos: number;
}

export function decidirCambioEstado(
  input: DecidirCambioEstadoInput,
): DecisionCambio {
  if (input.objetivoActivo === input.activoNuevo) return { tipo: "SIN_CAMBIO" };

  const desactiva = input.objetivoActivo && !input.activoNuevo;
  if (desactiva && input.actorId === input.objetivoId) {
    return { tipo: "RECHAZAR", code: TEN_AUTO_PROTECCION };
  }
  if (
    desactiva &&
    input.objetivoEsAdministrador &&
    input.administradoresActivos <= 1
  ) {
    return { tipo: "RECHAZAR", code: TEN_ULTIMO_ADMINISTRADOR };
  }
  return { tipo: "APLICAR" };
}
