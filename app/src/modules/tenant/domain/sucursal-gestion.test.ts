import {
  claveNombreSucursal,
  decidirEdicionSucursal,
  limpiarDatosSucursal,
  type DatosSucursal,
} from "./sucursal-gestion";

const actual: DatosSucursal = {
  nombre: "Sucursal Norte",
  direccion: "Calle 1",
  telefono: "8095550000",
};

describe("limpiarDatosSucursal", () => {
  it("trims the three fields", () => {
    expect(
      limpiarDatosSucursal({ nombre: "  A ", direccion: " B", telefono: "C  " }),
    ).toEqual({ nombre: "A", direccion: "B", telefono: "C" });
  });
});

describe("claveNombreSucursal (S5 identity: trimmed + case-insensitive)", () => {
  it("is equal for case and outer-space variants", () => {
    expect(claveNombreSucursal("  Sucursal NORTE ")).toBe(
      claveNombreSucursal("sucursal norte"),
    );
  });

  it("keeps different names apart and inner spaces significant", () => {
    expect(claveNombreSucursal("Norte")).not.toBe(claveNombreSucursal("Sur"));
    expect(claveNombreSucursal("Sur  Este")).not.toBe(claveNombreSucursal("Sur Este"));
  });
});

describe("decidirEdicionSucursal", () => {
  it("identical values = SIN_CAMBIO", () => {
    expect(decidirEdicionSucursal(actual, { ...actual })).toEqual({ tipo: "SIN_CAMBIO" });
  });

  it("values identical after trimming = SIN_CAMBIO", () => {
    expect(
      decidirEdicionSucursal(actual, {
        nombre: "  Sucursal Norte ",
        direccion: " Calle 1 ",
        telefono: "8095550000  ",
      }),
    ).toEqual({ tipo: "SIN_CAMBIO" });
  });

  it("a changed field is APLICAR with ONLY the changed fields before/after", () => {
    expect(
      decidirEdicionSucursal(actual, { ...actual, telefono: "8295551111" }),
    ).toEqual({
      tipo: "APLICAR",
      antes: { telefono: "8095550000" },
      despues: { telefono: "8295551111" },
      requiereVerificarNombre: false,
    });
  });

  it("a name change to another identity requires the duplicate probe", () => {
    const decision = decidirEdicionSucursal(actual, { ...actual, nombre: " Sucursal Sur " });
    expect(decision).toEqual({
      tipo: "APLICAR",
      antes: { nombre: "Sucursal Norte" },
      despues: { nombre: "Sucursal Sur" },
      requiereVerificarNombre: true,
    });
  });

  it("renaming to its own name with another case is a real change but needs no duplicate probe", () => {
    expect(
      decidirEdicionSucursal(actual, { ...actual, nombre: "SUCURSAL NORTE" }),
    ).toEqual({
      tipo: "APLICAR",
      antes: { nombre: "Sucursal Norte" },
      despues: { nombre: "SUCURSAL NORTE" },
      requiereVerificarNombre: false,
    });
  });

  it("several changed fields are all reported", () => {
    const decision = decidirEdicionSucursal(actual, {
      nombre: "Otra",
      direccion: "Calle 2",
      telefono: "8095550000",
    });
    expect(decision).toMatchObject({
      tipo: "APLICAR",
      antes: { nombre: "Sucursal Norte", direccion: "Calle 1" },
      despues: { nombre: "Otra", direccion: "Calle 2" },
    });
  });
});
