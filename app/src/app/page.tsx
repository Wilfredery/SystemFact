import { redirect } from "next/navigation";

/**
 * Root path: the entry point is the login. An anonymous visitor lands on it directly; an
 * authenticated one is bounced to the dashboard by the proxy (a public path with a session).
 * Owner decision 2026-11-22 (odd/tasks/screen-audit-fixes.md S1): no starter template here.
 */
export default function Home(): never {
  redirect("/login");
}
