import {
  ROLES_GESTION_INVENTARIO,
  ROLES_VER_INVENTARIO,
} from "./shared";

describe("inventario role groups", () => {
  it("Administrador, Operador and Despachador may view inventory", () => {
    expect([...ROLES_VER_INVENTARIO].sort()).toEqual(
      ["Administrador", "Despachador", "Operador"].sort(),
    );
  });

  it("only Administrador manages inventory", () => {
    expect(ROLES_GESTION_INVENTARIO).toEqual(["Administrador"]);
  });
});
