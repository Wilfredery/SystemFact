import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import {
  RNC_PROVEEDOR_DUPLICADO,
  RNC_FORMATO_INVALIDO,
  VALIDATION_ERROR,
  messageFor,
  ProveedorDomainError,
  type ProveedorErrorCode,
} from "../domain/errors";
import {
  normalizeNombre,
  normalizeRnc,
  type Proveedor,
  type ProveedorResult,
  type TipoPersona,
  type TipoProveedor,
} from "../domain/proveedor";
import {
  existeRncEnEmpresa,
  crearProveedorEnTx,
  registrarAuditProveedorEnTx,
} from "../infrastructure/proveedor-repository";

export interface CrearProveedorInput {
  readonly nombre: string;
  readonly contacto: string;
  readonly telefono: string;
  /** Absent or blank means an informal/unregistered supplier (null RNC). */
  readonly rnc?: string | null;
  readonly tipoProveedor: TipoProveedor;
  readonly tipoPersona: TipoPersona;
}

export type CrearProveedorResult = ProveedorResult<Proveedor>;

function buildError(
  code: ProveedorErrorCode,
): { ok: false; code: ProveedorErrorCode; message: string } {
  return { ok: false, code, message: messageFor(code) };
}

/**
 * PRV-CREATE: create an active, tenant-scoped supplier. The name is collapsed
 * and the RNC normalized to digits before both the friendly pre-check and the
 * insert; the partial unique (empresaId, rnc over activo=true) remains the
 * real TOCTOU guard and the repository maps its P2002 to the duplicate error.
 * Null RNCs skip the probe entirely — they are legitimately repeatable.
 */
export async function crearProveedor(
  tx: PrismaTx,
  ctx: TenantCtx,
  input: CrearProveedorInput,
): Promise<CrearProveedorResult> {
  const nombre = normalizeNombre(input.nombre);
  const contacto = normalizeNombre(input.contacto);
  const telefono = input.telefono.trim();
  if (
    nombre.length === 0 ||
    nombre.length > 255 ||
    contacto.length === 0 ||
    contacto.length > 255 ||
    telefono.length === 0 ||
    telefono.length > 255
  ) {
    return buildError(VALIDATION_ERROR);
  }

  let rnc: string | null;
  try {
    rnc = normalizeRnc(input.rnc ?? null);
  } catch (err) {
    // Domain rule violated by the caller: stable code, no persistence.
    if (
      err instanceof ProveedorDomainError &&
      err.code === RNC_FORMATO_INVALIDO
    ) {
      return buildError(RNC_FORMATO_INVALIDO);
    }
    throw err;
  }

  // Null RNCs are legitimately repeatable: the pre-check is skipped entirely
  // (the repository keeps its own null guard as defense-in-depth).
  if (rnc !== null) {
    const duplicado = await existeRncEnEmpresa(tx, ctx.empresaId, rnc);
    if (duplicado) {
      return buildError(RNC_PROVEEDOR_DUPLICADO);
    }
  }

  let proveedor: Proveedor;
  try {
    proveedor = await crearProveedorEnTx(tx, ctx, {
      nombre,
      contacto,
      telefono,
      rnc,
      tipoProveedor: input.tipoProveedor,
      tipoPersona: input.tipoPersona,
    });
  } catch (err) {
    // Race between pre-check and insert (PRV-RNC-D): known domain violation
    // becomes a typed result; anything else is a defect and propagates.
    if (
      err instanceof ProveedorDomainError &&
      err.code === RNC_PROVEEDOR_DUPLICADO
    ) {
      return buildError(RNC_PROVEEDOR_DUPLICADO);
    }
    throw err;
  }

  // Same-transaction, append-only audit: a rollback drops supplier and event.
  await registrarAuditProveedorEnTx(tx, ctx, "CREAR", proveedor.id, null, {
    id: proveedor.id,
    nombre: proveedor.nombre,
    rnc: proveedor.rnc,
  });

  return { ok: true, data: proveedor };
}
