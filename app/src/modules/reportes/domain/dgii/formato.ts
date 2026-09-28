/**
 * Reportes domain — DGII fixed-width formatting primitives (FIS-3/FIS-6; slice E, task 5.1).
 *
 * ADR-013: PURE TypeScript. The DGII "Formatos de Envío de Datos" are *Texto delimitado por
 * espacios* (research §2, S2/S10) — a fixed-width TXT where every field is present even when
 * zero/blank, alphanumeric fields are RIGHT-padded with spaces and numeric fields are
 * ZERO-LEFT-padded, amounts carry their decimal point inside the declared width. This module is
 * the ONLY place those byte rules are implemented, so a layout change is a data edit here, never
 * a logic rewrite (U2 config seam).
 *
 * IMPORTANT — U1/U2 are ACCEPTANCE GATES, not assumptions (research §9). The exact per-field
 * WIDTHS and the FILE ENCODING are UNVERIFIED against the DGII Herramienta de Pre-Validación at
 * authoring time. They are therefore CENTRALIZED: every amount uses {@link LARGO_IMPORTE_DEFAULT}
 * and the writer uses {@link SEPARADOR_LINEA}, so if the pre-validation tool reports a byte-width
 * or line-ending mismatch the fix is a constant change here with zero touch to the mapping or
 * assembly logic. The unit tests pin the FORMATTING RULES (padding direction, fail-loud width
 * enforcement, deterministic bytes) against a chosen width, not against a tool-verified byte
 * offset.
 *
 * FAIL-LOUD WIDTH POLICY (the pre-validation tool is NOT a safety net — it validates a file we
 * already generated, so a bad width would corrupt the file before any validator sees it): a value
 * that exceeds its fixed column NEVER widens or truncates the record. It throws a typed
 * {@link ReporteDomainError} (stable code, AGENTS.md "Errors") so the corruption is diagnosed at
 * its source. The one width that is legally frozen — the NCF — is owned by the NCF domain
 * (`ncf/domain/ncf-rules` {@link LARGO_NCF}, where the composer post-asserts it) and RE-EXPORTED
 * here, so the exporter and the composer cannot drift.
 */

import { Decimal } from "decimal.js";
import { fechaEnSD } from "../zona-horaria";
import {
  REPORTE_DGII_ANCHO_EXCEDIDO,
  REPORTE_DGII_MONTO_INVALIDO,
  REPORTE_DGII_PERIODO_INVALIDO,
  ReporteDomainError,
} from "../errors";

/** The default declared width for an amount field (N12 — research §3/§4 amount columns). */
export const LARGO_IMPORTE_DEFAULT = 12;
/** The default width of the header `TOTAL_MONTO_FACTURADO` field (N16 — research §3 H5). */
export const LARGO_TOTAL_MONTO_DEFAULT = 16;
/** The default width of the header `CANTIDAD_REGISTROS` field (N12 — research §3 H4). */
export const LARGO_REGISTROS_DEFAULT = 12;
/** NCF field width (11 positions since May-2018 — research §3 D3, S3). Single source: the NCF
 * domain's frozen composition (`ncf-rules` {@link LARGO_NCF}); re-exported so the whole DGII
 * exporter consumes the composer's own constant. */
export { LARGO_NCF } from "@/modules/ncf/domain/ncf-rules";
/** RNC/Cédula field width (A11, space-padded, never blank — research §3 D1, §2). */
export const LARGO_RNC = 11;

/**
 * The record line separator. DGII pre-validation encoding is UNVERIFIED (U1); the official
 * "Texto delimitado por espacios" norm specifies the FIELD layout, and the Excel template emits
 * CRLF-terminated records. CRLF is the safe default and the SINGLE seam a tool-verified change
 * would flip (see the file header) — never a per-call-site literal.
 */
export const SEPARADOR_LINEA = "\r\n";

/**
 * RIGHT-pad an alphanumeric field with SPACES to `longitud` (research §2: "alphanumeric right-
 * padded with spaces"). An empty/`null` value becomes a full-width blank (every field is present
 * even if blank).
 *
 * A value LONGER than the field throws {@link ReporteDomainError} (`REPORTE_DGII_ANCHO_EXCEDIDO`)
 * — never truncates and never widens. DGII "longitudes de los campos no pueden ser diferentes",
 * so an overflow is a mapping defect that must be diagnosed at its source: truncating would make
 * an NCF/RNC well-formed but WRONG (undetectable downstream), and widening would shift every
 * following column and get the whole file rejected by the pre-validation tool with no cause
 * pointing back. The NCF/RNC widths are legally frozen; over-long values are defects, not data.
 *
 * ASCII CONTROL CHARACTERS (`\x00-\x1F`, `\x7F`) are STRIPPED before the padding: a DGII
 * fixed-width record must be one physical line, and an interior CR/LF/TAB is byte-indistinguishable
 * from the record terminator, so it would split a record in two and desync the file against
 * CANTIDAD_REGISTROS. Stripping cannot fix dirty data's MEANING (a control-char NCF is still not a
 * valid NCF, which the compra transport rejects on entry) — it guarantees only the layout invariant
 * so a legacy row or a value accepted before that validation can never corrupt the file's shape.
 *
 * This is the single choke point for EVERY alphanumeric field of 606/607/608 (RNC, NCF, codes), so
 * the guarantee is structural: no call site can bypass it. Sanitization precedes the width math, so
 * the returned value is ALWAYS exactly `longitud` characters.
 */
export function rellenarAlnum(valor: string | null | undefined, longitud: number): string {
  const s = (valor ?? "").replace(/[\x00-\x1F\x7F]/g, "");
  if (s.length > longitud) {
    throw new ReporteDomainError(REPORTE_DGII_ANCHO_EXCEDIDO, { campo: "alnum", longitud });
  }
  return s.padEnd(longitud, " ");
}

/**
 * LEFT-pad a NON-NEGATIVE integer with ZEROS to `longitud` (research §2: "numeric zero-left-
 * padded"). Used for the header register count and the period. A value that does not fit is
 * truncated from the LEFT is never safe for a count, so it is emitted at full precision (the
 * caps that keep counts in width are enforced by the deterministic split, not here).
 */
export function rellenarEnteroIzq(valor: number, longitud: number): string {
  if (!Number.isInteger(valor) || valor < 0) {
    throw new RangeError(`rellenarEnteroIzq: se requiere un entero no negativo, recibido ${String(valor)}`);
  }
  const s = String(valor);
  if (s.length >= longitud) return s;
  return s.padStart(longitud, "0");
}

/**
 * Format a money string to a fixed `Decimal(12,2)` amount with the decimal point INSIDE the
 * declared `longitud` (e.g. `4000.00` at width 13 → `0000004000.00` — research §2/§4: amounts
 * "include the decimal point within their declared length"). The value is normalised through
 * `Decimal` so a `10.18` never drifts and a whole number gains `.00`. A negative amount keeps its
 * sign and is right-justified (the sign counts toward the field), used by the Nota de Crédito
 * (B04) rows that reduce the register.
 *
 * A value whose magnitude exceeds the field width throws {@link ReporteDomainError}
 * (`REPORTE_DGII_ANCHO_EXCEDIDO`) — NEVER emitted in full (a wider-than-declared field shifts
 * every following column and gets the whole file rejected with no diagnostic pointing at the
 * cause) and NEVER truncated (that would corrupt the cross-foot). Overflow here is a mapping or
 * import defect; fail loud at the source.
 *
 * A NON-FINITE value (`NaN`/`Infinity` — decimal.js accepts the strings and returns them from
 * `0/0`/`x/0` without throwing, so a zero-base ratio can land here as `"NaN"`) throws
 * {@link ReporteDomainError} (`REPORTE_DGII_MONTO_INVALIDO`) BEFORE the width math: `"NaN"` is
 * 3 characters, so it passes any width check and would be zero-padded into a *wrong-looking
 * valid* total. A value with MORE THAN 2 decimals also throws the same code — money is never
 * silently rounded for a fiscal record.
 */
export function formatearMonto(valor: string | Decimal, longitud: number): string {
  const d = valor instanceof Decimal ? valor : new Decimal(valor);
  if (!d.isFinite()) {
    throw new ReporteDomainError(REPORTE_DGII_MONTO_INVALIDO, {
      campo: "importe",
      valor: d.toString(),
    });
  }
  if (d.decimalPlaces() > 2) {
    throw new ReporteDomainError(REPORTE_DGII_MONTO_INVALIDO, {
      campo: "importe",
      valor: d.toString(),
      causa: "escala-mayor-2",
    });
  }
  const fijo = d.toDecimalPlaces(2); // lossless after the scale guard
  const negativo = fijo.isNegative();
  const cuerpo = fijo.abs().toFixed(2); // e.g. "4000.00"
  const objetivo = negativo ? longitud - 1 : longitud; // the sign occupies one column
  if (cuerpo.length > objetivo) {
    throw new ReporteDomainError(REPORTE_DGII_ANCHO_EXCEDIDO, {
      campo: "importe",
      longitud,
      maximo: Number(objetivo),
    });
  }
  const relleno = cuerpo.padStart(objetivo, "0");
  return negativo ? `-${relleno}` : relleno;
}

/**
 * Convert a UTC instant to the DGII `AAAAMMDD` (8 numeric) business date, computed on the
 * America/Santo_Domingo calendar (AGENTS.md "Dates & time": SD is the business-calculation layer;
 * no manual hour arithmetic — the reused `fechaEnSD` Intl seam yields the SD `YYYY-MM-DD`). A
 * null/undefined date emits an all-blank field (the format keeps every column present).
 */
export function fechaAAAMMDD(valor: Date | null | undefined): string {
  if (valor === null || valor === undefined) return "";
  return fechaEnSD(valor).replace(/-/g, "");
}

/**
 * Convert a period (year + 1-based month) to the DGII header `AAAAMM` (6 numeric) string.
 * Throws `RangeError` on a non-4-digit year or a month outside 1..12 — a bad period would
 * desync the header line and (via {@link topes}) the filename with no error otherwise.
 */
export function periodoAAAAMM(anio: number, mes: number): string {
  if (!Number.isInteger(anio) || String(anio).length !== 4) {
    throw new RangeError(`periodoAAAAMM: se requiere un año de 4 dígitos, recibido ${String(anio)}`);
  }
  if (!Number.isInteger(mes) || mes < 1 || mes > 12) {
    throw new RangeError(`periodoAAAAMM: mes debe estar en 1..12, recibido ${String(mes)}`);
  }
  return `${anio}${String(mes).padStart(2, "0")}`;
}

/**
 * Assert a caller-provided `AAAAMM` period (the header DTOs carry it as a string) without
 * re-deriving it: exactly 6 digits and a month in 01..12, else {@link ReporteDomainError}
 * (`REPORTE_DGII_PERIODO_INVALIDO`). Used by the header assemblers so a free-string period can
 * never be emitted raw.
 */
export function validarPeriodoAAAAMM(periodo: string): void {
  const valido = /^\d{6}$/.test(periodo);
  const mes = valido ? Number(periodo.slice(4, 6)) : 0;
  if (!valido || mes < 1 || mes > 12) {
    throw new ReporteDomainError(REPORTE_DGII_PERIODO_INVALIDO, { periodo });
  }
}

/**
 * Join one record's already-formatted fields into a single fixed-width line by SIMPLE
 * concatenation (space-delimited fixed width — the padding is already applied per field, so no
 * separator char is inserted; a pipe/`,`-delimiter is REJECTED per U6). Deterministic: identical
 * field arrays yield identical bytes.
 */
export function ensamblarLinea(campos: readonly string[]): string {
  return campos.join("");
}
