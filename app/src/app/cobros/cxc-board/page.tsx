/**
 * CxC board route (fase-6 PR-4, task 4.1 / R-C7). Server component shell: resolves
 * the tenant context from the Supabase session (the same `getCurrentTenantContext`
 * the actions use) and redirects to `/login` when there is none. The board itself is
 * a client island that consumes ONLY the canonical derived-balance query
 * (`consultarSaldoCxcAction`) — this shell fetches no balance data of its own, so
 * there is exactly one source of truth (ADR-017). The read/role gating lives in the
 * action (R-C6), not in the shell.
 */

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { getCurrentTenantContext } from "@/modules/tenant/infrastructure/tenant-runtime";
import { CxcBoardScreen } from "@/modules/cobros/ui/CxcBoardScreen";

export default async function CxcBoardPage() {
  const supabase = await createClient();
  const ctx = await getCurrentTenantContext(supabase);
  if (ctx === null) {
    redirect("/login");
  }

  return (
    <main className="mx-auto w-full max-w-4xl px-6 py-10">
      <h1 className="mb-1 text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
        Cuentas por cobrar
      </h1>
      <p className="mb-6 text-sm text-zinc-500 dark:text-zinc-400">
        Pendientes, parciales y en mora — saldo derivado de la consulta canónica única.
      </p>
      <CxcBoardScreen />
    </main>
  );
}
