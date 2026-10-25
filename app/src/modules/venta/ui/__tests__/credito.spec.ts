/**
 * Unit tests for the F2 credit display derivations (venta/ui/credito.ts).
 *
 * R-V19/R-V20/R-V27 display layer only — never a second credit rule:
 * - the vendored rejection-code strings must be literal-equal to the cobros
 *   catalog (`CREDITO_RECHAZO_CODES`) so the UI map cannot drift (test-only
 *   cross-module import; the runtime module never imports cobros);
 * - `derivarVencimiento` must equal `fechaVencimiento` from the cobros domain
 *   on the same inputs (drift guard), pinning the R-V19 scenario
 *   2026-03-01 + 15 → 2026-03-16;
 * - `derivarFormaVenta` must mirror the backend rule
 *   `esVentaCredito = !esConsumidorFinal && tipoCliente === "CREDITO"`
 *   (see `leerPerfilCreditoEnTx` in saldo-cxc.repository.ts — NOT the
 *   `creditoHabilitado` flag).
 */

import { CREDITO_RECHAZO_CODES } from "@/modules/cobros/domain/credito";
import { fechaVencimiento } from "@/modules/cobros/domain/en-mora";
import {
  derivarFormaVenta,
  derivarVencimiento,
  RECHAZO_CODIGO_CLIENTE_EN_MORA,
  RECHAZO_CODIGO_CREDITO_NO_HABILITADO,
  RECHAZO_CODIGO_LIMITE_EXCEDIDO,
  superficieRechazoCredito,
} from "../credito";

const VENDORED_CODES = [
  RECHAZO_CODIGO_CREDITO_NO_HABILITADO,
  RECHAZO_CODIGO_LIMITE_EXCEDIDO,
  RECHAZO_CODIGO_CLIENTE_EN_MORA,
] as const;

describe("superficieRechazoCredito — vendored code pin", () => {
  it("vendors EXACTLY the cobros CREDITO_RECHAZO_CODES catalog, same order", () => {
    expect(VENDORED_CODES).toEqual(CREDITO_RECHAZO_CODES);
  });

  it("maps every cataloged code to a distinct surface with fixed copy", () => {
    const mora = superficieRechazoCredito(RECHAZO_CODIGO_CLIENTE_EN_MORA);
    expect(mora).not.toBeNull();
    expect(mora!.titulo).toBe("Client has overdue invoices");
    expect(mora!.texto).toBe(
      "Sales on credit are blocked while the client keeps invoices past their due term.",
    );
    expect(mora!.variante).toBe("deuda-vencida");

    const limite = superficieRechazoCredito(RECHAZO_CODIGO_LIMITE_EXCEDIDO);
    expect(limite).not.toBeNull();
    expect(limite!.titulo).toBe("Credit limit exceeded");
    expect(limite!.texto).toBe(
      "This sale would exceed the client's authorized credit limit.",
    );
    expect(limite!.variante).toBe("limite-excedido");

    const noHabilitado = superficieRechazoCredito(
      RECHAZO_CODIGO_CREDITO_NO_HABILITADO,
    );
    expect(noHabilitado).not.toBeNull();
    expect(noHabilitado!.titulo).toBe("Credit not enabled for this client");
    expect(noHabilitado!.texto).toBe(
      "Sell cash instead: select a non-credit client or keep Consumidor Final, which stays un-gated.",
    );
    expect(noHabilitado!.variante).toBe("credito-no-habilitado");
  });

  it("returns null for a non-cataloged code (generic banner fallback)", () => {
    expect(superficieRechazoCredito("CODIGO_DESCONOCIDO")).toBeNull();
  });
});

describe("derivarVencimiento", () => {
  it("pins the R-V19 scenario: 2026-03-01 + 15 → 2026-03-16", () => {
    const emision = new Date("2026-03-01T15:00:00Z");
    expect(derivarVencimiento(emision.toISOString(), 15)).toBe("2026-03-16");
  });

  it("matches cobros fechaVencimiento on the same inputs (drift guard)", () => {
    const emision = new Date("2026-03-01T15:00:00Z");
    expect(derivarVencimiento(emision.toISOString(), 15)).toBe(
      fechaVencimiento(emision, 15),
    );
    expect(derivarVencimiento(emision.toISOString(), 0)).toBe(
      fechaVencimiento(emision, 0),
    );
    expect(derivarVencimiento(emision.toISOString(), 30)).toBe(
      fechaVencimiento(emision, 30),
    );
  });
});

describe("derivarFormaVenta — backend mirror rule", () => {
  it("null profile → CONTADO", () => {
    expect(derivarFormaVenta(null)).toBe("CONTADO");
  });

  it("Consumidor Final → CONTADO regardless of tipoCliente", () => {
    expect(
      derivarFormaVenta({ esConsumidorFinal: true, tipoCliente: "CREDITO" }),
    ).toBe("CONTADO");
  });

  it("MINORISTA with credit flag → CONTADO (backend mirrors tipoCliente, not creditoHabilitado)", () => {
    expect(
      derivarFormaVenta({ esConsumidorFinal: false, tipoCliente: "MINORISTA" }),
    ).toBe("CONTADO");
  });

  it("CREDITO client (not CF) → CREDITO", () => {
    expect(
      derivarFormaVenta({ esConsumidorFinal: false, tipoCliente: "CREDITO" }),
    ).toBe("CREDITO");
  });
});
