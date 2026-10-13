/**
 * POS page shell (fase 5b, PR-3). Server component: it resolves the tenant
 * context from the Supabase session — the SAME `getCurrentTenantContext` the
 * actions use — and redirects to `/login` when there is none. It passes the
 * `esAdmin` flag DOWN so the client picker can gate the discount panel; the
 * authoritative discount enforcement still lives in the use case (spec R-V8),
 * never in this shell.
 *
 * The Penpot `02-Venta` board gate (task 3.1) was evaluated board-agnostic:
 * no exported board spec exists in-repo, so this shell follows design §6
 * (four-column POS layout) without a pixel-level reference.
 */

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { getCurrentTenantContext } from "@/modules/tenant/infrastructure/tenant-runtime";
import { PosScreen } from "@/modules/venta/ui/PosScreen";

export default async function VentaPage() {
  const supabase = await createClient();
  const ctx = await getCurrentTenantContext(supabase);
  if (ctx === null) {
    redirect("/login");
  }

  return <PosScreen esAdmin={ctx.esAdmin} />;
}
