/**
 * Shared E2E login (design D8, task 5.2).
 *
 * Body moved verbatim from the fase-5c/5d/6 specs: the access identifier is
 * `nombreUsuario` (ADR-014 — email is never a credential) and the landing
 * tolerance accepts EITHER /dashboard or /selector-empresa-sucursal because a
 * multi-branch admin lands on the selector (auth-tenant-selector, design D2).
 */

import type { Page } from "@playwright/test";

export type LoginUser = { user: string; password: string };

export async function login(page: Page, creds: LoginUser): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Usuario").fill(creds.user);
  await page.getByLabel("Contraseña").fill(creds.password);
  await page.getByRole("button", { name: "Ingresar" }).click();
  // LANDING AUDIT (auth-tenant-selector, design D2): a multi-branch admin now
  // lands on /selector-empresa-sucursal; a single-branch admin (current E2E seed,
  // single branch) keeps /dashboard. Accept EITHER so the helper pins no wrong landing.
  await page.waitForURL(/\/(dashboard|selector-empresa-sucursal)/, { timeout: 20_000 });
}
