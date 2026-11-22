"use client";

import { ErrorPanel } from "@/shared/ui/error-panel";

/** Root error boundary (public routes such as /login). */
export default function RootError({
  error,
  reset,
}: {
  readonly error: Error & { digest?: string };
  readonly reset: () => void;
}) {
  return (
    <main className="flex min-h-full flex-1 flex-col bg-surface-muted">
      <ErrorPanel digest={error.digest} onRetry={reset} />
    </main>
  );
}
