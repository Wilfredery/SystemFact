/**
 * CSP violation watcher for the production smoke (odd/tasks/csp-nonce.md S4/S5).
 *
 * The app ships the ENFORCING `Content-Security-Policy`: the browser blocks what
 * the policy forbids, but a blocked resource does not fail a page on its own
 * (the page just renders broken): this watcher is what turns "the browser
 * blocked something" into a red smoke. It listens for the DOM
 * `securitypolicyviolation` event in every document of the page (an init script
 * survives navigations; the binding keeps the findings on the Node side).
 *
 * Findings keep directive + blocked/source HOST only — never a full URL, query
 * string, cookie or token: this lane logs into live production.
 */

import { expect, type Page } from "@playwright/test";

type RawViolation = {
  violatedDirective: string;
  blockedURI: string;
  sourceFile: string;
};

export type CspViolation = {
  directive: string;
  blocked: string;
  source: string;
};

const BINDING = "__reportCspViolation";

/** `https://host/path?q=1` -> `host`; keywords like `inline`/`eval` pass through. */
function hostOnly(uri: string): string {
  if (!uri) return "(none)";
  try {
    return new URL(uri).host || new URL(uri).protocol;
  } catch {
    return uri;
  }
}

/** Call BEFORE the first navigation. Returns the live list of violations. */
export async function watchCspViolations(page: Page): Promise<CspViolation[]> {
  const violations: CspViolation[] = [];
  await page.exposeFunction(BINDING, (raw: RawViolation) => {
    violations.push({
      directive: raw.violatedDirective,
      blocked: hostOnly(raw.blockedURI),
      source: hostOnly(raw.sourceFile),
    });
  });
  await page.addInitScript((binding) => {
    document.addEventListener("securitypolicyviolation", (event) => {
      (window as unknown as Record<string, (v: RawViolation) => void>)[binding]({
        violatedDirective: event.violatedDirective,
        blockedURI: event.blockedURI,
        sourceFile: event.sourceFile,
      });
    });
  }, BINDING);
  return violations;
}

/** Fails with a message that lists directives and hosts only. */
export function expectNoCspViolations(violations: CspViolation[], where: string): void {
  const summary = violations
    .map((v) => `${v.directive} (blocked: ${v.blocked}, source: ${v.source})`)
    .join("; ");
  expect(
    violations,
    `${where} reported ${violations.length} CSP violation(s): ${summary}`,
  ).toEqual([]);
}
