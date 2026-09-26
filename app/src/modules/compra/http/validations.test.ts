/**
 * HTTP transport unit tests — the compra Zod schemas themselves (no DB, no action collaborators).
 *
 * PURE: this file never imports `./actions`, so the generated Prisma client stays out of the
 * suite — it only proves what the wire contract ACCEPTS and REJECTS, which is where the NCF
 * grammar is enforced. A control-character NCF (`B01\r\n123456`) is the DGII-606 vector: it
 * would survive into the fixed-width record and desync the file, so the boundary must reject it
 * with the stable Spanish message "ncf inválido".
 */

import { zActualizarCompraInput, zCrearCompraInput } from "./validations";

/** Minimal payload accepted by zCrearCompraInput (everything else is optional). */
const CREAR_MINIMO = {
  proveedorId: 5,
  tipoCompra: "MERCANCIA",
  fecha: "2026-01-10T00:00:00.000Z",
  lineas: [{ productoId: 10, cantidad: "1.000", costoUnitario: "100.00" }],
} as const;

/** Minimal payload accepted by zActualizarCompraInput (id + lines). */
const ACTUALIZAR_MINIMO = {
  id: 7,
  lineas: [{ productoId: 10, cantidad: "1.000", costoUnitario: "100.00" }],
} as const;

/** Assert a parse failed and return the issue on the `ncf` field. */
function ncfIssue(result: { success: boolean; error?: { issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; message: string }> } }) {
  expect(result.success).toBe(false);
  const issues = result.error?.issues ?? [];
  const issue = issues.find((i) => i.path[0] === "ncf");
  expect(issue).toBeDefined();
  return issue?.message;
}

describe("zCrearCompraInput — ncf", () => {
  it("accepts a minimal payload with NO ncf at all (the field is optional until receipt)", () => {
    const r = zCrearCompraInput.safeParse(CREAR_MINIMO);
    expect(r.success).toBe(true);
  });

  it("accepts a well-formed B01 and B11 NCF", () => {
    expect(zCrearCompraInput.safeParse({ ...CREAR_MINIMO, ncf: "B0100000001" }).success).toBe(true);
    expect(zCrearCompraInput.safeParse({ ...CREAR_MINIMO, ncf: "B1100000001" }).success).toBe(true);
  });

  it("trims surrounding whitespace BEFORE the grammar check (the stored value is canonical)", () => {
    const r = zCrearCompraInput.safeParse({ ...CREAR_MINIMO, ncf: "  B0100000001  " });
    expect(r.success).toBe(true);
    expect(r.success && r.data.ncf).toBe("B0100000001");
  });

  it("keeps null accepted (an absent NCF is legal until the purchase is received)", () => {
    const r = zCrearCompraInput.safeParse({ ...CREAR_MINIMO, ncf: null });
    expect(r.success).toBe(true);
    expect(r.success && r.data.ncf).toBeNull();
  });

  it("rejects a lowercase NCF with the stable message", () => {
    expect(ncfIssue(zCrearCompraInput.safeParse({ ...CREAR_MINIMO, ncf: "b0100000001" }))).toBe(
      "ncf inválido",
    );
  });

  it("rejects a malformed NCF: foreign prefix, letters in the digits, wrong length, empty", () => {
    for (const ncf of [
      "B0200000001", // B02 is a sales series, not a purchase NCF
      "B01000000A1", // letter in the numeric part
      "B010000001", // 10 positions
      "B01000000012", // 12 positions
      "   ", // blank after trim (already rejected before this change, by .min(1))
    ]) {
      expect(ncfIssue(zCrearCompraInput.safeParse({ ...CREAR_MINIMO, ncf }))).toBe("ncf inválido");
    }
  });

  it("rejects an NCF carrying an ASCII control character (the 606 record-layout vector)", () => {
    for (const ncf of ["B01\r\n123456", "B0\r12345678", "B0\n12345678", "B0\t12345678"]) {
      expect(ncfIssue(zCrearCompraInput.safeParse({ ...CREAR_MINIMO, ncf }))).toBe("ncf inválido");
    }
  });

  it("still validates the other fields (the ncf rule did not weaken the rest of the schema)", () => {
    // An ncf that is valid must not mask an unrelated failure: a non-positive id and an
    // empty line array are still rejected, and the ncf field itself is not reported.
    const r = zCrearCompraInput.safeParse({ ...CREAR_MINIMO, proveedorId: 0, lineas: [], ncf: "B0100000001" });
    expect(r.success).toBe(false);
    const paths = (r.error?.issues ?? []).map((i) => i.path[0]);
    expect(paths).toContain("proveedorId");
    expect(paths).toContain("lineas");
    expect(paths).not.toContain("ncf");
  });
});

describe("zCrearCompraInput — Decimal(12,2) unit-cost bound", () => {
  it("accepts the full column width: 10 integer digits + 2 decimals", () => {
    const r = zCrearCompraInput.safeParse({
      ...CREAR_MINIMO,
      lineas: [{ productoId: 10, cantidad: "1.000", costoUnitario: "1000000000.00" }],
    });
    expect(r.success).toBe(true);
  });

  it("rejects an 11-digit integer part (beyond Decimal(12,2))", () => {
    const r = zCrearCompraInput.safeParse({
      ...CREAR_MINIMO,
      lineas: [{ productoId: 10, cantidad: "1.000", costoUnitario: "10000000000.00" }],
    });
    expect(r.success).toBe(false);
    expect((r.error?.issues ?? []).map((i) => i.path.join("."))).toContain(
      "lineas.0.costoUnitario",
    );
  });
});

describe("zActualizarCompraInput — ncf", () => {
  it("accepts a minimal payload with NO ncf (omitted is legal on a draft edit)", () => {
    expect(zActualizarCompraInput.safeParse(ACTUALIZAR_MINIMO).success).toBe(true);
  });

  it("accepts a well-formed B01 and B11 NCF, and null", () => {
    expect(zActualizarCompraInput.safeParse({ ...ACTUALIZAR_MINIMO, ncf: "B0100000001" }).success).toBe(true);
    expect(zActualizarCompraInput.safeParse({ ...ACTUALIZAR_MINIMO, ncf: "B1100000001" }).success).toBe(true);
    const nulo = zActualizarCompraInput.safeParse({ ...ACTUALIZAR_MINIMO, ncf: null });
    expect(nulo.success).toBe(true);
    expect(nulo.success && nulo.data.ncf).toBeNull();
  });

  it("applies the SAME grammar as the create schema (one definition, two call sites)", () => {
    for (const ncf of ["b0100000001", "B0200000001", "B01000000A1", "B010000001", "B01\r\n123456", "   "]) {
      expect(ncfIssue(zActualizarCompraInput.safeParse({ ...ACTUALIZAR_MINIMO, ncf }))).toBe(
        "ncf inválido",
      );
    }
  });

  it("still validates the other fields (a bad id is rejected independently of ncf)", () => {
    const r = zActualizarCompraInput.safeParse({ ...ACTUALIZAR_MINIMO, id: 0 });
    expect(r.success).toBe(false);
    expect((r.error?.issues ?? []).map((i) => i.path[0])).toContain("id");
  });
});
