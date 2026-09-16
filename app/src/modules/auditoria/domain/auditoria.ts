/**
 * Auditoria domain — pure filter model, pagination mapping and the audit-action enum.
 *
 * ADR-013: this module imports NOTHING from Next.js, React, Prisma or Supabase. The
 * consultation is read-only by construction (AC-5); there is no mutation logic here, only
 * how a request is normalised and how a returned page is shaped.
 *
 * `AccionAuditoria` mirrors the persisted Prisma enum as a plain const object + derived
 * union (the ratified pure-domain technique from `venta/domain/venta.ts`): the repository
 * maps the raw enum string to this domain union and back, so the domain stays DB-free.
 */

import {
  AUDITORIA_VALIDACION,
  AuditoriaDomainError,
} from "./errors";
import { rangoFechasAUTC } from "./zona-horaria";

/**
 * Audit actions as persisted by the (frozen) `AccionAuditoria` enum. Kept in sync with
 * `prisma/schema.prisma` (`enum AccionAuditoria`); the `LEER` value was added in phase
 * 7A for incidental significant-read rows and is an ordinary option with no special
 * handling (AC-3).
 */
export const ACCION_AUDITORIA = {
  CREAR: "CREAR",
  ACTUALIZAR: "ACTUALIZAR",
  CANCELAR: "CANCELAR",
  ANULAR: "ANULAR",
  PAGAR: "PAGAR",
  AJUSTAR: "AJUSTAR",
  LOGIN: "LOGIN",
  LOGOUT: "LOGOUT",
  LEER: "LEER",
} as const;
export type AccionAuditoria =
  (typeof ACCION_AUDITORIA)[keyof typeof ACCION_AUDITORIA];

const ACCIONES = new Set<string>(Object.values(ACCION_AUDITORIA));

/** True when `valor` is one of the persisted audit-action values. */
export function esAccionAuditoria(valor: unknown): valor is AccionAuditoria {
  return typeof valor === "string" && ACCIONES.has(valor);
}

/**
 * Typed runtime failure for a persisted `accion` with no domain representation. A data-
 * integrity guard (mirrors `EstadoVentaNoRepresentableError`), NOT a business error: it
 * must fail loud rather than coerce, and never surfaces to the client.
 */
export class AccionAuditoriaNoRepresentableError extends Error {
  readonly valor: string;
  constructor(valor: string) {
    super(`AccionAuditoria no representable en el dominio: ${valor}`);
    this.name = "AccionAuditoriaNoRepresentableError";
    this.valor = valor;
  }
}

/** Total DB→domain mapper for the persisted `accion`; unknown values fail loud. */
export function accionAuditoriaDesdeDb(valor: string): AccionAuditoria {
  if (esAccionAuditoria(valor)) return valor;
  throw new AccionAuditoriaNoRepresentableError(valor);
}

// --- Pagination constants (AC-2) ---

/** Default page size (AGENTS.md "lists always paginated — default 25/page"). */
export const TAMANO_PAGINA_POR_DEFECTO = 25;
/** Hard ceiling; a larger request is clamped to it, never accepted (AC-2). */
export const TAMANO_PAGINA_MAXIMO = 100;

/**
 * Free-text search targets: ONLY the structured identity/reason fields. The JSON payload
 * columns `valorAnterior`/`valorNuevo` are deliberately ABSENT and MUST NOT be searched
 * (AC-3). Exposed as data so the repository predicate builder and a guard test assert it.
 */
export const CAMPOS_TEXTO_LIBRE = [
  "entidad",
  "idEntidad",
  "motivo",
] as const;
export type CampoTextoLibre = (typeof CAMPOS_TEXTO_LIBRE)[number];

/**
 * A normalised, DB-ready filter. All optional facets are `undefined` when unset (ANDed by
 * the repository). `desde`/`hasta` are already UTC instants produced by the SD conversion.
 */
export interface AuditoriaFiltro {
  readonly accion?: AccionAuditoria;
  readonly usuarioId?: number;
  readonly sucursalId?: number;
  /** UTC instant = start of the requested Santo Domingo day (inclusive). */
  readonly desde?: Date;
  /** UTC instant = end of the requested Santo Domingo day (inclusive). */
  readonly hasta?: Date;
  /** Trimmed free-text term, matched against {@link CAMPOS_TEXTO_LIBRE} only. */
  readonly texto?: string;
  /** 1-based page index, always ≥ 1. */
  readonly page: number;
  /** Rows per page, always in `[1, TAMANO_PAGINA_MAXIMO]`. */
  readonly pageSize: number;
}

/** Raw, transport-shaped input (as parsed by the HTTP/Zod layer) before normalisation. */
export interface AuditoriaFiltroEntrada {
  readonly accion?: string | null;
  readonly usuarioId?: number | null;
  readonly sucursalId?: number | null;
  readonly desde?: string | null;
  readonly hasta?: string | null;
  readonly texto?: string | null;
  readonly page?: number | null;
  readonly pageSize?: number | null;
}

/** Positive-integer locator id, or `undefined`; anything else is transport-invalid. */
function normalizarId(
  valor: number | null | undefined,
  campo: "usuarioId" | "sucursalId",
): number | undefined {
  if (valor === undefined || valor === null) return undefined;
  if (!Number.isInteger(valor) || valor < 1) {
    throw new AuditoriaDomainError(AUDITORIA_VALIDACION, { campo });
  }
  return valor;
}

/** Clamp the requested page to an integer ≥ 1 (defaults to the first page). */
function normalizarPage(page: number | null | undefined): number {
  if (page === undefined || page === null || !Number.isFinite(page)) return 1;
  const truncada = Math.trunc(page);
  return truncada < 1 ? 1 : truncada;
}

/** Clamp the requested page size into `[1, TAMANO_PAGINA_MAXIMO]` (default 25). */
function normalizarPageSize(pageSize: number | null | undefined): number {
  if (
    pageSize === undefined ||
    pageSize === null ||
    !Number.isFinite(pageSize)
  ) {
    return TAMANO_PAGINA_POR_DEFECTO;
  }
  const truncada = Math.trunc(pageSize);
  return Math.max(1, Math.min(truncada, TAMANO_PAGINA_MAXIMO));
}

/**
 * Normalise a raw consultation request into a DB-ready {@link AuditoriaFiltro}:
 * page floored to ≥1, page size clamped to `[1,100]` (500 → 100, never accepted),
 * free text trimmed and dropped when blank, ids validated as positive integers, an
 * unknown `accion` rejected, and the SD date range converted to UTC bounds. Throws
 * `AUDITORIA_VALIDACION` on a transport-invalid `accion` or locator id.
 */
export function normalizarFiltro(entrada: AuditoriaFiltroEntrada): AuditoriaFiltro {
  const filtro: {
    accion?: AccionAuditoria;
    usuarioId?: number;
    sucursalId?: number;
    desde?: Date;
    hasta?: Date;
    texto?: string;
    page: number;
    pageSize: number;
  } = {
    page: normalizarPage(entrada.page),
    pageSize: normalizarPageSize(entrada.pageSize),
  };

  if (entrada.accion !== undefined && entrada.accion !== null) {
    const accion = entrada.accion.trim();
    // A blank `accion` is "no filter"; only a non-empty unknown value is invalid.
    if (accion !== "") {
      if (!esAccionAuditoria(accion)) {
        throw new AuditoriaDomainError(AUDITORIA_VALIDACION, { campo: "accion" });
      }
      filtro.accion = accion;
    }
  }

  const usuarioId = normalizarId(entrada.usuarioId, "usuarioId");
  if (usuarioId !== undefined) filtro.usuarioId = usuarioId;

  const sucursalId = normalizarId(entrada.sucursalId, "sucursalId");
  if (sucursalId !== undefined) filtro.sucursalId = sucursalId;

  const texto = typeof entrada.texto === "string" ? entrada.texto.trim() : "";
  if (texto !== "") filtro.texto = texto;

  // A blank / whitespace-only date is "not provided", not an invalid one; only a
  // non-empty but malformed SD date reaches the conversion helper and fails loud.
  const desde =
    typeof entrada.desde === "string" && entrada.desde.trim() !== ""
      ? entrada.desde.trim()
      : undefined;
  const hasta =
    typeof entrada.hasta === "string" && entrada.hasta.trim() !== ""
      ? entrada.hasta.trim()
      : undefined;
  const rango = rangoFechasAUTC({ desde, hasta });
  if (rango.desde !== undefined) filtro.desde = rango.desde;
  if (rango.hasta !== undefined) filtro.hasta = rango.hasta;

  return filtro;
}

/** Zero-based row offset for the ordered query (`fechaHora DESC, id DESC`). */
export function calcularOffset(filtro: Pick<AuditoriaFiltro, "page" | "pageSize">): number {
  return (filtro.page - 1) * filtro.pageSize;
}

/**
 * Number of pages for `total` at `pageSize` (0 when there are no rows). Intentionally NOT
 * forced to a minimum of 1: an empty result set legitimately has `totalPages = 0`, and a
 * requested page beyond the last simply returns an empty page rather than an error (AC-2).
 */
export function calcularTotalPages(total: number, pageSize: number): number {
  if (total <= 0) return 0;
  return Math.ceil(total / Math.max(1, pageSize));
}

/** A single audit row as surfaced to the consultation DTO (all columns the log carries). */
export interface AuditoriaRegistro {
  readonly id: number;
  readonly empresaId: number;
  readonly sucursalId: number | null;
  readonly usuarioId: number;
  readonly fechaHora: Date;
  readonly accion: AccionAuditoria;
  readonly entidad: string;
  readonly idEntidad: string;
  readonly valorAnterior: string | null;
  readonly valorNuevo: string | null;
  readonly motivo: string | null;
}

/** The paginated result shape returned across the use-case / action boundary. */
export interface AuditoriaPagina {
  readonly filas: readonly AuditoriaRegistro[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
  readonly totalPages: number;
}

/**
 * Assemble a {@link AuditoriaPagina} from rows the repository already fetched (ordered
 * `fechaHora DESC, id DESC`) plus the active filter and the matching row total. The page
 * and page size are echoed back verbatim — a page past the end simply carries the empty
 * rows the repository returned, never an error (AC-2).
 */
export function mapearAPagina(params: {
  readonly filas: readonly AuditoriaRegistro[];
  readonly total: number;
  readonly filtro: Pick<AuditoriaFiltro, "page" | "pageSize">;
}): AuditoriaPagina {
  const { filas, total, filtro } = params;
  return {
    filas,
    total,
    page: filtro.page,
    pageSize: filtro.pageSize,
    totalPages: calcularTotalPages(total, filtro.pageSize),
  };
}
