/**
 * Tenant domain — pure decisions of the branch-management writes
 * (odd/tasks/administracion-sucursales-crear-editar.md, S5-S7).
 *
 * Pure TypeScript: no Next.js/React/Prisma/Supabase, no DB. The functions decide
 * from FACTS the use case already read; they never read anything themselves.
 */

export interface DatosSucursal {
  readonly nombre: string;
  readonly direccion: string;
  readonly telefono: string;
}

export type CampoSucursal = keyof DatosSucursal;

const CAMPOS_SUCURSAL: readonly CampoSucursal[] = ["nombre", "direccion", "telefono"];

/** Trim the three free-text fields: what is stored, compared and audited. */
export function limpiarDatosSucursal(datos: DatosSucursal): DatosSucursal {
  return {
    nombre: datos.nombre.trim(),
    direccion: datos.direccion.trim(),
    telefono: datos.telefono.trim(),
  };
}

/**
 * Name identity of a branch (S5): trimmed + case-insensitive. The database
 * enforces the same rule with the functional unique index
 * `(empresaId, lower(btrim(nombre)))`.
 */
export function claveNombreSucursal(nombre: string): string {
  return nombre.trim().toLowerCase();
}

export type DecisionEdicionSucursal =
  | { readonly tipo: "SIN_CAMBIO" }
  | {
      readonly tipo: "APLICAR";
      /** Only the fields that change, with the stored and the new value. */
      readonly antes: Partial<DatosSucursal>;
      readonly despues: Partial<DatosSucursal>;
      /**
       * The name changes to ANOTHER identity (not just its case/spacing): only
       * then can it collide with a different branch, so only then is the
       * duplicate probe needed. Renaming to its own name is always allowed.
       */
      readonly requiereVerificarNombre: boolean;
    };

/**
 * Compare the stored values with the requested ones (both trimmed here).
 * Identical values are the idempotent no-op (S7); a case-only change of the
 * name IS a real change (it is stored and audited).
 */
export function decidirEdicionSucursal(
  actual: DatosSucursal,
  solicitado: DatosSucursal,
): DecisionEdicionSucursal {
  const actualLimpio = limpiarDatosSucursal(actual);
  const nuevo = limpiarDatosSucursal(solicitado);

  const antes: { -readonly [K in CampoSucursal]?: string } = {};
  const despues: { -readonly [K in CampoSucursal]?: string } = {};
  for (const campo of CAMPOS_SUCURSAL) {
    if (actualLimpio[campo] !== nuevo[campo]) {
      antes[campo] = actualLimpio[campo];
      despues[campo] = nuevo[campo];
    }
  }
  if (Object.keys(despues).length === 0) return { tipo: "SIN_CAMBIO" };

  return {
    tipo: "APLICAR",
    antes,
    despues,
    requiereVerificarNombre:
      claveNombreSucursal(actualLimpio.nombre) !== claveNombreSucursal(nuevo.nombre),
  };
}
