/**
 * Categoria domain entity and name-normalization helper.
 *
 * Pure TypeScript: no Prisma, Next.js, React or Supabase imports (ADR-013).
 * `version` is part of the entity here (unlike Producto) because the design
 * contract (design.md §Interfaces) keeps optimistic-lock metadata on the
 * category itself.
 */

import type { CategoriaErrorCode } from "./errors";

export type Categoria = {
  readonly id: number;
  readonly empresaId: number;
  readonly nombre: string;
  readonly activa: boolean;
  readonly version: number;
};

/** Typed use-case result: success data or stable coded error (19-directivas §9). */
export type CategoriaResult<T> =
  | { readonly ok: true; readonly data: T }
  | {
      readonly ok: false;
      readonly code: CategoriaErrorCode;
      readonly message: string;
    };

/**
 * Trim and collapse internal whitespace runs so " Zapatos   Deportivos "
 * and "Zapatos Deportivos" are treated as the same active name (CAT-002).
 */
export function normalizeNombre(nombre: string): string {
  return nombre.trim().replace(/\s+/g, " ");
}
