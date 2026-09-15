import { consultarRecibo } from "./consultar-recibo";
import { leerReciboEnTx, type ReciboLeido } from "../infrastructure/pago-repository";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";

jest.mock("../infrastructure/pago-repository", () => ({
  leerReciboEnTx: jest.fn(),
}));

const ctx: TenantCtx = { empresaId: 1, sucursalId: 1, usuarioId: 1, esAdmin: true };
const tx = {} as unknown as PrismaTx;

function recibo(over: Partial<ReciboLeido> = {}): ReciboLeido {
  return {
    correlativoRecibo: 42,
    tipo: "COBRO",
    estado: "APLICADO",
    monto: "1500.00",
    metodoPago: "EFECTIVO",
    fecha: new Date("2026-02-01T10:00:00.000Z"),
    autorizadoPor: null,
    facturaId: 77,
    facturaNcf: "B0100000077",
    clienteNombre: "Ferretería del Valle",
    usuarioNombre: "Ana",
    empresaNombre: "Abarrotes SS",
    ...over,
  };
}

describe("consultarRecibo (R-C4 reprint read)", () => {
  beforeEach(() => jest.resetAllMocks());

  it("returns the non-fiscal receipt projection (Decimal-string money kept)", async () => {
    (leerReciboEnTx as jest.Mock).mockResolvedValue(recibo());
    const result = await consultarRecibo(tx, ctx, { correlativoRecibo: 42 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.correlativoRecibo).toBe(42);
      expect(result.data.monto).toBe("1500.00"); // string, never a float
      expect(result.data.facturaNcf).toBe("B0100000077");
      expect(result.data.fecha).toBe("2026-02-01T10:00:00.000Z");
    }
    expect(leerReciboEnTx).toHaveBeenCalledWith(tx, ctx, 42);
  });

  it("maps a missing/foreign receipt to PAGO_NO_ENCONTRADO (no throw, R-C5)", async () => {
    (leerReciboEnTx as jest.Mock).mockResolvedValue(null);
    const result = await consultarRecibo(tx, ctx, { correlativoRecibo: 999 });
    expect(result.ok === false && result.code).toBe("PAGO_NO_ENCONTRADO");
  });
});
