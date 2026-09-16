/**
 * Unit — the RFC 4180 CSV writer (EXP-1). No DB.
 *
 * Pins every byte-level claim: the `Arroz, 5kg "premium"` quoting/escaping case, the
 * exact `10.18` Decimal rendering (never float), CRLF record separators, the full-precision
 * Decimal across a big/small magnitude, UTF-8 output WITHOUT a BOM, and byte-determinism
 * (same inputs → identical bytes, twice).
 */

import { Decimal } from "decimal.js";
import { escribirCsv, csvBuffer } from "./csv-writer";

describe("escribirCsv — RFC 4180 quoting + precision (EXP-1)", () => {
  it("quotes a field containing comma/quote and doubles embedded quotes", () => {
    // The exact EXP-1 scenario field.
    const csv = escribirCsv(["producto", "total"], [
      ['Arroz, 5kg "premium"', "10.18"],
    ]);
    // The name becomes RFC-quoted with the inner quotes doubled: "Arroz, 5kg ""premium"""
    expect(csv).toBe('producto,total\r\n"Arroz, 5kg ""premium""",10.18\r\n');
  });

  it("renders a Decimal amount exactly as 10.18 (no float drift)", () => {
    const csv = escribirCsv(["total"], [[new Decimal("10.18")]]);
    expect(csv).toBe("total\r\n10.18\r\n");
  });

  it("keeps full Decimal precision for a large and a small magnitude", () => {
    const csv = escribirCsv(["m"], [
      [new Decimal("1234567.89")],
      [new Decimal("0.01")],
    ]);
    expect(csv).toBe("m\r\n1234567.89\r\n0.01\r\n");
  });

  it("uses CRLF between records and always ends with a trailing CRLF", () => {
    const csv = escribirCsv(["a", "b"], [
      ["1", "2"],
      ["3", "4"],
    ]);
    expect(csv).toBe("a,b\r\n1,2\r\n3,4\r\n");
    // No lone \n anywhere.
    expect(/\r\n/.test(csv)).toBe(true);
    expect(/[^\r]\n/.test(csv)).toBe(false);
  });

  it("a header-only document (no rows) is just the header line", () => {
    expect(escribirCsv(["col1", "col2"], [])).toBe("col1,col2\r\n");
  });

  it("null/undefined cells serialize to empty; booleans and bigints to text", () => {
    const csv = escribirCsv(["x"], [[null, undefined, true, BigInt(10)]]);
    // header + one record: 4 cells → "x,,,"? header has 1 col but row has 4 — writer emits
    // all cells as given (row width is the caller's contract), so the data row is `,,,true,10`.
    expect(csv).toBe("x\r\n,,true,10\r\n");
  });
});

describe("csvBuffer — UTF-8 without BOM + determinism (EXP-1)", () => {
  it("emits UTF-8 bytes with NO byte-order-mark (first byte is the header, not 0xEF)", () => {
    const buf = csvBuffer(escribirCsv(["nombre"], [["Ana"]]));
    expect(buf[0]).toBe(0x6e); // 'n'
    // A UTF-8 BOM would be EF BB BF — assert the very first three bytes are NOT that.
    expect(buf[0]).not.toBe(0xef);
  });

  it("produces byte-identical output for identical inputs, run twice", () => {
    const hacer = (): string =>
      escribirCsv(["sku", "monto", "nombre"], [
        ["A-1", new Decimal("10.18"), "Arroz, 5kg"],
        ["B-2", "0.00", 'Silla "x"'],
      ]);
    const a = hacer();
    const b = hacer();
    expect(a).toBe(b);
    const ba = csvBuffer(a);
    const bb = csvBuffer(b);
    expect(ba.equals(bb)).toBe(true);
  });
});
