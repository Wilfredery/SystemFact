import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import { Decimal } from "decimal.js";
import {
  normalizeIdentificacionFiscal,
  normalizeNombre,
  validarLimitesCredito,
  validarReglasCredito,
  type Cliente,
  type ClienteResult,
  type TipoCliente,
} from "../domain/cliente";
import {
  CLIENTE_IDENTIFICACION_DUPLICADA,
  ClienteDomainError,
  messageFor,
  type ClienteErrorCode,
} from "../domain/errors";
import {
  actualizarClienteEnTx,
  clienteByIdEnEmpresa,
  existeIdentificacionFiscalEnEmpresa,
  registrarAuditClienteEnTx,
  type ActualizarClientePatch,
} from "../infrastructure/cliente-repository";

/**
 * Partial-edit command. `id` + `version` identify the target row and its
 * expected state; every other field is an optional patch member.
 * `identificacionFiscal` distinguishes "unchanged" (undefined) from "cleared to
 * null" (explicit null). `esConsumidorFinal` is intentionally absent — a
 * reserved fiscal row can never be flipped through this path.
 */
export interface ActualizarClienteInput {
  readonly id: number;
  readonly version: number;
  readonly nombre?: string;
  readonly telefono?: string;
  readonly direccion?: string;
  readonly identificacionFiscal?: string | null;
  readonly tipoCliente?: TipoCliente;
  readonly creditoHabilitado?: boolean;
  /** `Decimal(12,2)`-compatible string; NEVER a float. */
  readonly limiteCredito?: string;
  readonly plazoCreditoDias?: number;
}

export type ActualizarClienteResult = ClienteResult<Cliente>;

function buildError(
  code: ClienteErrorCode,
): { ok: false; code: ClienteErrorCode; message: string } {
  return { ok: false, code, message: messageFor(code) };
}

/** The credit-bearing fields whose change (design R2/R5) requires Administrador. */
export function llevaCamposDeCredito(input: ActualizarClienteInput): boolean {
  return (
    input.creditoHabilitado !== undefined ||
    input.limiteCredito !== undefined ||
    input.plazoCreditoDias !== undefined ||
    input.tipoCliente !== undefined
  );
}

/**
 * Post-write credit-bearing state: the stored row with the patch overlaid, used
 * both for the cross-field credit rule (R5) and for the duplicate fiscal-ID
 * probe. Computed once by `calcularEstadoEfectivo` so the two consumers never
 * re-derive it (removes the duplicated `fiscalFinal` recompute).
 */
interface EstadoClienteEfectivo {
  readonly fiscalFinal: string | null;
  readonly limiteFinal: Decimal;
  readonly plazoFinal: number;
  readonly creditoFinal: boolean;
  readonly tipoFinal: TipoCliente;
}

/**
 * Build the UPDATE patch from the input. `undefined` fields are skipped
 * (R-QC-02: undefined leaves the column unchanged) while `null` is kept as a
 * real value (clears the column); nothing is null-coalesced. Field normalization
 * and length checks live here and throw `ClienteDomainError`, which the caller
 * maps to a typed result. Pure: no Prisma/Next imports.
 */
function construirPatchCliente(input: ActualizarClienteInput): ActualizarClientePatch {
  const patch: ActualizarClientePatch = {};
  if (input.nombre !== undefined) {
    const nombre = normalizeNombre(input.nombre);
    if (nombre.length === 0 || nombre.length > 255) {
      throw new ClienteDomainError("VALIDATION_ERROR");
    }
    patch.nombre = nombre;
  }
  if (input.telefono !== undefined) {
    const telefono = input.telefono.trim();
    if (telefono.length === 0 || telefono.length > 255) {
      throw new ClienteDomainError("VALIDATION_ERROR");
    }
    patch.telefono = telefono;
  }
  if (input.direccion !== undefined) {
    const direccion = input.direccion.trim();
    if (direccion.length === 0 || direccion.length > 255) {
      throw new ClienteDomainError("VALIDATION_ERROR");
    }
    patch.direccion = direccion;
  }
  if (input.identificacionFiscal !== undefined) {
    patch.identificacionFiscal = normalizeIdentificacionFiscal(
      input.identificacionFiscal,
    );
  }
  if (input.tipoCliente !== undefined) patch.tipoCliente = input.tipoCliente;
  if (input.creditoHabilitado !== undefined) {
    patch.creditoHabilitado = input.creditoHabilitado;
  }
  if (input.limiteCredito !== undefined) {
    const limite = new Decimal(input.limiteCredito);
    patch.limiteCredito = limite.toFixed(2);
  }
  if (input.plazoCreditoDias !== undefined) {
    patch.plazoCreditoDias = input.plazoCreditoDias;
  }
  return patch;
}

/** Overlay the patch on the stored row to get the effective post-write state. */
function calcularEstadoEfectivo(
  actual: Cliente,
  patch: ActualizarClientePatch,
): EstadoClienteEfectivo {
  return {
    fiscalFinal:
      patch.identificacionFiscal !== undefined
        ? patch.identificacionFiscal
        : actual.identificacionFiscal,
    limiteFinal:
      patch.limiteCredito !== undefined
        ? new Decimal(patch.limiteCredito)
        : actual.limiteCredito,
    plazoFinal:
      patch.plazoCreditoDias !== undefined
        ? patch.plazoCreditoDias
        : actual.plazoCreditoDias,
    creditoFinal:
      patch.creditoHabilitado !== undefined
        ? patch.creditoHabilitado
        : actual.creditoHabilitado,
    tipoFinal:
      patch.tipoCliente !== undefined
        ? patch.tipoCliente
        : actual.tipoCliente,
  };
}

/**
 * CLI-EDIT: optimistic-lock partial update inside the tenant transaction.
 * Sequence guarantees zero mutation on every failure mode:
 *   1. load the tenant row; a foreign id is CLIENTE_NO_ENCONTRADO (R1);
 *   2. reject editing a Consumidor Final (CONSUMIDOR_FINAL_PROTEGIDO) or an
 *      already-inactive row (CLIENTE_YA_INACTIVO);
 *   3. normalize the provided fields (fiscal via the shared mod-11 validator);
 *   4. evaluate the cross-field credit rule (R5) against the MERGED
 *      effective state (patch overlaid on the stored row) so an edit that would
 *      leave credit without a valid fiscal ID fails with zero writes;
 *   5. duplicate fiscal-ID probe when the ID changes;
 *   6. `updateMany({id, empresaId, version})` — a stale version yields
 *      { updated: false } → CONCURRENCIA_CONFLICTO, never a lost update;
 *   7. one ACTUALIZAR audit row (old/new of the changed scalars only) after the
 *      write succeeds, so a rollback persists neither change nor event.
 */
export async function actualizarCliente(
  tx: PrismaTx,
  ctx: TenantCtx,
  input: ActualizarClienteInput,
): Promise<ActualizarClienteResult> {
  const actual = await clienteByIdEnEmpresa(tx, ctx.empresaId, input.id);
  if (actual === null) return buildError("CLIENTE_NO_ENCONTRADO");
  if (actual.esConsumidorFinal) {
    return buildError("CLIENTE_CONSUMIDOR_FINAL_PROTEGIDO");
  }
  if (!actual.activo) return buildError("CLIENTE_YA_INACTIVO");

  const provided = [
    "nombre",
    "telefono",
    "direccion",
    "identificacionFiscal",
    "tipoCliente",
    "creditoHabilitado",
    "limiteCredito",
    "plazoCreditoDias",
  ] as const;
  if (!provided.some((k) => input[k] !== undefined)) {
    return buildError("VALIDATION_ERROR");
  }

  let patch: ActualizarClientePatch;
  let estado: EstadoClienteEfectivo;
  try {
    patch = construirPatchCliente(input);
    estado = calcularEstadoEfectivo(actual, patch);
    validarLimitesCredito({
      limiteCredito: estado.limiteFinal,
      plazoCreditoDias: estado.plazoFinal,
    });
    validarReglasCredito({
      creditoHabilitado: estado.creditoFinal,
      limiteCredito: estado.limiteFinal,
      tipoCliente: estado.tipoFinal,
      identificacionFiscal: estado.fiscalFinal,
    });
  } catch (err) {
    if (err instanceof ClienteDomainError) return buildError(err.code);
    if (err instanceof Error && err.name === "DecimalError") {
      return buildError("VALIDATION_ERROR");
    }
    throw err;
  }

  // Duplicate probe only when the fiscal ID actually changes to a new value
  // (estado.fiscalFinal computed once above — no recompute duplication).
  if (
    estado.fiscalFinal !== null &&
    estado.fiscalFinal !== actual.identificacionFiscal
  ) {
    const duplicado = await existeIdentificacionFiscalEnEmpresa(
      tx,
      ctx.empresaId,
      estado.fiscalFinal,
      input.id,
    );
    if (duplicado) return buildError(CLIENTE_IDENTIFICACION_DUPLICADA);
  }

  // Audit old/new only for the fields the patch carries (minimal, VARCHAR-safe).
  const cambios: {
    anteriores: Record<string, unknown>;
    nuevos: Record<string, unknown>;
  } = { anteriores: {}, nuevos: {} };
  for (const key of Object.keys(patch) as (keyof ActualizarClientePatch)[]) {
    cambios.anteriores[key] = actual[key];
    cambios.nuevos[key] = patch[key];
  }

  let update: { updated: boolean; newVersion: number };
  try {
    // Optimistic lock from the CLIENT version, never the re-read one: a stale
    // version yields { updated: false } (CLI-EDIT-B).
    update = await actualizarClienteEnTx(
      tx,
      ctx.empresaId,
      input.id,
      input.version,
      patch,
    );
  } catch (err) {
    if (
      err instanceof ClienteDomainError &&
      err.code === CLIENTE_IDENTIFICACION_DUPLICADA
    ) {
      return buildError(CLIENTE_IDENTIFICACION_DUPLICADA);
    }
    throw err;
  }
  if (!update.updated) return buildError("CONCURRENCIA_CONFLICTO");

  const refreshed = await clienteByIdEnEmpresa(tx, ctx.empresaId, input.id);
  if (refreshed === null) return buildError("CLIENTE_NO_ENCONTRADO");

  await registrarAuditClienteEnTx(
    tx,
    ctx,
    "ACTUALIZAR",
    input.id,
    cambios.anteriores,
    cambios.nuevos,
  );

  return { ok: true, data: refreshed };
}
