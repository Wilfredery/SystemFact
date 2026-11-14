import { zCambiarEstadoUsuarioInput, zCambiarRolesUsuarioInput } from "./validations";

describe("zCambiarRolesUsuarioInput", () => {
  const ok = { usuarioId: 20, rolIds: [1, 2], versionEsperada: 3 };

  it("accepts a strict well-formed payload", () => {
    expect(zCambiarRolesUsuarioInput.safeParse(ok).success).toBe(true);
  });

  it.each([
    ["usuarioId 0", { ...ok, usuarioId: 0 }],
    ["usuarioId negative", { ...ok, usuarioId: -1 }],
    ["usuarioId float", { ...ok, usuarioId: 1.5 }],
    ["usuarioId string", { ...ok, usuarioId: "20" }],
    ["rolIds empty", { ...ok, rolIds: [] }],
    ["rolIds duplicated", { ...ok, rolIds: [1, 1] }],
    ["rolIds with 0", { ...ok, rolIds: [0] }],
    ["rolIds with float", { ...ok, rolIds: [1.2] }],
    ["rolIds not an array", { ...ok, rolIds: 1 }],
    ["version float", { ...ok, versionEsperada: 1.5 }],
    ["version 0", { ...ok, versionEsperada: 0 }],
    ["version string", { ...ok, versionEsperada: "3" }],
    ["missing version", { usuarioId: 20, rolIds: [1] }],
    ["unknown key (strict)", { ...ok, activo: false }],
  ])("rejects %s", (_n, payload) => {
    expect(zCambiarRolesUsuarioInput.safeParse(payload).success).toBe(false);
  });
});

describe("zCambiarEstadoUsuarioInput", () => {
  const ok = { usuarioId: 20, activo: false, versionEsperada: 3 };

  it("accepts a strict well-formed payload", () => {
    expect(zCambiarEstadoUsuarioInput.safeParse(ok).success).toBe(true);
    expect(zCambiarEstadoUsuarioInput.safeParse({ ...ok, activo: true }).success).toBe(true);
  });

  it.each([
    ["activo string 'false'", { ...ok, activo: "false" }],
    ["activo number", { ...ok, activo: 0 }],
    ["missing activo", { usuarioId: 20, versionEsperada: 3 }],
    ["usuarioId 0", { ...ok, usuarioId: 0 }],
    ["version float", { ...ok, versionEsperada: 2.5 }],
    ["unknown key (strict)", { ...ok, rolIds: [1] }],
  ])("rejects %s", (_n, payload) => {
    expect(zCambiarEstadoUsuarioInput.safeParse(payload).success).toBe(false);
  });
});
