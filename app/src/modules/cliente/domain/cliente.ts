/**
 * Cliente domain entity, normalization, credit defaults/limits and the
 * cross-field credit rule.
 *
 * Pure TypeScript: no Prisma, Next.js, React or Supabase imports (ADR-013).
 * Money crosses the boundary as a `decimal.js` `Decimal` (`Decimal(12,2)`
 * limit) — NEVER a float — matching the producto/compra/inventario precedent.
 * `TipoCliente` is the frozen fiscal classification structurally identical to
 * the Prisma enum, declared here as an `as const` map with an extracted union.
 *
 * The credit rule (`validarReglasCredito`) is enforced here so every caller —
 * the Phase-2 use cases and any future path — guarantees zero mutation when a
 * credit request lacks a valid fiscal identity (cliente spec R5): B01
 * invoicing needs an identifiable debtor before credit can exist.
 */

import type { Decimal } from "decimal.js";
import { validarIdentificacionFiscal } from "@/shared/domain/fiscal-id";
import {
  CREDITO_REQUIERE_FISCAL_IDENTIDAD,
  IDENTIFICACION_FISCAL_INVALIDA,
  VALIDATION_ERROR,
  ClienteDomainError,
} from "./errors";
import type { ClienteErrorCode } from "./errors";

export const TIPO_CLIENTE = {
  MINORISTA: "MINORISTA",
  MAYORISTA: "MAYORISTA",
  CREDITO: "CREDITO",
} as const;
export type TipoCliente = (typeof TIPO_CLIENTE)[keyof typeof TIPO_CLIENTE];

/** A `tipoCliente` that by itself implies the client is on credit terms. */
export function esTipoClienteConCrediticio(tipo: TipoCliente): boolean {
  // Only the explicit CREDITO classification is credit-bearing by itself.
  // MAYORISTA keeps cash-capable semantics; enablement there flows through the
  // `creditoHabilitado` flag / `limiteCredito > 0` triggers, not the label.
  return tipo === TIPO_CLIENTE.CREDITO;
}

export type Cliente = {
  readonly id: number;
  readonly empresaId: number;
  readonly nombre: string;
  readonly telefono: string;
  readonly direccion: string;
  /** Normalized digits-only fiscal ID; null only for Consumidor Final / unverified. */
  readonly identificacionFiscal: string | null;
  readonly tipoCliente: TipoCliente;
  readonly esConsumidorFinal: boolean;
  readonly creditoHabilitado: boolean;
  /** `Decimal(12,2)` limit; never a float. */
  readonly limiteCredito: Decimal;
  readonly plazoCreditoDias: number;
  readonly activo: boolean;
  readonly version: number;
};

/** Typed use-case result: success data or stable coded error (19-directivas §9). */
export type ClienteResult<T> =
  | { readonly ok: true; readonly data: T }
  | {
      readonly ok: false;
      readonly code: ClienteErrorCode;
      readonly message: string;
    };

/**
 * Credit column defaults (R3): limit `0.00` (Decimal 12,2) and term `30` days.
 * Mirrored at the DDL level by migration `20260909000000_cliente_credit_defaults`
 * so any writer path lands the same values when the fields are omitted.
 */
export const LIMITE_CREDITO_DEFAULT = "0.00";
export const PLAZO_CREDITO_DIAS_DEFAULT = 30;

/**
 * Trim and collapse internal whitespace runs so names compare consistently
 * (same intent as Proveedor's normalizeNombre).
 */
export function normalizeNombre(nombre: string): string {
  return nombre.trim().replace(/\s+/g, " ");
}

/**
 * Canonical fiscal-ID form: separators are stripped and the mod-11 check digit
 * verified through the SHARED validator (client-validators reuse). A blank or
 * null input is a legitimate null (Consumidor Final has none). A non-empty
 * value that fails length or checksum is rejected with the stable
 * IDENTIFICACION_FISCAL_INVALIDO code — format checks are domain-owned, not
 * zod's (cliente spec "Validate fiscal ID").
 */
export function normalizeIdentificacionFiscal(
  valor: string | null,
): string | null {
  if (valor === null) return null;
  const trimmed = valor.trim();
  if (trimmed.length === 0) return null;
  const resultado = validarIdentificacionFiscal(trimmed);
  if (!resultado.ok) {
    throw new ClienteDomainError(IDENTIFICACION_FISCAL_INVALIDA, {
      longitud: trimmed.replace(/[\s-]/g, "").length,
    });
  }
  return resultado.value;
}

/**
 * Validate credit limits (R3): the limit must be ≥ 0 and the term strictly > 0
 * (a zero-day term is not a real credit window). Accepts the `decimal.js`
 * `Decimal` used across the domain so money is compared exactly, never as a
 * float. Throws the generic VALIDATION_ERROR with minimal details on breach.
 */
export function validarLimitesCredito(input: {
  limiteCredito: Decimal;
  plazoCreditoDias: number;
}): void {
  if (input.limiteCredito.isNegative()) {
    throw new ClienteDomainError(VALIDATION_ERROR, { campo: "limiteCredito" });
  }
  if (!Number.isInteger(input.plazoCreditoDias) || input.plazoCreditoDias <= 0) {
    throw new ClienteDomainError(VALIDATION_ERROR, { campo: "plazoCreditoDias" });
  }
}

/**
 * Cross-field credit rule (R5): a client that requests credit — via the
 * `creditoHabilitado` flag, a `limiteCredito > 0`, or a credit-bearing
 * `tipoCliente` — MUST carry a stored, mod-11-valid `identificacionFiscal`. A
 * null or invalid fiscal ID raises CREDITO_REQUIERE_FISCAL_IDENTIDAD with zero
 * changes; callers run this BEFORE any write or duplicate probe.
 */
export function validarReglasCredito(input: {
  creditoHabilitado: boolean;
  limiteCredito: Decimal;
  tipoCliente: TipoCliente;
  identificacionFiscal: string | null;
}): void {
  const solicitaCredito =
    input.creditoHabilitado ||
    input.limiteCredito.greaterThan(0) ||
    esTipoClienteConCrediticio(input.tipoCliente);
  if (!solicitaCredito) return;

  const fiscalValida =
    input.identificacionFiscal !== null &&
    validarIdentificacionFiscal(input.identificacionFiscal).ok;
  if (!fiscalValida) {
    throw new ClienteDomainError(CREDITO_REQUIERE_FISCAL_IDENTIDAD, {
      tipoCliente: input.tipoCliente,
    });
  }
}

/**
 * Frozen shape of the per-empresa Consumidor Final row (cliente R2, design
 * "CF provisioning"). This is the SINGLE source of truth so the seed script
 * and the reserved 5b `getOrCreateConsumidorFinalEnTx` seam stay byte-identical
 * and cannot drift. `limiteCredito` is the `Decimal(12,2)`-compatible STRING
 * (never a float); the fiscal ID is null by design — CF is the only row
 * allowed to omit it. `esConsumidorFinal=true` makes the DB partial unique
 * `cliente_consumidor_final_uk` enforce "exactly one per empresa".
 */
export const CONSUMIDOR_FINAL = {
  nombre: "Consumidor Final",
  telefono: "N/A",
  direccion: "N/A",
  identificacionFiscal: null,
  tipoCliente: TIPO_CLIENTE.MINORISTA,
  esConsumidorFinal: true,
  creditoHabilitado: false,
  limiteCredito: LIMITE_CREDITO_DEFAULT,
  plazoCreditoDias: PLAZO_CREDITO_DIAS_DEFAULT,
} as const;
