/**
 * F0.4 — the `(app)` route-group layout: the ONLY entry doing auth reads
 * (design D4.1). Same seam every existing page uses — server `createClient()`
 * → tenant resolution → `redirect("/login")` on null — but reading the
 * header-enriched F0.4 variant so the shell receives names + esAdmin; the
 * pages below keep their current context behavior untouched.
 */

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { getCurrentTenantHeader } from "@/modules/tenant/infrastructure/tenant-runtime";
import { AuthShell } from "@/shared/ui/app-shell/shell";

export default async function GroupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const ctx = await getCurrentTenantHeader(supabase);
  if (ctx === null) {
    redirect("/login");
  }

  return (
    <AuthShell
      empresaNombre={ctx.empresaNombre}
      sucursalNombre={ctx.sucursalNombre}
      esAdmin={ctx.esAdmin}
    >
      {children}
    </AuthShell>
  );
}
