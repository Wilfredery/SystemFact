/**
 * The login-flow RLS exception — deliberately its own leaf module.
 *
 * Extracted from `tenant-runtime.ts` so the shared Auth identity resolver
 * (`auth/infrastructure/auth-identity.ts`) can call it without importing
 * `tenant-runtime`, which itself calls that resolver. Without this split the two
 * modules would import each other in a cycle. `tenant-runtime.ts` re-exports
 * `setLoginFlow`, so every existing call site is unaffected.
 */

import type { Prisma } from "@/generated/prisma/client";

/**
 * Activa la flag `app.is_login_flow` en la sesión Postgres de la transacción.
 *
 * This flag is read by the `usuario_select` RLS policy (migration
 * `20260902120000_enable_rls`) to allow the pre-tenant USUARIO lookup of the
 * auth path — it is the controlled exception to multi-tenant isolation
 * (ADR-019) that resolves the chicken-and-egg of authenticating before a
 * TenantCtx exists.
 *
 * SCOPE WARNING — SELECT ONLY:
 *   `usuario_select` honors this flag; `usuario_modify` deliberately does NOT.
 *   Any WRITE on USUARIO during the login flow must first pin
 *   `app.current_empresa_id` to the single resolved company (see
 *   `registrarAuditoriaSesion` and `enlazarAuthSub` in auth-service /
 *   auth-identity), otherwise RLS denies the statement. Widening
 *   `usuario_modify` with this flag would be a far larger hole than pinning one
 *   empresa GUC, which cannot reach another tenant.
 *
 * Solo debe usarse en:
 *   - resolución de identidad previa al tenant (`auth/infrastructure`).
 *   - Cualquier path que resuelva identidad antes de tener tenant.
 *
 * NO usar en queries de negocio. Toda Server Action de negocio debe llamar
 * `setTenantContext(tx, ctx)` con un ctx ya validado.
 */
export async function setLoginFlow(
  tx: Prisma.TransactionClient,
): Promise<void> {
  await tx.$executeRaw`SELECT set_config('app.is_login_flow', 'true', true)`;
}