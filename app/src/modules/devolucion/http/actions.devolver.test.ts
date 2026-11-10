import { devolverVentaAction } from "./actions.devolver";
import { crearDevolucion } from "../application/crear-devolucion";
import { VentaDomainError } from "../../venta/domain/errors";
import { tieneRolPermitidoEnTx } from "../../venta/infrastructure/venta-repository";
import { createClient } from "@/lib/supabase/client";
import { getCurrentTenantContext } from "@/modules/tenant/infrastructure/tenant-runtime";
import { withTenantTransaction } from "@/modules/tenant/infrastructure/withTenantTransaction";

jest.mock("@/lib/supabase/client", () => ({ createClient: jest.fn() }));
jest.mock("@/modules/tenant/infrastructure/tenant-runtime", () => ({
  getCurrentTenantContext: jest.fn(),
}));
jest.mock("@/modules/tenant/infrastructure/withTenantTransaction", () => ({
  withTenantTransaction: jest.fn(),
}));
jest.mock("../../venta/infrastructure/venta-repository", () => ({
  tieneRolPermitidoEnTx: jest.fn(),
}));
jest.mock("../application/crear-devolucion", () => ({
  crearDevolucion: jest.fn(),
}));

const ctx = { empresaId: 1, sucursalId: 2, usuarioId: 3, esAdmin: true };

beforeEach(() => {
  jest.resetAllMocks();
  (createClient as jest.Mock).mockResolvedValue({});
  (getCurrentTenantContext as jest.Mock).mockResolvedValue(ctx);
  (withTenantTransaction as jest.Mock).mockImplementation(
    (_context: unknown, run: (tx: unknown) => Promise<unknown>) => run({}),
  );
  (tieneRolPermitidoEnTx as jest.Mock).mockResolvedValue(true);
});

describe("devolverVentaAction — stock-ceiling rollback mapping", () => {
  it("maps the thrown sale-domain ceiling error after transaction rollback to its typed action result", async () => {
    (crearDevolucion as jest.Mock).mockRejectedValue(
      new VentaDomainError("STOCK_MAXIMO_EXCEDIDO" as never, { ventaId: 7 }),
    );

    await expect(
      devolverVentaAction({
        ventaId: 7,
        motivo: "return test",
        lineas: [{ productoId: 10, cantidad: "5", tipoReposicion: "VENDIBLE" }],
      }),
    ).resolves.toEqual({
      ok: false,
      error: {
        code: "STOCK_MAXIMO_EXCEDIDO",
        message:
          "La operación dejaría la existencia por encima del máximo permitido (999,999,999.999)",
      },
    });
  });
});
