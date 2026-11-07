/**
 * CSP violation watcher for the local E2E lane (odd/tasks/csp-nonce.md S5/S7).
 *
 * Same approach as `e2e-prod/csp-violations.ts` (the lanes do not import from
 * each other): it listens for the DOM `securitypolicyviolation` event in every
 * document of the page. An init script survives navigations; the binding keeps
 * the findings on the Node side. It works the same whether the policy is
 * report-only or enforcing, because the event fires in both modes.
 *
 * Findings keep directive + blocked/source HOST only — never a full URL, query
 * string, cookie or token.
 */

import type { Page } from "@playwright/test";

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

/** One line per violation: directive, blocked host and source host only. */
export function describeViolation(v: CspViolation): string {
  return `${v.directive} (blocked: ${v.blocked}, source: ${v.source})`;
}
