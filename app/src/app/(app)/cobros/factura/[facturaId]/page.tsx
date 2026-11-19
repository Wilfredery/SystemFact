/**
 * Per-invoice CxC detail route (board-03 S13, wireframe `03-Cobros-Detalle`).
 *
 * Server component shell: resolves the tenant context from the Supabase session
 * (the same `getCurrentTenantContext` the actions use) and redirects to `/login`
 * when there is none, then validates the `facturaId` path segment as a POSITIVE
 * integer — anything else (0, negative, fractional, garbage) redirects to the
 * collections board instead of reaching a read.
 *
 * Authorization is NOT re-implemented here: the screen consumes
 * `obtenerDetalleCxcAction`, which enforces the cobros role gate server-side
 * (`ROLES_COBROS` — Administrador/Operador/Cobrador per S9; a Despachador is
 * denied) inside `withTenantTransaction`, exactly like the board and the customer
 * statement. Hiding this route is never the control.
 */

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { getCurrentTenantContext } from "@/modules/tenant/infrastructure/tenant-runtime";
import { DetalleFacturaScreen } from "@/modules/cobros/ui/DetalleFacturaScreen";

export default async function DetalleFacturaPage({
  params,
}: {
  readonly params: Promise<{ facturaId: string }>;
}) {
  const supabase = await createClient();
  const ctx = await getCurrentTenantContext(supabase);
  if (ctx === null) {
    redirect("/login");
  }

  const { facturaId: raw } = await params;
  // Strict digits only: `12abc` must not parse as 12 (JD-A remediation).
  const facturaId = /^\d+$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isInteger(facturaId) || facturaId <= 0) {
    redirect("/cobros/cxc-board");
  }

  return (
    <main className="mx-auto w-full max-w-4xl px-6 py-10">
      <DetalleFacturaScreen facturaId={facturaId} />
    </main>
  );
}
