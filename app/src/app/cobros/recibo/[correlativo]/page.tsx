/**
 * Receipt reprint route (fase-6 PR-4, task 4.4 / R-C4). Server component shell:
 * resolves the tenant context, redirects to `/login` when absent, validates the
 * `correlativo` path segment as a positive integer and renders the printable
 * non-fiscal receipt island. The data fetch and role/tenant gating happen in
 * `consultarReciboAction`; a missing/foreign number surfaces `PAGO_NO_ENCONTRADO`.
 */

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { getCurrentTenantContext } from "@/modules/tenant/infrastructure/tenant-runtime";
import { ReciboReprintScreen } from "@/modules/cobros/ui/ReciboReprintScreen";

export default async function ReciboReprintPage({
  params,
}: {
  readonly params: Promise<{ correlativo: string }>;
}) {
  const supabase = await createClient();
  const ctx = await getCurrentTenantContext(supabase);
  if (ctx === null) {
    redirect("/login");
  }

  const { correlativo: raw } = await params;
  const correlativo = Number.parseInt(raw, 10);
  if (!Number.isInteger(correlativo) || correlativo <= 0) {
    redirect("/cobros/cxc-board");
  }

  return (
    <main className="mx-auto w-full max-w-4xl px-6 py-10">
      <ReciboReprintScreen correlativo={correlativo} />
    </main>
  );
}
