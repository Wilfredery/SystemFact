"use client";

/**
 * Board 01 "Login" — presentational restyle ONLY (auth-tenant-selector, S4 /
 * design D7). ZERO auth-logic changes (LOG-05-A): same `useActionState(login)`
 * contract; only the surface below the wire restyled to the F0 semantic
 * tokens (ink/surface/line/accent, light-only — no raw palette classes, no
 * dark-mode variants; LOG-04-A).
 *
 * ADR-014 (LOG-01-A): exactly two credential fields — `nombreUsuario` +
 * `password`. NO email field, NO synthetic suffix anywhere on screen.
 *
 * Touch rules (LOG-04-B): submit ≥44px (F0 Button h-11), ≥8px separation from
 * the error box (gap-4 rhythm), `nombreUsuario` autofocus kept, Enter submits.
 */

import { useActionState, useId } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { login, type LoginResult } from "@/modules/auth/http/actions";

const initialState: LoginResult = { error: null };

export default function LoginPage() {
  const [state, formAction, isPending] = useActionState(login, initialState);
  const hintId = useId();
  const errorId = useId();
  const hayError = state.error !== null;

  return (
    <div className="w-full max-w-md">
      <div className="rounded-xl bg-surface p-8 ring-1 ring-line">
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-lg bg-accent text-xl font-bold text-accent-fg">
            SF
          </div>
          <h1 className="font-sans text-2xl font-semibold text-ink">
            SystemFact
          </h1>
          <p className="mt-2 text-sm text-ink-muted">
            Inicia sesión para continuar.
          </p>
        </div>

        <form action={formAction} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="nombreUsuario">Usuario</Label>
            <Input
              id="nombreUsuario"
              name="nombreUsuario"
              type="text"
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              required
              autoFocus
              placeholder="CODIGO-usuario"
              aria-invalid={hayError ? true : undefined}
              aria-describedby={hayError ? `${hintId} ${errorId}` : hintId}
              className="h-11 bg-surface px-3"
            />
            <p id={hintId} className="text-xs text-ink-muted">
              Formato: CÓDIGO-usuario (ej. DEMO-admin)
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="password">Contraseña</Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              placeholder="••••••••"
              aria-invalid={hayError ? true : undefined}
              aria-describedby={hayError ? errorId : undefined}
              className="h-11 bg-surface px-3"
            />
          </div>

          {hayError && (
            <div
              id={errorId}
              role="alert"
              className="mt-2 rounded-lg bg-danger/10 px-4 py-3 text-sm text-danger"
            >
              {state.error}
            </div>
          )}

          <Button
            type="submit"
            disabled={isPending}
            className="mt-4 h-12 w-full"
          >
            {isPending ? "Ingresando…" : "Iniciar sesión"}
          </Button>
        </form>

        {/* No self-service recovery: the internal sign-in email is not a real mailbox
            (ADR-014), so a reset-by-email flow cannot exist. Plain text, not a control. */}
        <p className="mt-8 text-center text-sm text-ink-muted">
          ¿Olvidaste tu contraseña? Contacta al administrador.
        </p>
      </div>

      <p className="mt-6 text-center text-xs text-ink-muted">
        © {new Date().getFullYear()} SystemFact. Todos los derechos reservados.
      </p>
    </div>
  );
}
