import {
  decodeNombreUsuario,
  InvalidSyntheticEmailError,
} from "./synthetic-email";

describe("decodeNombreUsuario", () => {
  it("rejects a synthetic email with an empty username", () => {
    expect(() =>
      decodeNombreUsuario("@users.systemfact.internal"),
    ).toThrow(InvalidSyntheticEmailError);
  });
});
