"use client";

/**
 * Shared "something went wrong" panel for the route error boundaries (`app/error.tsx` and
 * `app/(app)/error.tsx`). Spanish copy, F0 design-system tokens only, 44px touch targets.
 *
 * It NEVER prints `error.message` or a stack: only the opaque `digest` Next attaches to server
 * errors, as a reference code the operator can find in the logs (AGENTS.md: no internals to the client).
 */

import Link from "next/link";

export function ErrorPanel({
  digest,
  onRetry,
}: {
  readonly digest?: string;
  readonly onRetry: () => void;
}) {
  return (
    <div
      role="alert"
      className="mx-auto flex max-w-lg flex-1 flex-col items-center justify-center gap-4 px-4 py-16 text-center"
    >
      <h1 className="text-2xl font-bold text-ink">Algo salió mal</h1>
      <p className="text-sm text-ink-muted">
        No pudimos completar la operación. Puedes intentarlo de nuevo; si el problema continúa, avisa al
        administrador.
      </p>
      {digest !== undefined && digest !== "" ? (
        <p className="text-xs text-ink-muted">
          Código de referencia: <span className="font-mono">{digest}</span>
        </p>
      ) : null}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex min-h-11 items-center rounded-md bg-accent px-4 text-sm font-medium text-accent-fg"
        >
          Intentar de nuevo
        </button>
        <Link
          href="/"
          className="inline-flex min-h-11 items-center rounded-md border border-line px-4 text-sm font-medium text-ink"
        >
          Volver al inicio
        </Link>
      </div>
    </div>
  );
}
