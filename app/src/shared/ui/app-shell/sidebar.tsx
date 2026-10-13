/**
 * F0.4 — sidebar navigation (Server Component, design D4.4). Maps the shell's
 * ratified items to one "use client" island per row (only the pathname read
 * is client-side); the island receives NO `esAdmin`/role prop and cannot
 * recompute one (spec: "Role verdict lives server-side only").
 */

import { SidebarItem, type SidebarItemProps } from "./SidebarItem";

export type SidebarItemDef = SidebarItemProps;

export function SidebarNav({
  items,
}: {
  readonly items: readonly SidebarItemDef[];
}) {
  return (
    <nav
      aria-label="Navegación principal"
      className="flex flex-col gap-2 border-b border-line bg-surface-muted p-3 md:min-w-48 md:border-b-0 md:border-r"
    >
      <ul className="flex flex-col gap-2">
        {items.map((item) => (
          <li key={item.label}>
            {/* Layout gap rhythm: rows stack at the 8px token (`gap-2`). */}
            <SidebarItem label={item.label} href={item.href} disabled={item.disabled} />
          </li>
        ))}
      </ul>
    </nav>
  );
}
