"use client";

/**
 * F0.4 — the ONLY sanctioned nav island (spec: shell stays a server
 * component). Its sole import is `usePathname`: it computes the active
 * highlight and nothing else — no fetch, no mutation, no business logic, no
 * role/admin knowledge. Reserved modules stay inert `<span>` rows with
 * `aria-disabled` (no fake routes created).
 */

import Link from "next/link";
import { usePathname } from "next/navigation";

export type SidebarItemProps = {
  readonly label: string;
  /** Real link target; when absent the row is a reserved placeholder. */
  readonly href?: string;
  /** Reserved for future modules — renders an inert non-link row. */
  readonly disabled?: boolean;
};

export function SidebarItem({ label, href, disabled = false }: SidebarItemProps) {
  const pathname = usePathname();

  if (disabled || href === undefined) {
    return (
      <span
        aria-disabled="true"
        title="Reservado para fases futuras"
        className="block rounded-lg px-3 py-2 text-sm text-ink-muted"
      >
        {label}
      </span>
    );
  }

  const activo = pathname === href || pathname.startsWith(href + "/");

  return (
    <Link
      href={href}
      aria-current={activo ? "page" : undefined}
      className={`block rounded-lg px-3 py-2 text-sm ${
        activo
          ? "bg-surface-raised font-semibold text-ink"
          : "text-ink-muted hover:bg-surface-raised hover:text-ink"
      }`}
    >
      {label}
    </Link>
  );
}
