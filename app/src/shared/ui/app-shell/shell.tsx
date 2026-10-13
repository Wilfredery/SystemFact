/**
 * F0.4 — the server-rendered application shell (design D4.1).
 *
 * Every `(app)` page renders through this: the header always shows the
 * empresa + sucursal names (DOM invariant — never toggled off by scroll,
 * viewport size or role) plus the role-gated "Cambiar sucursal" affordance.
 * The admin verdict reaches the component as a plain prop already evaluated
 * on the server; NON-admins get ZERO markup (no `hidden`, no CSS-on) — see
 * the `{ctx.esAdmin && …}` server branch (F1: SEL-SLOT-05-B).
 * F1 (“auth-tenant-selector”, D6): the reserved placeholder is now the REAL
 * trigger into the selector flow — a plain `next/link` like the other nav
 * destinations (hitbox ≥44px via h-11), not `aria-disabled`.
 */

import Link from "next/link";
import { SidebarNav, type SidebarItemDef } from "./sidebar";

const NAV_ITEMS: readonly SidebarItemDef[] = [
  { label: "Dashboard", href: "/dashboard" },
  // The eight ratified modules in order (app-shell spec).
  { label: "Venta", href: "/venta" },
  { label: "Cobros", href: "/cobros" },
  { label: "Inventario", disabled: true },
  { label: "Compras", disabled: true },
  { label: "Caja", disabled: true },
  { label: "Reportes", href: "/reportes" },
  { label: "Administración", disabled: true },
  { label: "Auditoría", href: "/auditoria" },
];

export function AuthShell({
  empresaNombre,
  sucursalNombre,
  esAdmin,
  children,
}: {
  readonly empresaNombre: string;
  readonly sucursalNombre: string;
  readonly esAdmin: boolean;
  readonly children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-full flex-col">
      <header
        data-testid="app-shell-header"
        className="flex items-center justify-between gap-3 border-b border-line bg-surface px-4 py-2"
      >
        <p className="text-sm font-medium text-ink">
          {empresaNombre} · Sucursal {sucursalNombre}
        </p>
        {/* Server-only branch (SEL-SLOT-05): non-admins get NO node at all. */}
        {esAdmin && (
          <Link
            href="/selector-empresa-sucursal"
            data-testid="cambiar-sucursal"
            className="flex h-11 items-center rounded-lg px-3 text-sm font-medium text-ink transition-colors hover:bg-surface-muted"
          >
            Cambiar sucursal
          </Link>
        )}
      </header>
      <div className="flex flex-1 flex-col md:flex-row">
        <SidebarNav items={NAV_ITEMS} />
        {children}
      </div>
    </div>
  );
}
