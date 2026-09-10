/**
 * Error-catalog unit tests — the Phase-5c delta (spec R-V13, task 2.1). Pure.
 *
 * `venta.spec.ts` keeps the historical R-V13 length assertion (updated 14→19);
 * THIS file is the focused 5c coverage: it proves the five new confirm codes are
 * real catalog members with Spanish copy, that the two warning channels stay OUT
 * of the error catalog, and — via a `Record<VentaErrorCode, true>` — that the
 * union is exhaustive (tsc rejects any code missing here). No database.
 */

import {
  messageFor,
  NCF_AGOTADA,
  NCF_VENCIDA,
  NCF_SEC_INEXISTENTE,
  FACTURA_AUTOMATICA_FALTA,
  STOCK_INSUFICIENTE_BLOQUEO,
  type VentaErrorCode,
} from "../errors";

describe("venta error catalog — 5c confirm delta (R-V13 / R-V15)", () => {
  // Exhaustiveness guard: adding a member to `VentaErrorCode` without a key here
  // is a COMPILE error, so this object is a machine-checked catalog census.
  const CENSUS: Record<VentaErrorCode, true> = {
    VENTA_NO_ENCONTRADO: true,
    VENTA_INMUTABLE: true,
    CONCURRENCIA_CONFLICTO: true,
    LINEAS_VACIAS: true,
    LINEA_INVALIDA: true,
    PRODUCTO_NO_ENCONTRADO: true,
    PRODUCTO_INACTIVO: true,
    TASA_ITBIS_VIGENCIA_FALTA: true,
    DESCUENTO_EXCEDE_MAXIMO: true,
    DESCUENTO_EXCEDE_BASE: true,
    DESCUENTO_INVALIDO: true,
    DESCUENTO_NO_AUTORIZADO: true,
    CLIENTE_NO_ENCONTRADO: true,
    CLIENTE_INACTIVO: true,
    NCF_AGOTADA: true,
    NCF_VENCIDA: true,
    NCF_SEC_INEXISTENTE: true,
    FACTURA_AUTOMATICA_FALTA: true,
    STOCK_INSUFICIENTE_BLOQUEO: true,
  };

  it("carries exactly 19 stable codes", () => {
    expect(Object.keys(CENSUS)).toHaveLength(19);
  });

  it("exposes the five confirm codes with distinct stable values", () => {
    expect(NCF_AGOTADA).toBe("NCF_AGOTADA");
    expect(NCF_VENCIDA).toBe("NCF_VENCIDA");
    expect(NCF_SEC_INEXISTENTE).toBe("NCF_SEC_INEXISTENTE");
    expect(FACTURA_AUTOMATICA_FALTA).toBe("FACTURA_AUTOMATICA_FALTA");
    expect(STOCK_INSUFICIENTE_BLOQUEO).toBe("STOCK_INSUFICIENTE_BLOQUEO");
  });

  it("gives every catalog code a non-empty Spanish message (incl. the new five)", () => {
    for (const code of Object.keys(CENSUS) as VentaErrorCode[]) {
      expect(messageFor(code)).toMatch(/\S/);
    }
  });

  it("keeps the two warning channels OUT of the error catalog", () => {
    const catalogo = new Set<string>(Object.keys(CENSUS));
    // Draft-save warning and the 90% NCF threshold are WARNING codes, never errors.
    expect(catalogo.has("STOCK_INSUFICIENTE")).toBe(false);
    expect(catalogo.has("NCF_UMBRAL_90")).toBe(false);
  });
});
