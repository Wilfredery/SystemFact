/**
 * Printable fiscal-invoice route (factura-print.md T2). Server component shell
 * mirroring the receipt-reprint page: resolves the tenant context, redirects to
 * `/login` when absent, validates the `facturaId` path segment as a positive
 * integer and renders the print island. All data fetching and role/tenant
 * gating happen inside `consultarFacturaParaImpresionAction`; a missing/foreign
 * invoice surfaces `FACTURA_NO_ENCONTRADA` in the island's typed error state.
 */

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { getCurrentTenantContext } from "@/modules/tenant/infrastructure/tenant-runtime";
import { FacturaPrintScreen } from "@/modules/venta/ui/FacturaPrintScreen";

export default async function FacturaPrintPage({
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
  const facturaId = Number.parseInt(raw, 10);
  if (!Number.isInteger(facturaId) || facturaId <= 0) {
    redirect("/venta");
  }

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-10">
      <FacturaPrintScreen facturaId={facturaId} />
    </main>
  );
}
