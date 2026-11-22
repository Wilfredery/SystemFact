"use client";

import { ErrorPanel } from "@/shared/ui/error-panel";

/** Error boundary of the authenticated area: it renders INSIDE the app shell (sidebar stays). */
export default function AppError({
  error,
  reset,
}: {
  readonly error: Error & { digest?: string };
  readonly reset: () => void;
}) {
  return <ErrorPanel digest={error.digest} onRetry={reset} />;
}
