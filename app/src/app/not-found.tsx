import Link from "next/link";
import { connection } from "next/server";

/**
 * Branded 404. `connection()` opts the page into per-request rendering: Next can only stamp the
 * CSP nonce on its inline scripts while it renders a request, and a prerendered page has none
 * (the default 404 logged CSP script violations; odd/tasks/csp-nonce.md trap 4, same fix as /login).
 */
export default async function NotFound() {
  await connection();
  return (
    <main className="flex min-h-full flex-1 flex-col items-center justify-center gap-4 bg-surface-muted px-4 py-12 text-center">
      <p className="text-sm font-medium text-ink-muted">Error 404</p>
      <h1 className="text-2xl font-bold text-ink">Página no encontrada</h1>
      <p className="max-w-md text-sm text-ink-muted">
        La dirección que abriste no existe o ya no está disponible.
      </p>
      <Link
        href="/"
        className="inline-flex min-h-11 items-center rounded-md bg-accent px-4 text-sm font-medium text-accent-fg"
      >
        Volver al inicio
      </Link>
    </main>
  );
}
