import type { Metadata } from "next";

/**
 * Board 01 layout — F0 tokens only (LOG-04-A): surface + ink registry, no raw
 * palette classes, no dark-mode variants (F0 is light-only).
 */
export const metadata: Metadata = {
  title: "Iniciar sesión — SystemFact",
  description: "Accede a SystemFact con tu usuario.",
};

export default function LoginLayout({
  children,
}: {
  readonly children: React.ReactNode;
}) {
  return (
    <main className="flex min-h-full flex-1 flex-col items-center justify-center bg-surface-muted px-4 py-12">
      {children}
    </main>
  );
}
