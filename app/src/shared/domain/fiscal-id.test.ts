import {
  validarRnc,
  validarCedula,
  validarIdentificacionFiscal,
} from "./fiscal-id";

/**
 * Unit tests for the shared mod-11 fiscal-ID validator (client-validators
 * R1–R4). Fixtures are the exact spec examples plus the pinned branch cases:
 * DV raw 11→0, DV raw 10→invalid, separator normalization, and length
 * discrimination. Pure — no database, no mocks (domain is dependency-free).
 */
describe("shared/domain/fiscal-id", () => {
  describe("validarRnc — pinned weights [7,9,8,6,5,4,3,2] (R1)", () => {
    it("accepts the valid spec RNC 131045677 (Σ=114, mod 11=4, DV=7)", () => {
      expect(validarRnc("131045677")).toEqual({ ok: true, value: "131045677" });
    });

    it("rejects 131045671 — check digit 1 ≠ computed 7", () => {
      expect(validarRnc("131045671")).toEqual({ ok: false });
    });

    it("normalizes the 11→0 branch: all-zero RNC carries DV 0 and passes", () => {
      // Σ=0 → mod 11=0 → raw DV=11 → normalized to 0; trailing digit 0 matches.
      expect(validarRnc("000000000")).toEqual({ ok: true, value: "000000000" });
    });

    it("normalizes the raw-DV 10 branch as impossible: always rejected", () => {
      // Leading 8 digits `00000040` → Σ=12 → mod 11=1 → raw DV=10 (invalid).
      expect(validarRnc("000000400")).toEqual({ ok: false });
      expect(validarRnc("000000401")).toEqual({ ok: false });
      expect(validarRnc("000000409")).toEqual({ ok: false });
    });

    it("rejects a non-digit character", () => {
      expect(validarRnc("13A045677")).toEqual({ ok: false });
    });

    it("rejects the wrong length pre-checksum (8 or 10 digits)", () => {
      expect(validarRnc("13104567")).toEqual({ ok: false }); // 8 digits
      expect(validarRnc("1310456770")).toEqual({ ok: false }); // 10 digits
    });
  });

  describe("validarCedula — pinned weights [1,2,4,8,5,10,9,7,3,6] (R1)", () => {
    it("accepts the valid spec cédula 00123456795 (Σ=237, mod 11=6, DV=5)", () => {
      expect(validarCedula("00123456795")).toEqual({
        ok: true,
        value: "00123456795",
      });
    });

    it("rejects 00123456791 — check digit 1 ≠ computed 5", () => {
      expect(validarCedula("00123456791")).toEqual({ ok: false });
    });

    it("normalizes the 11→0 branch: all-zero cédula carries DV 0 and passes", () => {
      expect(validarCedula("00000000000")).toEqual({
        ok: true,
        value: "00000000000",
      });
    });

    it("rejects the wrong length pre-checksum (10 or 12 digits)", () => {
      expect(validarCedula("0012345679")).toEqual({ ok: false }); // 10 digits
      expect(validarCedula("001234567950")).toEqual({ ok: false }); // 12 digits
    });
  });

  describe("validarIdentificacionFiscal — normalization + length discrimination (R2)", () => {
    it("strips separators and dispatches by length: 131-04567-7 → RNC (passes)", () => {
      expect(validarIdentificacionFiscal("131-04567-7")).toEqual({
        ok: true,
        value: "131045677",
      });
    });

    it("strips spaces too and returns the collapsed digit run", () => {
      expect(validarIdentificacionFiscal("001 23456 795")).toEqual({
        ok: true,
        value: "00123456795",
      });
    });

    it("routes 9 digits to the RNC rule and 11 digits to the cédula rule", () => {
      expect(validarIdentificacionFiscal("131045677")).toEqual({
        ok: true,
        value: "131045677",
      });
      expect(validarIdentificacionFiscal("00123456795")).toEqual({
        ok: true,
        value: "00123456795",
      });
    });

    it("rejects bad lengths (8, 10, 12) without attempting a checksum", () => {
      expect(validarIdentificacionFiscal("12345678")).toEqual({ ok: false });
      expect(validarIdentificacionFiscal("1234567890")).toEqual({ ok: false });
      expect(validarIdentificacionFiscal("123456789012")).toEqual({ ok: false });
    });

    it("rejects an empty / whitespace-only input", () => {
      expect(validarIdentificacionFiscal("")).toEqual({ ok: false });
      expect(validarIdentificacionFiscal("   ")).toEqual({ ok: false });
    });
  });

  describe("open item: 11-digit corporate RNC is validated ONLY as cédula (R3/R4)", () => {
    it("rejects an 11-digit corporate-branch value that is not a valid cédula", () => {
      // e.g. a plausible corporate RNC `13104567701` that does NOT satisfy the
      // cédula mod-11 rule: proving 11-digit input is never accepted as an
      // RNC here. Resolution is deferred to Fase 5b/5c pending accountant
      // confirmation (design Open Questions).
      expect(validarIdentificacionFiscal("13104567701")).toEqual({ ok: false });
      expect(validarRnc("13104567701")).toEqual({ ok: false }); // RNC is 9-digit only
    });

    it("accepts an 11-digit value that happens to satisfy the cédula checksum", () => {
      // The SAME validator, with the cédula rule as the only 11-digit path.
      expect(validarIdentificacionFiscal("00123456795")).toEqual({
        ok: true,
        value: "00123456795",
      });
    });
  });
});
