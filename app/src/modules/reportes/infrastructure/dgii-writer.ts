/**
 * Reportes infrastructure — the dependency-free DGII TXT writer (FIS-6; slice E).
 *
 * MIRRORS the slice-A {@link csvBuffer} discipline exactly: a pure, zero-dependency, byte-
 * deterministic encoder. The domain (`domain/dgii/registro.ts`) already assembles the fixed-width,
 * CRLF-joined document BODY (header + details, research §2); this module ONLY turns that string
 * into the shipped bytes. Two U1-critical guarantees live HERE and nowhere else:
 *
 *   - NO BOM — the bytes are written raw; a DGII file must NOT begin with `0xEF 0xBB 0xBF`
 *     (research §2, spec FIS-6 "UTF-8/ASCII, no BOM"). Node's `Buffer.from(_, 'utf8')` never
 *     prepends a BOM, so the first byte is the header's `CODIGO_INFORMACION`.
 *   - single-byte encoding — every DGII field is digits / spaces / the alphanumeric `B01…` NCF and
 *     the numeric RNC, all inside the ASCII range. UTF-8 is byte-identical to ASCII for those
 *     codepoints, so `utf8` here emits exactly the single-byte stream the pre-validation tool
 *     expects (research §2: "likely single-byte ASCII/Windows-1252"). Because the DGII content is
 *     ASCII-only, no non-ASCII codepage is ever required for the data; the encoding seam is the
 *     {@link CODIFICACION_DGII} value + the {@link txtBuffer} encoder. IF the tool ever demanded a
 *     byte-level Windows-1252 mapping for an accented header, that change stays LOCAL to this one
 *     file (a Buffer cannot encode cp1252 — it would add a tiny byte-mapping step here), never the
 *     mapping/assembly logic in `domain/dgii/`.
 *
 * The line terminator is likewise the SINGLE seam {@link SEPARADOR_LINEA} (CRLF default); a
 * tool-verified LF change edits `formato.ts`, not this file. This writer never re-formats a field
 * (that would duplicate the layout) — it is encode-only, so a U1/U2 fix is always a constant,
 * never a rewrite of the assembly logic (the task's "expose config seams so offset/encoding fixes
 * require no logic changes").
 */

import { Buffer } from "node:buffer";

/**
 * The DGII TXT text encoding (U1 seam). `utf8` == the ASCII single-byte stream the format needs.
 * The ONLY place to change if the Herramienta de Pre-Validación rejects the encoding; no logic
 * touches it.
 */
export const CODIFICACION_DGII: BufferEncoding = "utf8";

/** The media type the export response advertises for a DGII TXT (plain ASCII, no BOM). */
export const CONTENT_TYPE_DGII_TXT = "text/plain; charset=us-ascii";

/**
 * Encode an assembled DGII document body to its shipped bytes — UTF-8/ASCII, NO BOM (U1). Given
 * the identical input string the output is byte-for-byte identical (determinism, research §8
 * idempotency), so re-running an export for a period yields the same file.
 */
export function txtBuffer(txt: string): Buffer {
  return Buffer.from(txt, CODIFICACION_DGII);
}
