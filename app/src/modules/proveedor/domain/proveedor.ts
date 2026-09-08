/**
 * Proveedor domain entity, fiscal classification contracts and RNC
 * normalization.
 *
 * Pure TypeScript: no Prisma, Next.js, React or Supabase imports (ADR-013).
 * `TipoProveedor` and `TipoPersona` are frozen fiscal classifications that
 * drive fase-4 document/retention logic (B01/B11, ITBIS 100%, ISR 15%);
 * they are declared here as `as const` maps with extracted unions so both
 * the domain and the (structurally identical) Prisma enums agree.
 */

import { RNC_FORMATO_INVALIDO, ProveedorDomainError } from "./errors";
import type { ProveedorErrorCode } from "./errors";

export const TIPO_PROVEEDOR = {
  FORMAL: "FORMAL",
  INFORMAL: "INFORMAL",
} as const;
export type TipoProveedor = (typeof TIPO_PROVEEDOR)[keyof typeof TIPO_PROVEEDOR];

export const TIPO_PERSONA = {
  FISICA: "FISICA",
  JURIDICA: "JURIDICA",
} as const;
export type TipoPersona = (typeof TIPO_PERSONA)[keyof typeof TIPO_PERSONA];

export type Proveedor = {
  readonly id: number;
  readonly empresaId: number;
  readonly nombre: string;
  readonly contacto: string;
  readonly telefono: string;
  /** Normalized digits-only RNC; null for informal/unregistered suppliers. */
  readonly rnc: string | null;
  readonly tipoProveedor: TipoProveedor;
  readonly tipoPersona: TipoPersona;
  readonly activo: boolean;
  readonly version: number;
};

/** Typed use-case result: success data or stable coded error (19-directivas §9). */
export type ProveedorResult<T> =
  | { readonly ok: true; readonly data: T }
  | {
      readonly ok: false;
      readonly code: ProveedorErrorCode;
      readonly message: string;
    };

/**
 * Trim and collapse internal whitespace runs so supplier names compare
 * consistently (same intent as Categoria's normalizeNombre).
 */
export function normalizeNombre(nombre: string): string {
  return nombre.trim().replace(/\s+/g, " ");
}

/**
 * Canonical RNC form: separators (spaces, dots, dashes) are stripped before
 * storage so "1-3800000-1", "13800000 1" and "138000001" are the same value.
 * A blank/null input is a legitimate null (informal suppliers have no RNC).
 * Anything else must end up as 9–11 digits or it is rejected with the stable
 * RNC_FORMATO_INVALIDO code — the domain, not the HTTP layer, owns this rule.
 */
export function normalizeRnc(rnc: string | null): string | null {
  if (rnc === null) return null;
  const trimmed = rnc.trim();
  if (trimmed.length === 0) return null;
  const digits = trimmed.replace(/[\s.-]/g, "");
  if (!/^\d+$/.test(digits) || digits.length < 9 || digits.length > 11) {
    throw new ProveedorDomainError(RNC_FORMATO_INVALIDO);
  }
  return digits;
}
