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

import { useActionState } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { login, type LoginResult } from "@/modules/auth/http/actions";

const initialState: LoginResult = { error: null };

export default function LoginPage() {
  const [state, formAction, isPending] = useActionState(login, initialState);

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
            Inicia sesión con tu usuario para continuar.
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
              required
              autoFocus
              placeholder="tu.usuario"
              className="h-11 bg-surface px-3"
            />
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
              className="h-11 bg-surface px-3"
            />
          </div>

          {state.error !== null && (
            <div
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
            {isPending ? "Ingresando…" : "Ingresar"}
          </Button>
        </form>

        {/* F1 has no recovery flow (LOG-03-A): visible, keyboard-reachable,
            inert by design. */}
        <span
          tabIndex={0}
          aria-disabled="true"
          title="Disponible próximamente"
          className="mt-8 flex h-11 cursor-default items-center justify-center text-sm text-link underline-offset-4"
        >
          Recuperar contraseña
        </span>
      </div>

      <p className="mt-6 text-center text-xs text-ink-muted">
        © {new Date().getFullYear()} SystemFact. Todos los derechos reservados.
      </p>
    </div>
  );
}
