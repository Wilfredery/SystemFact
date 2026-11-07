import type { Metadata } from "next";
import { connection } from "next/server";

/**
 * Board 01 layout — F0 tokens only (LOG-04-A): surface + ink registry, no raw
 * palette classes, no dark-mode variants (F0 is light-only).
 *
 * `connection()` opts /login into per-request rendering: Next can only stamp the
 * CSP nonce on its inline scripts while it renders a request, and a prerendered
 * page has none (docs/22 T1 stage 2, odd/tasks/csp-nonce.md trap 4).
 */
export const metadata: Metadata = {
  title: "Iniciar sesión — SystemFact",
  description: "Accede a SystemFact con tu usuario.",
};

export default async function LoginLayout({
  children,
}: {
  readonly children: React.ReactNode;
}) {
  await connection();
  return (
    <main className="flex min-h-full flex-1 flex-col items-center justify-center bg-surface-muted px-4 py-12">
      {children}
    </main>
  );
}
