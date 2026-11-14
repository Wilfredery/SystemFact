/**
 * Application unit tests — `consultarRolesCatalogo` (repository mocked).
 * The ROL catalog is global and read-only here: the use case only forwards the
 * ACTIVE roles the repository returns, as `{ id, nombre }`.
 */

import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import { listarRolesActivosEnTx } from "../infrastructure/roles-catalogo-repository";
import { consultarRolesCatalogo } from "./consultar-roles-catalogo";

jest.mock("../infrastructure/roles-catalogo-repository", () => ({
  listarRolesActivosEnTx: jest.fn(),
}));

const tx = {} as unknown as PrismaTx;

beforeEach(() => jest.clearAllMocks());

describe("consultarRolesCatalogo", () => {
  it("returns the active catalog roles from the repository", async () => {
    (listarRolesActivosEnTx as jest.Mock).mockResolvedValue([
      { id: 1, nombre: "Administrador" },
      { id: 2, nombre: "Operador" },
    ]);

    const result = await consultarRolesCatalogo(tx);

    expect(result).toEqual({
      ok: true,
      data: [
        { id: 1, nombre: "Administrador" },
        { id: 2, nombre: "Operador" },
      ],
    });
    expect(listarRolesActivosEnTx).toHaveBeenCalledWith(tx);
  });

  it("returns an empty catalog when there are no active roles", async () => {
    (listarRolesActivosEnTx as jest.Mock).mockResolvedValue([]);

    await expect(consultarRolesCatalogo(tx)).resolves.toEqual({ ok: true, data: [] });
  });
});
