"use client";

import { useActionState } from "react";
import { login, type LoginResult } from "@/modules/auth/http/actions";

const initialState: LoginResult = { error: null };

export default function LoginPage() {
  const [state, formAction, isPending] = useActionState(login, initialState);

  return (
    <div className="w-full max-w-md">
      <div className="rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-xl bg-indigo-600 text-xl font-bold text-white">
            SF
          </div>
          <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
            SystemFact
          </h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Inicia sesión con tu usuario para continuar.
          </p>
        </div>

        <form action={formAction} className="flex flex-col gap-5">
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="nombreUsuario"
              className="text-sm font-medium text-zinc-700 dark:text-zinc-300"
            >
              Usuario
            </label>
            <input
              id="nombreUsuario"
              name="nombreUsuario"
              type="text"
              autoComplete="username"
              required
              autoFocus
              placeholder="tu.usuario"
              className="h-12 rounded-lg border border-zinc-300 bg-white px-4 text-base text-zinc-900 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-50"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="password"
              className="text-sm font-medium text-zinc-700 dark:text-zinc-300"
            >
              Contraseña
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              placeholder="••••••••"
              className="h-12 rounded-lg border border-zinc-300 bg-white px-4 text-base text-zinc-900 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-50"
            />
          </div>

          {state.error !== null && (
            <div
              role="alert"
              className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
            >
              {state.error}
            </div>
          )}

          <button
            type="submit"
            disabled={isPending}
            className="mt-2 flex h-12 w-full items-center justify-center rounded-lg bg-indigo-600 px-4 text-base font-semibold text-white transition hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isPending ? "Ingresando…" : "Ingresar"}
          </button>
        </form>
      </div>

      <p className="mt-6 text-center text-xs text-zinc-400 dark:text-zinc-600">
        © {new Date().getFullYear()} SystemFact. Todos los derechos reservados.
      </p>
    </div>
  );
}
