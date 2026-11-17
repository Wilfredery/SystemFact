/**
 * Unit — the per-instance log budget for the CSP report endpoint
 * (odd/tasks/csp-reporting-and-bump-guard.md, Judgment Day advisory 1: per-request caps alone
 * let a repeated small POST grow log volume without bound).
 *
 * The contract under test:
 *   - the first MAX_LOGS_PER_WINDOW accepts inside one window are granted;
 *   - accept MAX_LOGS_PER_WINDOW + 1 inside the window is refused;
 *   - after LOG_WINDOW_MS the window slides and accepts resume;
 *   - refusals never throw and never touch the budget beyond the prune.
 */

import {
  LOG_WINDOW_MS,
  MAX_LOGS_PER_WINDOW,
  shouldLogViolationNow,
} from "@/lib/security/csp-report";

describe("shouldLogViolationNow (per-instance log budget)", () => {
  it("grants the first MAX_LOGS_PER_WINDOW accepts inside one window", () => {
    const start = 1_000_000;
    const granted = Array.from({ length: MAX_LOGS_PER_WINDOW }, (_, i) =>
      shouldLogViolationNow(start + i),
    );
    expect(granted.every(Boolean)).toBe(true);
  });

  it("refuses once the window budget is exhausted, then grants again after LOG_WINDOW_MS", () => {
    const start = 2_000_000;
    for (let i = 0; i < MAX_LOGS_PER_WINDOW; i += 1) {
      expect(shouldLogViolationNow(start + i)).toBe(true);
    }
    expect(shouldLogViolationNow(start + MAX_LOGS_PER_WINDOW)).toBe(false);
    // Sliding window: the oldest accepted line ages out, budget returns.
    expect(shouldLogViolationNow(start + LOG_WINDOW_MS + 1)).toBe(true);
  });

  it("keeps working across many refusals (no state poisoning, no throw)", () => {
    const start = 3_000_000;
    for (let i = 0; i < MAX_LOGS_PER_WINDOW; i += 1) shouldLogViolationNow(start + i);
    for (let i = 0; i < 100; i += 1) {
      expect(() => shouldLogViolationNow(start + MAX_LOGS_PER_WINDOW + i)).not.toThrow();
      expect(shouldLogViolationNow(start + MAX_LOGS_PER_WINDOW + i)).toBe(false);
    }
  });
});
