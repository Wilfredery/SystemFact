"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/client";
import {
  loginWithCredenciales,
  logout,
  getCurrentUser,
  type CurrentUserContext,
} from "@/modules/auth/infrastructure/auth-service";
import {
  AUTH_CAMPOS_REQUERIDOS,
  messageFor,
} from "@/modules/auth/domain/errors";

/**
 * Server Actions for authentication (thin adapters).
 *
 * Business logic lives in `src/modules/auth/infrastructure/auth-service.ts`.
 */

export interface LoginResult {
  error: string | null;
}

const loginInputSchema = z.object({
  nombreUsuario: z.string().trim().min(1).max(255),
  password: z.string().min(1).max(255),
});

/**
 * Logs a user in using `nombreUsuario` + password (ADR-014).
 * On success the landing is decided HERE per design D2 — the middleware stays
 * byte-identical: a multi-branch ADMIN (`esAdmin && activeBranchCount > 1`)
 * goes to `/selector-empresa-sucursal`; everyone else (non-admin fast path
 * 17 §5, single-branch admin) goes to `/dashboard`, unchanged.
 * On failure returns a generic error.
 *
 * Signature follows `useActionState` (previous state, then the form data),
 * which drives the client-side pending/error state on the login form.
 */
// Auth actions operate on Supabase Auth, not tenant data; tenant wrapper not required.
export async function login(
  _prevState: LoginResult,
  formData: FormData,
): Promise<LoginResult> {
  const parsed = loginInputSchema.safeParse({
    nombreUsuario: formData.get("nombreUsuario") ?? "",
    password: formData.get("password") ?? "",
  });
  if (!parsed.success) {
    return { error: messageFor(AUTH_CAMPOS_REQUERIDOS) };
  }
  const { nombreUsuario, password } = parsed.data;

  const supabase = await createClient();
  const result = await loginWithCredenciales(supabase, nombreUsuario, password);

  if (!result.ok) {
    return { error: result.message };
  }

  redirect(
    result.esAdmin && result.activeBranchCount > 1
      ? "/selector-empresa-sucursal"
      : "/dashboard",
  );
}

/**
 * Closes the current session and redirects to the login page.
 */
