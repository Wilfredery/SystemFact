/**
 * Auditoria application — the shared audit WRITE PORT (AU-1, design.md).
 *
 * This is the ONLY public seam other modules may depend on to append an audit
 * event. Cobros and auth receive the port; they never import the `infrastructure`
 * repository or the generated Prisma enum. That keeps ADR-013 module boundaries
 * intact: one module's private adapter is not another module's dependency.
 *
 * `AuditoriaWritePort` is the abstract contract (the classic dependency-inversion
 * "port"); `registrarEventoAuditoriaEnTx` is the concrete transaction-scoped
 * implementation (the "adapter"), re-exported here so in-tree callers use the
 * canonical implementation directly the same way they use any use-case function.
 * It runs inside the CALLER's transaction (never opens its own), so the audit row
 * commits or rolls back atomically with the effect it records.
 */

import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type {
  AuditoriaTenantAnchor,
  AuditoriaWriteEvent,
} from "../domain/auditoria";
import { registrarEventoAuditoriaEnTx } from "../infrastructure/registrar-evento.repository";

export type { AuditoriaTenantAnchor, AuditoriaWriteEvent } from "../domain/auditoria";
export { registrarEventoAuditoriaEnTx };

/**
 * The append-only write contract: append exactly one audit row inside the
 * caller's transaction. Failure must propagate (rolling back the owning tx), never
 * be swallowed — so implementations are free of defensive try/catch.
 *
 * `ctx` is deliberately the narrower {@link AuditoriaTenantAnchor}, not the full
 * `TenantCtx`: the branch-scoped cobros path passes its ctx unchanged (structurally
 * assignable), while the auth LOGIN/LOGOUT path — which has no `TenantCtx` — passes
 * a bare company/user anchor and forces `sucursalId: null` per event.
 */
export interface AuditoriaWritePort {
  (tx: PrismaTx, ctx: AuditoriaTenantAnchor, event: AuditoriaWriteEvent): Promise<void>;
}

/**
 * The canonical port instance. Typed against the contract so the compiler proves
 * the adapter conforms; callers that prefer a value-level port over importing the
 * free function use this identical implementation.
 */
export const auditoriaWritePort: AuditoriaWritePort = registrarEventoAuditoriaEnTx;
