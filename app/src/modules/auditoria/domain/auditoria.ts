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
import {
  calcularTotalPages,
  normalizarPagina,
  normalizarTamanoPagina,
} from "@/shared/domain/pagination";

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

// --- Pagination contract (AC-2 / AU-4, D3) ---
//
// The page-cap constants and the page/pageSize math are the SHARED pagination
// contract (`@/shared/domain/pagination`, R-QC-07): this module absorbed its
// former local copies (`TAMANO_PAGINA_POR_DEFECTO`/`TAMANO_PAGINA_MAXIMO`,
// `normalizarPage`/`normalizarPageSize`, the object-shape `calcularOffset` and
// the numeric `calcularTotalPages`) with ZERO behavior change — the audited
// "0 for an empty set" `totalPages` semantics IS the shared function's.

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

/**
 * Trim a transport string to a non-empty value, or `undefined` when absent, null, or
 * whitespace-only. A blank value means "not provided", NOT an invalid one — the caller
 * drops it rather than rejecting, so only a genuinely populated term is kept.
 */
function normalizarTexto(valor: string | null | undefined): string | undefined {
  if (typeof valor !== "string") return undefined;
  const recortado = valor.trim();
  return recortado === "" ? undefined : recortado;
}

/**
 * Normalise the transport `accion` facet to a domain {@link AccionAuditoria}, or
 * `undefined` when no action filter is requested (missing/null/blank). A non-empty but
 * unknown value is transport-invalid and throws `AUDITORIA_VALIDACION` so the caller fails
 * before any query (AC-3).
 */
export function normalizarAccion(
  value: string | null | undefined,
): AccionAuditoria | undefined {
  const accion = normalizarTexto(value);
  if (accion === undefined) return undefined;
  if (!esAccionAuditoria(accion)) {
    throw new AuditoriaDomainError(AUDITORIA_VALIDACION, { campo: "accion" });
  }
  return accion;
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
    page: normalizarPagina(entrada.page),
    pageSize: normalizarTamanoPagina(entrada.pageSize),
  };

  const accion = normalizarAccion(entrada.accion);
  if (accion !== undefined) filtro.accion = accion;

  const usuarioId = normalizarId(entrada.usuarioId, "usuarioId");
  if (usuarioId !== undefined) filtro.usuarioId = usuarioId;

  const sucursalId = normalizarId(entrada.sucursalId, "sucursalId");
  if (sucursalId !== undefined) filtro.sucursalId = sucursalId;

  const texto = normalizarTexto(entrada.texto);
  if (texto !== undefined) filtro.texto = texto;

  // A blank / whitespace-only date is "not provided", not an invalid one; only a
  // non-empty but malformed SD date reaches the conversion helper and fails loud.
  const desde = normalizarTexto(entrada.desde);
  const hasta = normalizarTexto(entrada.hasta);
  const rango = rangoFechasAUTC({ desde, hasta });
  if (rango.desde !== undefined) filtro.desde = rango.desde;
  if (rango.hasta !== undefined) filtro.hasta = rango.hasta;

  return filtro;
}

/**
 * Resolved display identity of the acting user (Board 09 slice B). ONLY these three
 * fields ever leave the server for a user — never email, hash, auth id or role.
 */
export interface AuditoriaUsuarioRef {
  readonly nombreUsuario: string;
  readonly nombre: string;
  readonly activo: boolean;
}

/** Resolved display identity of the row's branch (`null` on the row = company-level). */
export interface AuditoriaSucursalRef {
  readonly nombre: string;
  readonly activa: boolean;
}

/** One entry of the Usuario filter `<select>`. */
export interface AuditoriaUsuarioOpcion {
  readonly id: number;
  readonly nombreUsuario: string;
  readonly nombre: string;
  readonly activo: boolean;
}

/** One entry of the Sucursal filter `<select>`. */
export interface AuditoriaSucursalOpcion {
  readonly id: number;
  readonly nombre: string;
  readonly activa: boolean;
}

/** Option lists feeding the two filter selects (same transaction as the page). */
export interface AuditoriaOpciones {
  readonly usuarios: readonly AuditoriaUsuarioOpcion[];
  readonly sucursales: readonly AuditoriaSucursalOpcion[];
}

/** Hard cap of the user option list (no pagination, S3). */
export const MAX_OPCIONES_USUARIOS = 500;

/** Display-safe old/new texts of an allowlisted audit row (either side may be absent). */
export interface AuditoriaCambio {
  readonly anterior: string | null;
  readonly nuevo: string | null;
}

function leerJsonObjeto(texto: string | null): Record<string, unknown> | null {
  if (texto === null) return null;
  try {
    const v: unknown = JSON.parse(texto);
    return typeof v === "object" && v !== null && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * Hard allowlist of the audit rows whose stored values are safe to show a tenant admin
 * (slice C audit, 2026-11-21): Producto CREAR (`{codigo, tasa}`), Producto CANCELAR
 * (`{activo}`) and Producto LEER (`{count}`). EVERYTHING else returns `null` (default
 * deny): other writers store PII, amounts, NCFs, costs, config or free text. Only the
 * known keys are read, and only with the expected primitive types; any other shape
 * (truncated JSON, unexpected keys' values) yields `null` rather than raw text.
 */
export function proyectarCambioAuditoria(fila: {
  readonly entidad: string;
  readonly accion: AccionAuditoria;
  readonly valorAnterior: string | null;
  readonly valorNuevo: string | null;
}): AuditoriaCambio | null {
  if (fila.entidad !== "Producto") return null;
  const nuevo = leerJsonObjeto(fila.valorNuevo);
  if (fila.accion === ACCION_AUDITORIA.CREAR) {
    const codigo = nuevo?.codigo;
    const tasa = nuevo?.tasa;
    if (typeof codigo !== "string" || codigo.length > 60) return null;
    if (typeof tasa !== "number" && typeof tasa !== "string") return null;
    return { anterior: null, nuevo: `Código ${codigo} · ITBIS ${String(tasa).slice(0, 10)}` };
  }
  if (fila.accion === ACCION_AUDITORIA.CANCELAR) {
    const antes = leerJsonObjeto(fila.valorAnterior)?.activo;
    if (typeof antes !== "boolean" || typeof nuevo?.activo !== "boolean") return null;
    const texto = (a: boolean) => (a ? "Activo" : "Inactivo");
    return { anterior: texto(antes), nuevo: texto(nuevo.activo) };
  }
  if (fila.accion === ACCION_AUDITORIA.LEER) {
    const count = nuevo?.count;
    if (typeof count !== "number" || !Number.isInteger(count) || count < 0) return null;
    return { anterior: null, nuevo: `${count} resultados` };
  }
  return null;
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
  /**
   * Display-safe "Anterior → Nuevo" projection. `null` unless the row's (entidad, accion)
   * is on the hard allowlist (`proyectarCambioAuditoria`). The raw `valorAnterior` /
   * `valorNuevo` columns NEVER leave the repository.
   */
  readonly cambio: AuditoriaCambio | null;
  readonly motivo: string | null;
  /** Resolved names; `null` when the relation could not be resolved (UI falls back to `#id`). */
  readonly usuario: AuditoriaUsuarioRef | null;
  readonly sucursal: AuditoriaSucursalRef | null;
}

/** The paginated result shape returned across the use-case / action boundary. */
export interface AuditoriaPagina {
  readonly filas: readonly AuditoriaRegistro[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
  readonly totalPages: number;
}

/** What the consultation action returns: one page plus the filter option lists. */
export interface AuditoriaConsulta {
  readonly pagina: AuditoriaPagina;
  readonly opciones: AuditoriaOpciones;
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

// --- Write seam (AU-1): pure, DB-free shapes for appending an audit event ---
//
// These are the DATA contracts of the append-only write port introduced in phase
// 7A. They stay in the pure domain (no Prisma) exactly like the read DTOs above:
// the read-only "consultation" module gains a tiny write contract, but the actual
// INSERT (and the enum mapping) live in `infrastructure/`. The port interface
// itself is declared in `application/`.

/**
 * Minimal tenant anchor for an audit write. The read path receives a full
 * {@link TenantCtx}, but the LOGIN/LOGOUT standalone path has NO `TenantCtx`
 * (identity is resolved outside `withTenantTransaction`). The write helper only
 * needs the company + acting user; `sucursalId` is optional so a caller that has
 * no branch context (company-wide session events) can omit it, and the concrete
 * per-row branch can be overridden per event via {@link AuditoriaWriteEvent.sucursalId}.
 *
 * `TenantCtx` is structurally assignable to this shape, so branch-scoped callers
 * (cobros) pass their ctx unchanged.
 */
export interface AuditoriaTenantAnchor {
  readonly empresaId: number;
  readonly usuarioId: number;
  readonly sucursalId?: number | null;
}

/**
 * A single append-only audit event to persist (AU-1). `accion` is the frozen
 * domain enum — never a free string. `sucursalId` OVERRIDES the anchor's branch:
 * omit it to inherit the anchor's branch (cobros), or pass `null` explicitly to
 * record a company-wide action with no branch (LOGIN/LOGOUT). `fechaHora` is set
 * in code (UTC); omit to default to now.
 */
export interface AuditoriaWriteEvent {
  readonly accion: AccionAuditoria;
  readonly entidad: string;
  readonly idEntidad: string;
  readonly sucursalId?: number | null;
  readonly valorAnterior?: string | null;
  readonly valorNuevo?: string | null;
  readonly motivo?: string | null;
  readonly fechaHora?: Date;
}
