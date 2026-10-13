/**
 * Version-plan seam (SEL-PLAN-03-A, auth-tenant-selector).
 *
 * ONE reserved invocation for the "(Version plan)" element: F1 renders a
 * STATIC "free" classification, so the function returns a typed constant. A
 * later Plan model grows THIS function's output per plan WITHOUT structural
 * change to call sites. Nothing inlines the string, and no Plan model/schema
 * is added to the system.
 */

export type PlanVersion = "free";

export function resolvePlanForVersion(): PlanVersion {
  return "free";
}
