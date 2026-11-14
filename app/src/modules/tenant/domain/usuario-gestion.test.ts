import {
  TEN_AUTO_PROTECCION,
  TEN_ROL_NO_VALIDO,
  TEN_ULTIMO_ADMINISTRADOR,
} from "./errors";
import {
  decidirCambioEstado,
  decidirCambioRoles,
  esAdministradorActivo,
  mismoConjuntoDeIds,
  validarConjuntoRoles,
  type RolCatalogo,
} from "./usuario-gestion";

const ADMIN: RolCatalogo = { id: 1, nombre: "Administrador" };
const OPER: RolCatalogo = { id: 2, nombre: "Operador" };
const DESP: RolCatalogo = { id: 3, nombre: "Despachador" };
const GRUPO = ["Administrador"];

describe("validarConjuntoRoles (S4)", () => {
  const catalogo = [ADMIN, OPER];
  it("accepts a non-empty unique list fully inside the active catalog", () => {
    expect(validarConjuntoRoles([1, 2], catalogo)).toBe(true);
  });
  it("rejects an empty list", () => {
    expect(validarConjuntoRoles([], catalogo)).toBe(false);
  });
  it("rejects duplicates", () => {
    expect(validarConjuntoRoles([2, 2], catalogo)).toBe(false);
  });
  it("rejects an id that is not in the active catalog (unknown or inactive)", () => {
    expect(validarConjuntoRoles([1, 99], catalogo)).toBe(false);
  });
});

describe("mismoConjuntoDeIds", () => {
  it("ignores order", () => {
    expect(mismoConjuntoDeIds([1, 2], [2, 1])).toBe(true);
  });
  it("detects different content and different size", () => {
    expect(mismoConjuntoDeIds([1], [2])).toBe(false);
    expect(mismoConjuntoDeIds([1], [1, 2])).toBe(false);
  });
});

describe("decidirCambioRoles", () => {
  const base = {
    actorId: 10,
    objetivoId: 20,
    objetivoActivo: true,
    rolesActuales: [OPER],
    rolesNuevos: [OPER, DESP],
    rolesAdministrador: GRUPO,
    administradoresActivos: 2,
  };

  it("same set => SIN_CAMBIO (idempotent no-op, S4)", () => {
    expect(
      decidirCambioRoles({ ...base, rolesNuevos: [OPER] }),
    ).toEqual({ tipo: "SIN_CAMBIO" });
  });

  it("different set => APLICAR", () => {
    expect(decidirCambioRoles(base)).toEqual({ tipo: "APLICAR" });
  });

  it("self-demotion (actor removes own Administrador) => TEN_AUTO_PROTECCION (S7a)", () => {
    expect(
      decidirCambioRoles({
        ...base,
        objetivoId: 10,
        rolesActuales: [ADMIN],
        rolesNuevos: [OPER],
      }),
    ).toEqual({ tipo: "RECHAZAR", code: TEN_AUTO_PROTECCION });
  });

  it("self keeping Administrador while adding a role is allowed", () => {
    expect(
      decidirCambioRoles({
        ...base,
        objetivoId: 10,
        rolesActuales: [ADMIN],
        rolesNuevos: [ADMIN, OPER],
      }),
    ).toEqual({ tipo: "APLICAR" });
  });

  it("demoting the LAST active Administrador => TEN_ULTIMO_ADMINISTRADOR (S7b)", () => {
    expect(
      decidirCambioRoles({
        ...base,
        rolesActuales: [ADMIN],
        rolesNuevos: [OPER],
        administradoresActivos: 1,
      }),
    ).toEqual({ tipo: "RECHAZAR", code: TEN_ULTIMO_ADMINISTRADOR });
  });

  it("demoting an Administrador when another remains => APLICAR", () => {
    expect(
      decidirCambioRoles({
        ...base,
        rolesActuales: [ADMIN],
        rolesNuevos: [OPER],
        administradoresActivos: 2,
      }),
    ).toEqual({ tipo: "APLICAR" });
  });

  it("an INACTIVE Administrador target is not counted: removing the role never trips S7b", () => {
    expect(
      decidirCambioRoles({
        ...base,
        objetivoActivo: false,
        rolesActuales: [ADMIN],
        rolesNuevos: [OPER],
        administradoresActivos: 1,
      }),
    ).toEqual({ tipo: "APLICAR" });
  });
});

describe("decidirCambioEstado", () => {
  const base = {
    actorId: 10,
    objetivoId: 20,
    objetivoActivo: true,
    activoNuevo: false,
    objetivoEsAdministrador: false,
    administradoresActivos: 2,
  };

  it("same state => SIN_CAMBIO (S5 idempotent)", () => {
    expect(decidirCambioEstado({ ...base, activoNuevo: true })).toEqual({
      tipo: "SIN_CAMBIO",
    });
    expect(
      decidirCambioEstado({ ...base, objetivoActivo: false, activoNuevo: false }),
    ).toEqual({ tipo: "SIN_CAMBIO" });
  });

  it("deactivating another user => APLICAR; reactivating => APLICAR", () => {
    expect(decidirCambioEstado(base)).toEqual({ tipo: "APLICAR" });
    expect(
      decidirCambioEstado({ ...base, objetivoActivo: false, activoNuevo: true }),
    ).toEqual({ tipo: "APLICAR" });
  });

  it("self-deactivation => TEN_AUTO_PROTECCION (S7a)", () => {
    expect(decidirCambioEstado({ ...base, objetivoId: 10 })).toEqual({
      tipo: "RECHAZAR",
      code: TEN_AUTO_PROTECCION,
    });
  });

  it("deactivating the LAST active Administrador => TEN_ULTIMO_ADMINISTRADOR (S7b)", () => {
    expect(
      decidirCambioEstado({
        ...base,
        objetivoEsAdministrador: true,
        administradoresActivos: 1,
      }),
    ).toEqual({ tipo: "RECHAZAR", code: TEN_ULTIMO_ADMINISTRADOR });
  });

  it("deactivating an Administrador when another remains => APLICAR", () => {
    expect(
      decidirCambioEstado({
        ...base,
        objetivoEsAdministrador: true,
        administradoresActivos: 2,
      }),
    ).toEqual({ tipo: "APLICAR" });
  });
});

describe("TEN_ROL_NO_VALIDO is a catalog code", () => {
  it("is stable", () => {
    expect(TEN_ROL_NO_VALIDO).toBe("TEN_ROL_NO_VALIDO");
  });
});

describe("esAdministradorActivo", () => {
  it("needs active AND a role of the group", () => {
    expect(esAdministradorActivo({ activo: true, roles: [ADMIN, OPER] }, GRUPO)).toBe(true);
    expect(esAdministradorActivo({ activo: false, roles: [ADMIN] }, GRUPO)).toBe(false);
    expect(esAdministradorActivo({ activo: true, roles: [OPER] }, GRUPO)).toBe(false);
  });
});
