import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Iniciar sesión — SystemFact",
  description: "Accede a SystemFact con tu usuario.",
};

export default function LoginLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <main className="flex min-h-full flex-1 flex-col items-center justify-center bg-zinc-50 px-4 py-12 dark:bg-zinc-950">
      {children}
    </main>
  );
}
