/**
 * `normalizarAuthSub` — the fail-closed gate in front of every identity query
 * (audit finding v2r-01).
 *
 * The security property under test is not "parses a UUID", it is that the function
 * can NEVER return a value Postgres would reject, and never throws: one honest
 * "no usable identity" answer (`null`) instead of two different failure modes (a
 * `null` and an opaque 500 from a bad `uuid` cast on the request path).
 */
import { normalizarAuthSub } from "@/modules/auth/domain/auth-sub";

// A real Supabase Auth v4 `sub`.
const SUB = "9f8a7b6c-5d4e-4f3a-8b2c-1d0e9f8a7b6c";

describe("normalizarAuthSub", () => {
  it("returns a canonical v4 sub unchanged", () => {
    expect(normalizarAuthSub(SUB)).toBe(SUB);
  });

  it("lower-cases an upper-case claim (Supabase issues lowercase)", () => {
    expect(normalizarAuthSub(SUB.toUpperCase())).toBe(SUB);
  });

  it("trims surrounding whitespace", () => {
    expect(normalizarAuthSub(`  ${SUB}\n`)).toBe(SUB);
  });

  it("returns null for null/undefined instead of throwing", () => {
    expect(normalizarAuthSub(null)).toBeNull();
    expect(normalizarAuthSub(undefined)).toBeNull();
  });

  it("returns null for a blank or whitespace-only claim", () => {
    expect(normalizarAuthSub("")).toBeNull();
    expect(normalizarAuthSub("   ")).toBeNull();
  });

  it.each([
    ["not a uuid at all", "admin"],
    ["missing a hyphen group", "9f8a7b6c5d4e4f3a8b2c1d0e9f8a7b6c"],
    ["too short", "9f8a7b6c-5d4e-4f3a-8b2c-1d0e9f8a7b6"],
    ["too long", "9f8a7b6c-5d4e-4f3a-8b2c-1d0e9f8a7b6cd"],
    ["non-hex character", "9f8a7b6c-5d4e-4f3a-8b2c-1d0e9f8a7b6z"],
    ["leading garbage", `x${SUB}`],
    ["trailing garbage", `${SUB}x`],
  ])("rejects %s", (_label, value) => {
    expect(normalizarAuthSub(value)).toBeNull();
  });

  it.each([
    ["a missing claim", null],
    ["an absent claim", undefined],
    ["an empty claim", ""],
    ["a whitespace-only claim", "   "],
  ])("never returns a value that could become a lookup: %s", (_label, value) => {
    // The production hazard this pins: whatever comes back must be null, so it
    // can never reach `authUserId = ''` (a lookup) instead of short-circuiting.
    // Asserting `not.toBe("")` would pass on `undefined`/`0`/`false`.
    const result = normalizarAuthSub(value);
    expect(result).toBeNull();
    expect(result === "" || result === undefined).toBe(false);
  });
});
