/**
 * ROL catalog reader — `where`/`select` shape with a fake tx (no DB).
 * ROL is a GLOBAL catalog (no empresaId column): the read is active-only,
 * explicit select, deterministic order and bounded.
 */

import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import { listarRolesActivosEnTx } from "./roles-catalogo-repository";

function makeTx(rows: unknown[] = []): PrismaTx {
  return {
    rol: { findMany: jest.fn().mockResolvedValue(rows) },
  } as unknown as PrismaTx;
}

describe("listarRolesActivosEnTx", () => {
  it("reads only active roles with an explicit select, ordered and bounded", async () => {
    const tx = makeTx([{ id: 2, nombre: "Operador" }]);

    const roles = await listarRolesActivosEnTx(tx);

    const args = (tx.rol.findMany as jest.Mock).mock.calls[0][0];
    expect(args.where).toEqual({ activo: true });
    expect(args.select).toEqual({ id: true, nombre: true });
    expect(args.orderBy).toEqual({ nombre: "asc" });
    expect(args.take).toBe(100);
    expect(roles).toEqual([{ id: 2, nombre: "Operador" }]);
  });
});
