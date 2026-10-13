/**
 * `/selector-empresa-sucursal` data loader (design D3/D5, SEL-ROUTE-01-A/B).
 *
 * Server-side guards BOTH ways — the board never leaks to the wrong actor:
 *   - no session (tenant header read resolves null) ⇒ redirect("/login");
 *   - `esAdmin === false` (despachador/cobrador, typed URL, stale link)
 *     ⇒ redirect("/dashboard") — server routing branch, NOT UI hiding.
 *
 * Exactly ONE `withTenantTransaction` is opened here (no nesting): the S1 use
 * case runs inside it and ONLY its plain data escapes. Zero client business
 * logic lives on this surface.
 */

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { withTenantTransaction } from "@/modules/tenant/infrastructure/withTenantTransaction";
import { getCurrentTenantHeader } from "@/modules/tenant/infrastructure/tenant-runtime";
import { listarSucursalesDeEmpresa } from "@/modules/tenant/application/listarSucursalesDeEmpresa";
import type { SucursalResumen } from "@/modules/tenant/infrastructure/repo-sucursal";

/** The plain data board 02 renders — ids/names only, no deep tenant data. */
export type SelectorSucursalData = {
  readonly empresaNombre: string;
  readonly sucursales: readonly SucursalResumen[];
  /** The CURRENT branch, preselected and marked on the options. */
  readonly sucursalActualId: number;
};

export async function loadSelectorData(): Promise<SelectorSucursalData> {
  const supabase = await createClient();
  // The (app) layout already guards; this re-check is defense in depth
  // (SEL-ROUTE-01-A) — a non-null `header read means a live session bound to
  // an active USUARIO row.
  const ctx = await getCurrentTenantHeader(supabase);
  if (ctx === null) {
    redirect("/login");
  }
  if (!ctx.esAdmin) {
    redirect("/dashboard");
  }

  const resultado = await withTenantTransaction(ctx, (tx) =>
    listarSucursalesDeEmpresa(ctx, tx),
  );
  if (!resultado.ok) {
    // Unreachable for an admin (deny code only fires for non-admins, already
    // redirected). Fails closed instead of rendering a stateless board.
    redirect("/dashboard");
  }

  return {
    empresaNombre: ctx.empresaNombre,
    sucursales: resultado.sucursales,
    sucursalActualId: ctx.sucursalId,
  };
}
