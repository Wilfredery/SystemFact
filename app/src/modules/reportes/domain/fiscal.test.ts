/**
 * Unit tests — the per-period ITBIS summary and the IT-1 casilla worksheet (FIS-1, FIS-2; 5.6).
 *
 * PURE (no DB). Pins the FIS-2 self-check rule: the worksheet's ITBIS-retenido figure equals Σ606
 * retenido (cuadra) when nothing overrides it, and a manual casilla-60 that disagrees is surfaced as
 * a validation WARNING (never a silent agreement — spec FIS-2 scenario). Also pins neto = débito −
 * crédito (allowing a negative saldo a favor) and the two frozen in-report notes (B11 no-credit,
 * day-20 guidance) that the panel + worksheet both render.
 */

import {
  NOTA_B11_SIN_CREDITO_FISCAL,
  NOTA_VENCIMIENTO_IT1,
  construirCasillasIT1,
  construirResumenITBIS,
} from "./fiscal";

describe("domain/fiscal — FIS-1 ITBIS summary", () => {
  const insumo = {
    itbisVentas: "1800.00",
    baseGravadaVentas: "10000.00",
    itbisComprasFacturado: "360.00",
    itbisComprasAdelantar: "360.00",
    itbisRetenidoCompras: "120.00",
    isrRetenidoCompras: "200.00",
  };
  it("exposes débito = Σ607 ITBIS and retenido = Σ606 ITBIS retenido as Decimal strings", () => {
    const r = construirResumenITBIS(insumo);
    expect(r.debitoFiscal).toBe("1800.00");
    expect(r.creditoFiscal).toBe("360.00");
    expect(r.itbisRetenido).toBe("120.00");
    expect(r.isrRetenido).toBe("200.00");
  });
});

describe("domain/fiscal — FIS-2 IT-1 casilla worksheet + self-check", () => {
  const resumen = construirResumenITBIS({
    itbisVentas: "1800.00",
    baseGravadaVentas: "10000.00",
    itbisComprasFacturado: "360.00",
    itbisComprasAdelantar: "360.00",
    itbisRetenidoCompras: "120.00",
    isrRetenidoCompras: "200.00",
  });

  it("neto = débito − crédito; retenido equals Σ606 (cuadra) when no override is entered", () => {
    const w = construirCasillasIT1(resumen);
    expect(w.debitoFiscal).toBe("1800.00");
    expect(w.creditoAdelantos).toBe("360.00");
    expect(w.netoAPagar).toBe("1440.00"); // 1800 − 360
    expect(w.itbisRetenido).toBe("120.00"); // == Σ606 D12
    expect(w.cuadreRetenido).toBe(true);
    expect(w.avisoValidacion).toBeNull();
  });

  it("a negative neto is reported honestly as a saldo a favor (never clamped to 0)", () => {
    const r = construirResumenITBIS({
      itbisVentas: "100.00",
      baseGravadaVentas: "0.00",
      itbisComprasFacturado: "500.00",
      itbisComprasAdelantar: "500.00",
      itbisRetenidoCompras: "0.00",
      isrRetenidoCompras: "0.00",
    });
    const w = construirCasillasIT1(r);
    expect(w.netoAPagar).toBe("-400.00");
  });

  it("a manual casilla-60 that MISMATCHES Σ606 surfaces a validation warning (FIS-2 scenario)", () => {
    const w = construirCasillasIT1(resumen, "999.00");
    expect(w.cuadreRetenido).toBe(false);
    expect(w.avisoValidacion).not.toBeNull();
    expect(w.avisoValidacion).toContain("no cuadra");
    // The authoritative figure stays Σ606, not the bad manual value.
    expect(w.itbisRetenido).toBe("120.00");
  });

  it("a manual casilla-60 that AGREES keeps the worksheet clean", () => {
    const w = construirCasillasIT1(resumen, "120.00");
    expect(w.cuadreRetenido).toBe(true);
    expect(w.avisoValidacion).toBeNull();
  });

  it("the two in-report notes are frozen and mention the DGII rules (B11 no-credit, day 20)", () => {
    expect(NOTA_B11_SIN_CREDITO_FISCAL).toContain("B11");
    expect(NOTA_B11_SIN_CREDITO_FISCAL).toContain("no generan crédito");
    expect(NOTA_VENCIMIENTO_IT1).toContain("día 20");
  });
});
