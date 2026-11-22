/**
 * Screen audit S7 (odd/tasks/screen-audit-fixes.md): the category selector of the products screen
 * is capped at 200 (same value as the inventory category filter), keeps its tenant filter, its
 * explicit select and its alphabetical order.
 */

import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import { listarCategoriasProductoEnTx } from "./producto-repository";

const ctx: TenantCtx = { empresaId: 7, sucursalId: 3, usuarioId: 11, esAdmin: false };

describe("listarCategoriasProductoEnTx", () => {
  it("caps the selector at 200 and keeps tenant filter, select and order", async () => {
    const findMany = jest.fn(async () => [{ id: 1, nombre: "Arroz" }]);
    const tx = { categoria: { findMany } } as unknown as PrismaTx;

    const r = await listarCategoriasProductoEnTx(tx, ctx);

    expect(r).toEqual([{ id: 1, nombre: "Arroz" }]);
    expect(findMany).toHaveBeenCalledWith({
      where: { empresaId: 7, activa: true },
      select: { id: true, nombre: true },
      orderBy: { nombre: "asc" },
      take: 200,
    });
  });
});
