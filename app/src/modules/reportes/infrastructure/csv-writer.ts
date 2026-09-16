/**
 * Reportes infrastructure — the dependency-free server CSV writer (EXP-1).
 *
 * A pure, zero-dependency seam shared by every export (operational CSV in slice B, the
 * DGII TXT writers in slice E reuse the same quoting discipline). It is deterministic BYTES
 * (EXP-1): given identical inputs it always produces the identical output — no timestamps,
 * no map-iteration order, no randomness. The output is RFC 4180:
 *   - UTF-8 WITHOUT a BOM (the string is written raw; `csvBuffer` never prepends one);
 *   - CRLF (`\r\n`) line terminators (RFC 4180 §2.1);
 *   - a field is wrapped in double-quotes iff it contains a comma, a double-quote, CR or
 *     LF, and any embedded double-quote is DOUBLED (the only escape RFC 4180 defines);
 *   - money arrives already as a `Decimal` STRING (or a `decimal.js` Decimal, serialized
 *     via `toString` to FULL precision) so a `10.18` never becomes `10.179999…` — the
 *     writer never touches a JS float for money (AGENTS.md "Money = Decimal").
 *
 * The seam stays presentation-agnostic: it takes a header row and pre-shaped string rows.
 * Whether it emits the PAGE rows or the FULL filtered dataset is the CALLER's contract
 * (EXP-2 says the CSV carries the full filtered set — decided per report in slice B);
 * this primitive just guarantees byte-correct, deterministic RFC 4180 output.
 */

import { Decimal } from "decimal.js";

/** A single CSV cell value. Money MUST arrive as a string/Decimal — never a JS number. */
export type ValorCsv =
  | string
  | number
  | bigint
  | boolean
  | Decimal
  | null
  | undefined;

/** The media type the export response advertises (UTF-8 CSV, no BOM). */
export const CONTENT_TYPE_CSV = "text/csv; charset=utf-8";

/** RFC 4180 §2.1 record separator — CRLF between (and after) every record. */
const SALTO = "\r\n";

/** A field needs quoting when it contains any RFC 4180 special character. */
function necesitaComillas(campo: string): boolean {
  return /[",\r\n]/.test(campo);
}

/** Serialize one value to its CSV cell text, preserving Decimal precision. */
function aTexto(valor: ValorCsv): string {
  if (valor === null || valor === undefined) return "";
  if (valor instanceof Decimal) return valor.toString(); // full precision, no float
  if (typeof valor === "boolean") return valor ? "true" : "false";
  if (typeof valor === "bigint") return valor.toString();
  return String(valor);
}

/** Quote + escape a single cell per RFC 4180 (wrap iff needed, double embedded quotes). */
function cotizar(campo: string): string {
  if (necesitaComillas(campo)) {
    return `"${campo.replace(/"/g, '""')}"`;
  }
  return campo;
}

/** Render one record (header or data row) as a CRLF-terminated CSV line. */
function registro(columnas: readonly ValorCsv[]): string {
  return columnas.map((c) => cotizar(aTexto(c))).join(",");
}

/**
 * Produce an RFC 4180 CSV document from a header row and zero or more data rows. Rows are
 * emitted in the GIVEN order (the caller controls ordering/pagination), a trailing CRLF is
 * always written, and a header-only input yields exactly the header line. Identical inputs
 * produce byte-identical output (EXP-1 determinism).
 */
export function escribirCsv(
  cabecera: readonly ValorCsv[],
  filas: readonly (readonly ValorCsv[])[],
): string {
  const lineas: string[] = [registro(cabecera)];
  for (const fila of filas) {
    lineas.push(registro(fila));
  }
  // Trailing CRLF after every record keeps the byte stream deterministic and RFC-clean.
  return `${lineas.join(SALTO)}${SALTO}`;
}

/**
 * Encode a CSV document as a UTF-8 Buffer WITHOUT a BOM (EXP-1). Node's `Buffer.from(_,
 * 'utf8')` never prepends a BOM, so the first byte is the header, not `0xEF 0xBB 0xBF`.
 */
export function csvBuffer(csv: string): Buffer {
  return Buffer.from(csv, "utf8");
}
