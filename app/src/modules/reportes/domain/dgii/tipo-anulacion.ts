/**
 * Reportes domain — the DGII 608 "Tipo de Anulación" (D3) reason-code mapping (FIS-5; slice E,
 * task 5.5/5.1).
 *
 * ADR-013: PURE TypeScript. Research §5 lists the ten fixed DGII 608 annulment-reason codes
 * (1–10). SystemFact's `Anulacion.motivo` is a REQUIRED FREE-TEXT string from an operator
 * catalogue (schema `motivo` VarChar(255), "motivo obligatorio desde catálogo 04, §9") — it is
 * NOT persisted as one of the ten DGII codes (verified: no numeric reason enum exists in the
 * ncf/anulacion modules). The exporter therefore maps the persisted reason TEXT to the closest
 * DGII code via a deterministic keyword table, defaulting to code 4 ("Corrección de la
 * información") — the most general, always-valid reason — when no keyword matches, so a 608 row
 * NEVER carries a blank or guessed reason. The keyword→code table is exported as data
 * ({@link TABLA_MOTIVO_A_TIPO_ANULACION}) so an accountant can refine it (or later a DB-config
 * table can override it) with no logic change.
 */

/** The ten DGII 608 annulment reason codes (research §5, S6/S3 — authoritative list). */
export const TIPO_ANULACION = {
  DETERIORO_PREIMPRESA: 1,
  ERRORES_IMPRESION: 2,
  IMPRESION_DEFECTUOSA: 3,
  CORRECCION_INFORMACION: 4,
  CAMBIO_PRODUCTOS: 5,
  DEVOLUCION_PRODUCTOS: 6,
  OMISION_PRODUCTOS: 7,
  ERRORES_SECUENCIA: 8,
  CESE_OPERACIONES: 9,
  PERDIDA_HURTO: 10,
} as const;

/** Code 4 is the conservative default — "Corrección de la información" (the general reason). */
export const TIPO_ANULACION_POR_DEFECTO = TIPO_ANULACION.CORRECCION_INFORMACION;

/**
 * Lower-cased, accent-scrubbed substring → DGII code. Deterministic and ordered by SPECIFICITY so
 * "devolución"/"devuelta" wins over the generic default. Keyed on stable reason words operators
 * type (Devolución, Cambio, Secuencia, Cierre/Cese, Pérdida/Hurto, Impresión, Deterioro, Omisión).
 */
export const TABLA_MOTIVO_A_TIPO_ANULACION: readonly (readonly [string, number])[] = [
  ["devoluc", TIPO_ANULACION.DEVOLUCION_PRODUCTOS], // "Devolución cliente/parcial"
  ["devuelta", TIPO_ANULACION.DEVOLUCION_PRODUCTOS],
  ["cambio", TIPO_ANULACION.CAMBIO_PRODUCTOS],
  ["omisi", TIPO_ANULACION.OMISION_PRODUCTOS],
  ["secuencia", TIPO_ANULACION.ERRORES_SECUENCIA],
  ["cese", TIPO_ANULACION.CESE_OPERACIONES],
  ["cierre", TIPO_ANULACION.CESE_OPERACIONES],
  ["perdid", TIPO_ANULACION.PERDIDA_HURTO],
  ["hurto", TIPO_ANULACION.PERDIDA_HURTO],
  ["deterior", TIPO_ANULACION.DETERIORO_PREIMPRESA],
  ["impres", TIPO_ANULACION.ERRORES_IMPRESION], // "Errores de impresión" / "Impresión defectuosa"
  ["captura", TIPO_ANULACION.CORRECCION_INFORMACION], // "Error de captura" → correction
  ["correc", TIPO_ANULACION.CORRECCION_INFORMACION],
];

/** Scrub accents + lowercase so the keyword table matches regardless of operator typing. */
function normalizarTexto(valor: string): string {
  return valor
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/**
 * Map a persisted annulment reason TEXT to the DGII 608 D3 code (1–10). A null/blank reason or one
 * with no keyword match resolves to {@link TIPO_ANULACION_POR_DEFECTO} (4) — never a blank, never a
 * silent guess beyond the documented default. Deterministic (pure string scan).
 */
export function mapearTipoAnulacion(motivo: string | null | undefined): number {
  if (motivo === null || motivo === undefined) return TIPO_ANULACION_POR_DEFECTO;
  const t = normalizarTexto(motivo);
  for (const [clave, codigo] of TABLA_MOTIVO_A_TIPO_ANULACION) {
    if (t.includes(clave)) return codigo;
  }
  return TIPO_ANULACION_POR_DEFECTO;
}

/** True when `codigo` is one of the ten valid DGII 608 reason codes (a transport guard for tests). */
export function esTipoAnulacionValido(codigo: number): boolean {
  return Number.isInteger(codigo) && codigo >= 1 && codigo <= 10;
}
