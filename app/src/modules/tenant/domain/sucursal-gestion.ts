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

/** Why a deactivation is refused (S3/S4). One entry per reason, all reported together. */
export type MotivoRechazoDesactivacion =
  | "SUCURSAL_PROPIA"
  | "ULTIMA_ACTIVA"
  | "USUARIOS"
  | "STOCK"
  | "DOCUMENTOS_ABIERTOS"
  | "SALDOS";

/** Blocker counts of one branch, as the use case read them (SQL aggregates). */
export interface ConteosBloqueoSucursal {
  /** Active users assigned to the branch. */
  readonly usuarios: number;
  /** INVENTARIO rows of the branch with quantity above zero. */
  readonly stock: number;
  /** VENTA in BORRADOR + COMPRA in BORRADOR/PENDIENTE of the branch. */
  readonly documentosAbiertos: number;
  /** Confirmed (VIGENTE) invoices of the branch with a derived balance above zero. */
  readonly saldos: number;
}

export interface HechosCambioEstadoSucursal {
  readonly sucursalId: number;
  readonly activaActual: boolean;
  readonly activaSolicitada: boolean;
  readonly conteos: ConteosBloqueoSucursal;
  /** The branch the acting session is pinned to. */
  readonly sucursalSesionId: number;
  /** Active branches of the empresa right now (including this one). */
  readonly sucursalesActivas: number;
}

export type DecisionCambioEstadoSucursal =
  | { readonly tipo: "SIN_CAMBIO" }
  | { readonly tipo: "APLICAR" }
  | {
      readonly tipo: "RECHAZAR";
      readonly motivos: readonly MotivoRechazoDesactivacion[];
    };

/**
 * Decide an activate/deactivate request from facts the use case already read.
 * A branch already in the requested state is the idempotent no-op (checked
 * first: nothing else matters then). Reactivation is never refused. A
 * deactivation collects EVERY reason (own branch, last active branch, then the
 * four blocker counts) so the screen can list them all in one message.
 */
export function decidirCambioEstadoSucursal(
  hechos: HechosCambioEstadoSucursal,
): DecisionCambioEstadoSucursal {
  if (hechos.activaActual === hechos.activaSolicitada) return { tipo: "SIN_CAMBIO" };
  if (hechos.activaSolicitada) return { tipo: "APLICAR" };

  const motivos: MotivoRechazoDesactivacion[] = [];
  if (hechos.sucursalId === hechos.sucursalSesionId) motivos.push("SUCURSAL_PROPIA");
  if (hechos.sucursalesActivas <= 1) motivos.push("ULTIMA_ACTIVA");
  if (hechos.conteos.usuarios > 0) motivos.push("USUARIOS");
  if (hechos.conteos.stock > 0) motivos.push("STOCK");
  if (hechos.conteos.documentosAbiertos > 0) motivos.push("DOCUMENTOS_ABIERTOS");
  if (hechos.conteos.saldos > 0) motivos.push("SALDOS");

  return motivos.length === 0 ? { tipo: "APLICAR" } : { tipo: "RECHAZAR", motivos };
}
