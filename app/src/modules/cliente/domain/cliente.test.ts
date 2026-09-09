import { Decimal } from "decimal.js";
import {
  TIPO_CLIENTE,
  esTipoClienteConCrediticio,
  normalizeNombre,
  normalizeIdentificacionFiscal,
  validarLimitesCredito,
  validarReglasCredito,
  LIMITE_CREDITO_DEFAULT,
  PLAZO_CREDITO_DIAS_DEFAULT,
} from "./cliente";
import {
  CREDITO_REQUIERE_FISCAL_IDENTIDAD,
  IDENTIFICACION_FISCAL_INVALIDA,
  VALIDATION_ERROR,
  ClienteDomainError,
} from "./errors";

/**
 * Unit tests for the pure Cliente domain (no DB). The named RED case for task
 * 1.4 is `validarReglasCredito` (credit ⇒ fiscal identity, R5); defaults,
 * limits and fiscal normalization (task 1.5) are asserted alongside so the
 * GREEN entity is fully exercised.
 */
describe("cliente/domain", () => {
  describe("normalizeNombre", () => {
    it("trims and collapses internal whitespace", () => {
      expect(normalizeNombre("  Ferretería   del  Valle ")).toBe(
        "Ferretería del Valle",
      );
    });
  });

  describe("normalizeIdentificacionFiscal — shared validator reuse", () => {
    it("returns null for null and blank (Consumidor Final)", () => {
      expect(normalizeIdentificacionFiscal(null)).toBeNull();
      expect(normalizeIdentificacionFiscal("   ")).toBeNull();
    });

    it("accepts a valid 9-digit RNC and returns the collapsed digits", () => {
      expect(normalizeIdentificacionFiscal("131-04567-7")).toBe("131045677");
    });

    it("accepts a valid 11-digit cédula", () => {
      expect(normalizeIdentificacionFiscal("00123456795")).toBe("00123456795");
    });

    it("throws the stable IDENTIFICACION_FISCAL_INVALIDA on a bad check digit", () => {
      expect(() => normalizeIdentificacionFiscal("131045671")).toThrow(
        ClienteDomainError,
      );
      try {
        normalizeIdentificacionFiscal("131045671");
      } catch (e) {
        expect((e as ClienteDomainError).code).toBe(IDENTIFICACION_FISCAL_INVALIDA);
      }
    });

    it("throws IDENTIFICACION_FISCAL_INVALIDA on a non-fiscal length", () => {
      expect(() => normalizeIdentificacionFiscal("12345")).toThrow(
        ClienteDomainError,
      );
    });
  });

  describe("credit defaults & limits (R3)", () => {
    it("documents the frozen defaults limit 0.00 / plazo 30", () => {
      expect(LIMITE_CREDITO_DEFAULT).toBe("0.00");
      expect(PLAZO_CREDITO_DIAS_DEFAULT).toBe(30);
    });

    it("accepts a zero limit and a positive term", () => {
      expect(() =>
        validarLimitesCredito({
          limiteCredito: new Decimal(LIMITE_CREDITO_DEFAULT),
          plazoCreditoDias: PLAZO_CREDITO_DIAS_DEFAULT,
        }),
      ).not.toThrow();
    });

    it("rejects a negative limit with VALIDATION_ERROR (money never float)", () => {
      expect(() =>
        validarLimitesCredito({
          limiteCredito: new Decimal("-0.01"),
          plazoCreditoDias: 30,
        }),
      ).toThrow(
        expect.objectContaining({ code: VALIDATION_ERROR }) as unknown as Error,
      );
    });

    it("rejects a non-positive term with VALIDATION_ERROR", () => {
      expect(() =>
        validarLimitesCredito({
          limiteCredito: new Decimal("1000.00"),
          plazoCreditoDias: 0,
        }),
      ).toThrow(
        expect.objectContaining({ code: VALIDATION_ERROR }) as unknown as Error,
      );
    });
  });

  describe("validarReglasCredito — cross-field credit rule (R5, task 1.4 RED)", () => {
    const fiscalValida = "131045677"; // valid mod-11 RNC

    it("esTipoClienteConCrediticio: only CREDITO is credit-bearing by label", () => {
      expect(esTipoClienteConCrediticio(TIPO_CLIENTE.CREDITO)).toBe(true);
      expect(esTipoClienteConCrediticio(TIPO_CLIENTE.MAYORISTA)).toBe(false);
      expect(esTipoClienteConCrediticio(TIPO_CLIENTE.MINORISTA)).toBe(false);
    });

    it("passes when no credit is requested and fiscal ID is null", () => {
      expect(() =>
        validarReglasCredito({
          creditoHabilitado: false,
          limiteCredito: new Decimal("0.00"),
          tipoCliente: TIPO_CLIENTE.MINORISTA,
          identificacionFiscal: null,
        }),
      ).not.toThrow();
    });

    it("rejects creditoHabilitado=true with NULL fiscal ID", () => {
      expect(() =>
        validarReglasCredito({
          creditoHabilitado: true,
          limiteCredito: new Decimal("0.00"),
          tipoCliente: TIPO_CLIENTE.MINORISTA,
          identificacionFiscal: null,
        }),
      ).toThrow(
        expect.objectContaining({
          code: CREDITO_REQUIERE_FISCAL_IDENTIDAD,
        }) as unknown as Error,
      );
    });

    it("rejects limiteCredito>0 with NULL fiscal ID", () => {
      expect(() =>
        validarReglasCredito({
          creditoHabilitado: false,
          limiteCredito: new Decimal("5000.00"),
          tipoCliente: TIPO_CLIENTE.MINORISTA,
          identificacionFiscal: null,
        }),
      ).toThrow(
        expect.objectContaining({
          code: CREDITO_REQUIERE_FISCAL_IDENTIDAD,
        }) as unknown as Error,
      );
    });

    it("rejects a credit-bearing tipoCliente (CREDITO) with NULL fiscal ID", () => {
      expect(() =>
        validarReglasCredito({
          creditoHabilitado: false,
          limiteCredito: new Decimal("0.00"),
          tipoCliente: TIPO_CLIENTE.CREDITO,
          identificacionFiscal: null,
        }),
      ).toThrow(
        expect.objectContaining({
          code: CREDITO_REQUIERE_FISCAL_IDENTIDAD,
        }) as unknown as Error,
      );
    });

    it("rejects credit when the fiscal ID is present but mod-11-invalid", () => {
      expect(() =>
        validarReglasCredito({
          creditoHabilitado: true,
          limiteCredito: new Decimal("0.00"),
          tipoCliente: TIPO_CLIENTE.CREDITO,
          identificacionFiscal: "131045671", // bad check digit
        }),
      ).toThrow(
        expect.objectContaining({
          code: CREDITO_REQUIERE_FISCAL_IDENTIDAD,
        }) as unknown as Error,
      );
    });

    it("passes credit with a valid stored fiscal ID", () => {
      expect(() =>
        validarReglasCredito({
          creditoHabilitado: true,
          limiteCredito: new Decimal("10000.00"),
          tipoCliente: TIPO_CLIENTE.CREDITO,
          identificacionFiscal: fiscalValida,
        }),
      ).not.toThrow();
    });
  });
});
