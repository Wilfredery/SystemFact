/**
 * Customer estado de cuenta route (fase-6 PR-4, task 4.3 / R-C7). Server component
 * shell: resolves the tenant context, redirects to `/login` when absent, validates
 * the `clienteId` path segment as a positive integer and renders the client view.
 * The statement consumes ONLY the canonical derived-balance query and narrows it to
 * this customer (ADR-017) — no per-customer balance query, no cache. A foreign id
 * yields an empty statement (never a cross-tenant leak — the read is RLS-scoped).
 */

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { getCurrentTenantContext } from "@/modules/tenant/infrastructure/tenant-runtime";
import { EstadoDeCuentaScreen } from "@/modules/cobros/ui/EstadoDeCuentaScreen";

export default async function EstadoDeCuentaPage({
  params,
}: {
  readonly params: Promise<{ clienteId: string }>;
}) {
  const supabase = await createClient();
  const ctx = await getCurrentTenantContext(supabase);
  if (ctx === null) {
    redirect("/login");
  }

  const { clienteId: raw } = await params;
  const clienteId = Number.parseInt(raw, 10);
  if (!Number.isInteger(clienteId) || clienteId <= 0) {
    redirect("/cobros/cxc-board");
  }

  return (
    <main className="mx-auto w-full max-w-4xl px-6 py-10">
      <EstadoDeCuentaScreen clienteId={clienteId} />
    </main>
  );
}
