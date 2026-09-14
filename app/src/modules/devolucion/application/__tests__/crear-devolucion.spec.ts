/**
 * Application unit tests — `crearDevolucion` R-D5 idempotency gate (mocked
 * repositories, no DB).
 *
 * Proves the gate short-circuits BEFORE the NCF consume and BEFORE any write:
 * when `existeDevolucionIdenticaEnTx` matches an exact
 * (producto, cantidad, tipoReposicion) triple already emitted on a prior
 * VIGENTE NC of the same factura, the case returns the stable 605 code with
 * its minimal locator context and `consumirNcfEnTx` / the NC writers are never
 * invoked. The real Prisma/RLS behavior is covered by
 * `src/integration/devolucion-idempotencia.integration.test.ts`.
 */

import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import { consumirNcfEnTx } from "@/modules/ncf/application/consumir-ncf";
import { DEVOLUCION_YA_REGISTRADA, messageFor } from "@/modules/venta/domain/errors";
import { crearDevolucion } from "../crear-devolucion";

jest.mock("../../infrastructure/devolucion-repository", () => ({
  leerStockSucursalEnTx: jest.fn(),
  leerPriorNCsPorFacturaEnTx: jest.fn(),
  existeDevolucionIdenticaEnTx: jest.fn(),
  crearNotaCreditoEnTx: jest.fn(),
  crearDetalleNotaCreditoEnTx: jest.fn(),
  registrarAuditNotaCreditoEnTx: jest.fn(),
}));

// Wholesale mock: this unit must never pull the noisy generated Prisma client
// behind the real ncf/inventario seams (venta-service.test.ts precedent), and
// the retry path never inspects `NcfConsumoError` values.
jest.mock("@/modules/ncf/application/consumir-ncf", () => ({
  consumirNcfEnTx: jest.fn(),
}));

jest.mock("@/modules/inventario/application/registrar-salidas-venta", () => ({
  registrarDevolucion: jest.fn(),
}));

jest.mock("@/modules/venta/infrastructure/venta-repository", () => ({
  leerVentaParaDevolucionEnTx: jest.fn(),
}));

// Real `VentaConfigError` kept via requireActual: the mock only stubs the async
// reader (same convention as the venta-service unit tests).
jest.mock("@/modules/venta/infrastructure/config-repository", () => {
  const actual = jest.requireActual(
    "@/modules/venta/infrastructure/config-repository",
  ) as Record<string, unknown>;
  return { ...actual, leerPlazoDevolucionEnTx: jest.fn() };
});

// --- fixtures ---------------------------------------------------------------

const ctx: TenantCtx = { empresaId: 1, sucursalId: 2, usuarioId: 3, esAdmin: true };
const tx = {} as unknown as PrismaTx;
const NOW = new Date("2026-09-05T12:00:00.000Z");

const ventaConfirmada = {
  ventaId: 10,
  ventaFecha: new Date("2026-09-01T15:00:00.000Z"),
  clienteId: 7,
  estado: "CONFIRMADA" as const,
  factura: {
    facturaId: 88,
    ncf: "B0200000522",
    estado: "VIGENTE" as const,
    fechaEmision: NOW,
  },
  lineas: [
    { productoId: 10, cantidad: "5.000", precioUnitario: "100.00", tasaItbis: "18" },
  ],
};

const repo = jest.requireMock("../../infrastructure/devolucion-repository") as {
  leerStockSucursalEnTx: jest.Mock;
  leerPriorNCsPorFacturaEnTx: jest.Mock;
  existeDevolucionIdenticaEnTx: jest.Mock;
  crearNotaCreditoEnTx: jest.Mock;
  crearDetalleNotaCreditoEnTx: jest.Mock;
  registrarAuditNotaCreditoEnTx: jest.Mock;
};
const ventaRepo = jest.requireMock(
  "@/modules/venta/infrastructure/venta-repository",
) as { leerVentaParaDevolucionEnTx: jest.Mock };
const configRepo = jest.requireMock(
  "@/modules/venta/infrastructure/config-repository",
) as { leerPlazoDevolucionEnTx: jest.Mock };

beforeEach(() => {
  jest.clearAllMocks();
  ventaRepo.leerVentaParaDevolucionEnTx.mockResolvedValue(ventaConfirmada);
  configRepo.leerPlazoDevolucionEnTx.mockResolvedValue(15);
  repo.leerStockSucursalEnTx.mockResolvedValue([
    { productoId: 10, inventarioId: 5, cantidad: { toString: () => "10.000" } },
  ]);
  repo.leerPriorNCsPorFacturaEnTx.mockResolvedValue(new Map());
});

describe("crearDevolucion — R-D5 idempotency gate", () => {
  it("identical triple is a retry: DEVOLUCION_YA_REGISTRADA with locator, short-circuits BEFORE the B04 burn", async () => {
    repo.existeDevolucionIdenticaEnTx.mockResolvedValue({ productoId: 10 });

    const r = await crearDevolucion(tx, ctx, {
      ventaId: 10,
      motivo: "retry",
      lineas: [{ productoId: 10, cantidad: "1", tipoReposicion: "VENDIBLE" }],
      now: NOW,
    });

    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe(DEVOLUCION_YA_REGISTRADA);
      expect(r.message).toBe(messageFor(DEVOLUCION_YA_REGISTRADA));
      expect(r.details).toEqual({ facturaId: 88, productoId: 10 });
    }
    // The gate consults the SAME transaction, for the caller's exact lines,
    // against the venta's factura — and MUST precede the burn and every write.
    expect(repo.existeDevolucionIdenticaEnTx).toHaveBeenCalledWith(tx, ctx, 88, [
      { productoId: 10, cantidad: "1", tipoReposicion: "VENDIBLE" },
    ]);
    expect(consumirNcfEnTx).not.toHaveBeenCalled();
    expect(repo.crearNotaCreditoEnTx).not.toHaveBeenCalled();
    expect(repo.crearDetalleNotaCreditoEnTx).not.toHaveBeenCalled();
    expect(repo.registrarAuditNotaCreditoEnTx).not.toHaveBeenCalled();
  });
});
