import { resolvePlanForVersion } from "./version-plan";

describe("resolvePlanForVersion (SEL-PLAN-03-A)", () => {
  it("returns the static 'free' classification as a typed constant", () => {
    expect(resolvePlanForVersion()).toBe("free");
  });

  it("is stable across invocations (no per-call branching yet)", () => {
    expect(resolvePlanForVersion()).toBe(resolvePlanForVersion());
  });
});
