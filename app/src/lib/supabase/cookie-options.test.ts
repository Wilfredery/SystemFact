import { withSecureOnHttps } from "./cookie-options";

describe("withSecureOnHttps", () => {
  it("forces secure when the forwarded protocol is https", () => {
    expect(withSecureOnHttps({ path: "/" }, "https").secure).toBe(true);
  });

  it("does not force secure over plain http", () => {
    expect(withSecureOnHttps({ path: "/" }, "http")).toEqual({ path: "/" });
  });

  it.each([null, undefined, ""])(
    "does not force secure when the protocol is %p",
    (proto) => {
      expect(withSecureOnHttps({ path: "/" }, proto)).toEqual({ path: "/" });
    },
  );

  it("uses the first token of a proxy chain", () => {
    expect(withSecureOnHttps({}, "https,http").secure).toBe(true);
    expect(withSecureOnHttps({}, "http, https").secure).toBeUndefined();
  });

  it("is case-insensitive and trims whitespace", () => {
    expect(withSecureOnHttps({}, "HTTPS").secure).toBe(true);
    expect(withSecureOnHttps({}, "  Https  ").secure).toBe(true);
  });

  it("keeps an already secure option and never downgrades it", () => {
    expect(withSecureOnHttps({ secure: true }, "http").secure).toBe(true);
    expect(withSecureOnHttps({ secure: true }, null).secure).toBe(true);
  });

  it("passes every other option through untouched", () => {
    const expires = new Date("2026-11-07T00:00:00Z");
    const options = {
      path: "/",
      sameSite: "lax" as const,
      httpOnly: false,
      maxAge: 3600,
      expires,
      domain: "systemfact.vercel.app",
    };

    expect(withSecureOnHttps(options, "https")).toEqual({
      ...options,
      secure: true,
    });
  });

  it("does not mutate the input", () => {
    const options = { path: "/", httpOnly: false };

    const result = withSecureOnHttps(options, "https");

    expect(result).not.toBe(options);
    expect(options).toEqual({ path: "/", httpOnly: false });
  });
});
