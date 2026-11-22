"use client";

import "./globals.css";

/**
 * Last-resort boundary: it replaces the root layout when the layout itself fails, so it must
 * render its own <html>/<body>. Same copy and tokens as the other boundaries; no error details.
 */
export default function GlobalError({
  error,
  reset,
}: {
  readonly error: Error & { digest?: string };
  readonly reset: () => void;
}) {
  return (
    <html lang="es" className="h-full antialiased">
      <body className="flex min-h-full flex-col bg-surface-muted">
        <main
          role="alert"
          className="mx-auto flex max-w-lg flex-1 flex-col items-center justify-center gap-4 px-4 py-16 text-center"
        >
          <h1 className="text-2xl font-bold text-ink">Algo salió mal</h1>
          <p className="text-sm text-ink-muted">
            La aplicación no pudo cargarse. Intenta de nuevo; si continúa, avisa al administrador.
          </p>
          {error.digest !== undefined && error.digest !== "" ? (
            <p className="text-xs text-ink-muted">
              Código de referencia: <span className="font-mono">{error.digest}</span>
            </p>
          ) : null}
          <button
            type="button"
            onClick={reset}
            className="inline-flex min-h-11 items-center rounded-md bg-accent px-4 text-sm font-medium text-accent-fg"
          >
            Intentar de nuevo
          </button>
        </main>
      </body>
    </html>
  );
}
