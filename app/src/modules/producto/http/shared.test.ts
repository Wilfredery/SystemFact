import {
  ROLES_GESTION_PRODUCTOS,
  ROLES_VER_PRODUCTOS,
} from "./shared";

describe("producto role groups", () => {
  it("Administrador, Operador and Despachador may view products", () => {
    expect([...ROLES_VER_PRODUCTOS].sort()).toEqual(
      ["Administrador", "Despachador", "Operador"].sort(),
    );
  });

  it("only Administrador manages products", () => {
    expect(ROLES_GESTION_PRODUCTOS).toEqual(["Administrador"]);
  });
});
