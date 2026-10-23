/**
 * Mapping-layer tests for `confirmarVentaAction` (F2 slice B task 2.6, D7/R-V25):
 * the action relays the use case's display-only `credito` verdict UNCHANGED —
 * no transformation, no validation — for both shapes, and the existing
 * `ncfWarning` passthrough stays green. Use-case results are mocked (the
 * mock-DTO-contract pattern used by the cliente/venta UI suites); the domain
 * chain itself is regressed by `confirmar-venta.test.ts`.
 */

import { confirmarVentaAction } from "./actions.escritura";
import { confirmarVenta } from "../application/confirmar-venta";
import { tieneRolPermitidoEnTx } from "../infrastructure/venta-repository";

jest.mock("@/lib/supabase/client", () => ({ createClient: jest.fn() }));
jest.mock("@/modules/tenant/infrastructure/tenant-runtime", () => ({
  getCurrentTenantContext: jest.fn(),
}));
jest.mock("@/modules/tenant/infrastructure/withTenantTransaction", () => ({
  withTenantTransaction: jest.fn(),
}));
jest.mock("../application/confirmar-venta", () => ({
  confirmarVenta: jest.fn(),
}));
jest.mock("../infrastructure/venta-repository", () => ({
  tieneRolPermitidoEnTx: jest.fn(),
}));

import { createClient } from "@/lib/supabase/client";
import { getCurrentTenantContext } from "@/modules/tenant/infrastructure/tenant-runtime";
import { withTenantTransaction } from "@/modules/tenant/infrastructure/withTenantTransaction";

const mockCtx = { empresaId: 1, sucursalId: 1, usuarioId: 1, esAdmin: true };

beforeEach(() => {
  jest.resetAllMocks();
  (createClient as jest.Mock).mockResolvedValue({});
  (withTenantTransaction as jest.Mock).mockImplementation(
    (_c: unknown, fn: (t: unknown) => Promise<unknown>) => fn({}),
  );
  (getCurrentTenantContext as jest.Mock).mockResolvedValue(mockCtx);
  (tieneRolPermitidoEnTx as jest.Mock).mockResolvedValue(true);
});

const baseData = {
  id: 7,
  estado: "CONFIRMADA",
  facturaId: 80,
  ncf: "B0200000522",
  tipoNcf: "B02",
  correlativoInterno: "FAC-000001",
  subtotalGravado: "100.00",
  subtotalExento: "0.00",
  itbis: "18.00",
  descuento: "0.00",
  total: "118.00",
};

describe("confirmarVentaAction — credito verdict verbatim relay (D7/R-V25)", () => {
  it("relays the CONTADO verdict unchanged", async () => {
    (confirmarVenta as jest.Mock).mockResolvedValue({
      ok: true,
      data: { ...baseData, credito: { forma: "CONTADO" } },
    });
    const result = await confirmarVentaAction({ id: 7 });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.credito).toEqual({ forma: "CONTADO" });
    expect(confirmarVenta).toHaveBeenCalledWith(expect.anything(), mockCtx, { id: 7 });
  });

  it("relays the CREDITO verdict (term + emission instant) unchanged", async () => {
    const credito = {
      forma: "CREDITO",
      plazoCreditoDias: 15,
      fechaEmision: "2026-03-01T15:00:00.000Z",
    } as const;
    (confirmarVenta as jest.Mock).mockResolvedValue({
      ok: true,
      data: { ...baseData, credito },
    });
    const result = await confirmarVentaAction({ id: 7 });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.credito).toBe(credito); // SAME object identity — zero transformation
  });

  it("keeps the ncfWarning passthrough green beside the relay", async () => {
    (confirmarVenta as jest.Mock).mockResolvedValue({
      ok: true,
      data: { ...baseData, credito: { forma: "CONTADO" } },
      warnings: [{ code: "NCF_UMBRAL_90" }],
    });
    const result = await confirmarVentaAction({ id: 7 });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.ncfWarning).toBe("NCF_UMBRAL_90");
  });
});
