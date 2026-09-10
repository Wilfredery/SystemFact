/**
 * Application unit tests — venta client resolver (spec R-V10, mocked repository).
 *
 * The CF provisioning (contado) and the real cross-tenant/inactive DB behaviour
 * are integration-tested; this unit pins the resolver's DECISION matrix against
 * mocked reads: null → CF seam, active named id → pass-through, unknown/foreign →
 * CLIENTE_NO_ENCONTRADO, inactive → CLIENTE_INACTIVO.
 */

import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import { getOrCreateConsumidorFinalEnTx } from "@/modules/cliente/application/consumidor-final";
import { leerClienteParaVentaEnTx } from "../infrastructure/venta-repository";
import { resolverClienteParaVentaEnTx } from "./resolver-cliente-venta";

jest.mock("@/modules/cliente/application/consumidor-final", () => ({
  getOrCreateConsumidorFinalEnTx: jest.fn(),
}));
jest.mock("../infrastructure/venta-repository", () => ({
  leerClienteParaVentaEnTx: jest.fn(),
}));

const ctx: TenantCtx = { empresaId: 1, sucursalId: 2, usuarioId: 3, esAdmin: true };
const tx = {} as unknown as PrismaTx;

beforeEach(() => {
  jest.clearAllMocks();
  (getOrCreateConsumidorFinalEnTx as jest.Mock).mockResolvedValue({ id: 99 });
});

it("null resolves to the empresa's Consumidor Final via the 5a seam", async () => {
  const r = await resolverClienteParaVentaEnTx(tx, ctx, null);
  expect(r.ok === true && r.data.clienteId).toBe(99);
  expect(getOrCreateConsumidorFinalEnTx).toHaveBeenCalledWith(tx, 1);
  expect(leerClienteParaVentaEnTx).not.toHaveBeenCalled();
});

it("an active named client passes through with no CF call", async () => {
  (leerClienteParaVentaEnTx as jest.Mock).mockResolvedValue({ id: 5, activo: true, esConsumidorFinal: false });
  const r = await resolverClienteParaVentaEnTx(tx, ctx, 5);
  expect(r.ok === true && r.data.clienteId).toBe(5);
  expect(getOrCreateConsumidorFinalEnTx).not.toHaveBeenCalled();
});

it("unknown / cross-tenant id → CLIENTE_NO_ENCONTRADO (no leakage)", async () => {
  (leerClienteParaVentaEnTx as jest.Mock).mockResolvedValue(null);
  const r = await resolverClienteParaVentaEnTx(tx, ctx, 123);
  expect(!r.ok && r.code).toBe("CLIENTE_NO_ENCONTRADO");
});

it("inactive client → CLIENTE_INACTIVO", async () => {
  (leerClienteParaVentaEnTx as jest.Mock).mockResolvedValue({ id: 5, activo: false, esConsumidorFinal: false });
  const r = await resolverClienteParaVentaEnTx(tx, ctx, 5);
  expect(!r.ok && r.code).toBe("CLIENTE_INACTIVO");
});
