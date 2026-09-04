/**
 * Tenant-scoped Prisma transaction wrapper.
 *
 * Mandatory entry point for every Server Action that touches the database.
 * Opens a Prisma transaction, sets the RLS GUCs as the FIRST statements with
 * `set_config(..., true)`, and delegates to the callback.
 *
 * Runtime prerequisites (see `tools/scripts/verify-rls.ts`):
 * - Pool mode MUST be transaction-mode (`pgbouncer=true` or Supavisor port 6543).
 * - DB role MUST NOT be BYPASSRLS and MUST NOT own tenant tables.
 * - Nested calls are rejected with {@link NestedTenantTransactionError}.
 *
 * @throws NestedTenantTransactionError on nested calls.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { prisma } from "@/lib/prisma";
import type { PrismaClient } from "@/generated/prisma/client";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import { setTenantContext } from "@/modules/tenant/infrastructure/tenant-runtime";

export interface WithTenantTransactionOptions {
  readonly timeoutMs?: number;
}

export type PrismaTx = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

export class NestedTenantTransactionError extends Error {
  constructor() {
    super(
      "Nested withTenantTransaction call detected. " +
        "Prisma interactive transactions cannot nest; compose callbacks instead.",
    );
    this.name = "NestedTenantTransactionError";
  }
}

const tenantTxStore = new AsyncLocalStorage<{ readonly inTx: true }>();

export async function withTenantTransaction<T>(
  ctx: TenantCtx,
  fn: (tx: PrismaTx) => Promise<T>,
  options?: WithTenantTransactionOptions,
): Promise<T> {
  if (tenantTxStore.getStore() !== undefined) {
    throw new NestedTenantTransactionError();
  }

  return tenantTxStore.run({ inTx: true }, async () =>
    prisma.$transaction(
      async (tx) => {
        await setTenantContext(tx, ctx);
        return fn(tx as PrismaTx);
      },
      {
        timeout: options?.timeoutMs ?? 10_000,
        isolationLevel: "ReadCommitted",
      },
    ),
  );
}
