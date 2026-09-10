import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import { Decimal } from "decimal.js";
import {
  LIMITE_CREDITO_DEFAULT,
  PLAZO_CREDITO_DIAS_DEFAULT,
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
  crearClienteEnTx,
  existeIdentificacionFiscalEnEmpresa,
  registrarAuditClienteEnTx,
} from "../infrastructure/cliente-repository";

/**
 * Transport-facing create input. Money crosses as a `Decimal(12,2)`-compatible
 * STRING (never a float); omitted credit fields fall back to the documented
 * R3 defaults (`0.00` / `30`). `esConsumidorFinal` is deliberately NOT a member:
 * operator create always writes a normal (CF-excluded) row — the Consumidor
 * Final is provisioned only through the seed / reserved seam.
 */
export interface CrearClienteInput {
  readonly nombre: string;
  readonly telefono: string;
  readonly direccion: string;
  readonly identificacionFiscal?: string | null;
  readonly tipoCliente: TipoCliente;
  readonly creditoHabilitado?: boolean;
  readonly limiteCredito?: string;
  readonly plazoCreditoDias?: number;
}

export type CrearClienteResult = ClienteResult<Cliente>;

function buildError(
  code: ClienteErrorCode,
): { ok: false; code: ClienteErrorCode; message: string } {
  return { ok: false, code, message: messageFor(code) };
}

/**
 * CLI-CREATE: create an active, tenant-scoped client at version 1. Order is
 * fixed by design — normalize, then the domain rules, BEFORE any probe or
 * write — so an invalid request mutates nothing:
 *   1. nombre/telefono/direccion trimmed within 1–255;
 *   2. fiscal ID normalized through the shared mod-11 validator (null when
 *      blank — only a legitimately unidentified client);
 *   3. credit limits validated (≥0 / >0) and the cross-field credit⇒RNC rule
 *      (R5) enforced;
 *   4. active-only duplicate fiscal-ID pre-check (the partial unique stays the
 *      real TOCTOU guard; its P2002 maps to the same code);
 *   5. one CREAR audit row in the same transaction (minimal, VARCHAR-safe).
 */
export async function crearCliente(
  tx: PrismaTx,
  ctx: TenantCtx,
  input: CrearClienteInput,
): Promise<CrearClienteResult> {
  const nombre = normalizeNombre(input.nombre);
  const telefono = input.telefono.trim();
  const direccion = input.direccion.trim();
  if (
    nombre.length === 0 ||
    nombre.length > 255 ||
    telefono.length === 0 ||
    telefono.length > 255 ||
    direccion.length === 0 ||
    direccion.length > 255
  ) {
    return buildError("VALIDATION_ERROR");
  }

  let identificacionFiscal: string | null;
  let limite: Decimal;
  let limiteStr: string;
  let plazo: number;
  let creditoHabilitado: boolean;
  try {
    identificacionFiscal = normalizeIdentificacionFiscal(
      input.identificacionFiscal ?? null,
    );
    limiteStr = input.limiteCredito ?? LIMITE_CREDITO_DEFAULT;
    limite = new Decimal(limiteStr);
    limiteStr = limite.toFixed(2); // freeze 2-dp canonical text for storage
    plazo = input.plazoCreditoDias ?? PLAZO_CREDITO_DIAS_DEFAULT;
    creditoHabilitado = input.creditoHabilitado ?? false;
    validarLimitesCredito({ limiteCredito: limite, plazoCreditoDias: plazo });
    validarReglasCredito({
      creditoHabilitado,
      limiteCredito: limite,
      tipoCliente: input.tipoCliente,
      identificacionFiscal,
    });
  } catch (err) {
    // Known domain violations become typed results; anything else is a defect.
    if (err instanceof ClienteDomainError) return buildError(err.code);
    // A non-numeric limiteCredito string makes `new Decimal()` throw a
    // DecimalError (name-flagged, not a public class) — a transport validation
    // failure, mapped to the stable VALIDATION_ERROR, never an unhandled crash.
    if (err instanceof Error && err.name === "DecimalError") {
      return buildError("VALIDATION_ERROR");
    }
    throw err;
  }

  if (identificacionFiscal !== null) {
    const duplicado = await existeIdentificacionFiscalEnEmpresa(
      tx,
      ctx.empresaId,
      identificacionFiscal,
    );
    if (duplicado) return buildError(CLIENTE_IDENTIFICACION_DUPLICADA);
  }

  let cliente: Cliente;
  try {
    cliente = await crearClienteEnTx(tx, ctx, {
      nombre,
      telefono,
      direccion,
      identificacionFiscal,
      tipoCliente: input.tipoCliente,
      esConsumidorFinal: false,
      creditoHabilitado,
      limiteCredito: limiteStr,
      plazoCreditoDias: plazo,
    });
  } catch (err) {
    if (
      err instanceof ClienteDomainError &&
      err.code === CLIENTE_IDENTIFICACION_DUPLICADA
    ) {
      return buildError(CLIENTE_IDENTIFICACION_DUPLICADA);
    }
    throw err;
  }

  // Append-only, in-transaction audit. Payload stays minimal (ids + a couple of
  // scalar fields) — the audit columns are VARCHAR(255), never full-row JSON.
  await registrarAuditClienteEnTx(tx, ctx, "CREAR", cliente.id, null, {
    id: cliente.id,
    nombre: cliente.nombre,
    tipoCliente: cliente.tipoCliente,
  });

  return { ok: true, data: cliente };
}
