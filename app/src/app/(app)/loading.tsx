/** Fallback while an authenticated page streams in (renders inside the app shell). */
export default function AppLoading() {
  return (
    <div
      role="status"
      aria-busy="true"
      className="flex flex-1 items-center justify-center px-4 py-16 text-sm text-ink-muted"
    >
      Cargando…
    </div>
  );
}
