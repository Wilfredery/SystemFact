import * as syntheticEmail from "./synthetic-email";

describe("buildSyntheticEmail", () => {
  it("appends the internal suffix to the username", () => {
    expect(syntheticEmail.buildSyntheticEmail("jperez")).toBe(
      `jperez${syntheticEmail.SYNTHETIC_EMAIL_SUFFIX}`,
    );
  });

  // There is intentionally no decoder (v2r-01): identity resolves through the
  // immutable Auth `sub`, so nothing parses a username back out of the email.
  // Assert the specific hazard by NAME rather than freezing the whole export
  // surface, so a legitimate future export does not fail this test.
  it("exports no username decoder", () => {
    expect(syntheticEmail).not.toHaveProperty("decodeNombreUsuario");
    expect(Object.keys(syntheticEmail)).not.toContain("decodeNombreUsuario");
  });
});