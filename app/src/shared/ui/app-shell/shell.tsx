/**
 * F0.4 — the server-rendered application shell (design D4.1).
 *
 * Every `(app)` page renders through this: the header always shows the
 * empresa + sucursal names (DOM invariant — never toggled off by scroll,
 * viewport size or role) plus the role-gated "Cambiar sucursal" affordance.
 * The admin verdict reaches the component as a plain prop already evaluated
 * on the server; NON-admins get ZERO markup (no `hidden`, no CSS-on) — see
 * the `{ctx.esAdmin && …}` server branch. No sucursal-switch mutation exists
 * in F0: the control is a reserved placeholder into F1's selector flow (D4.4).
 */

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
        {/* Server-only branch (D4.4): non-admins get NO node at all. */}
        {esAdmin && (
          <span
            data-testid="cambiar-sucursal"
            aria-disabled="true"
            title="Reservado — el selector de sucursal llega con F1"
            className="text-xs text-ink-muted"
          >
            Cambiar sucursal
          </span>
        )}
      </header>
      <div className="flex flex-1 flex-col md:flex-row">
        <SidebarNav items={NAV_ITEMS} />
        {children}
      </div>
    </div>
  );
}
