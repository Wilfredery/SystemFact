/**
 * Tenant Server Action — thin HTTP adapter for the admin branch switch
 * (“auth-tenant-selector”, design D4). Zero business logic (AGENTS.md):
 *   1. Zod-parse the payload → stable `VALIDATION_ERROR` on a bad SHAPE.
 *   2. Resolve the tenant context from the Supabase session (auth read, not
 *      tenant-DB access — precedes the wrapper, venta/devolucion convention).
 *   3. Inside the ONE `withTenantTransaction`: delegate to the use case and
 *      forward its typed result. The switch form triggers navigation to
 *      `/dashboard` on success (design D2).
 *
 * Only stable catalog codes cross the boundary; Prisma/DB errors never leak.
 * Constants/types live in `./validations.ts` — a `"use server"` file may only
 * export async functions (devolucion/actions.shared.ts precedent).
 */

"use server";

import { createClient } from "@/lib/supabase/client";
import { withTenantTransaction } from "@/modules/tenant/infrastructure/withTenantTransaction";
import { getCurrentTenantContext } from "@/modules/tenant/infrastructure/tenant-runtime";
import { cambiarSucursalActiva } from "../application/cambiarSucursalActiva";
import {
  VALIDATION_ERROR,
  SESION_INVALIDA,
  mensajeTransporte,
  zCambiarSucursalInput,
} from "./validations";

export type CambiarSucursalActionCode =
  | import("../domain/errors").TenantErrorCode
  | typeof VALIDATION_ERROR
  | typeof SESION_INVALIDA;

export type CambiarSucursalActionResult =
  | { ok: true }
  | { ok: false; code: CambiarSucursalActionCode; message: string };

export async function cambiarSucursalActivaAction(
  input: unknown,
): Promise<CambiarSucursalActionResult> {
  const parsed = zCambiarSucursalInput.safeParse(input ?? {});
  if (!parsed.success) {
    return {
      ok: false,
      code: VALIDATION_ERROR,
      message: mensajeTransporte(VALIDATION_ERROR),
    };
  }

  const supabase = await createClient();
  const ctx = await getCurrentTenantContext(supabase);
  if (ctx === null) {
    return {
      ok: false,
      code: SESION_INVALIDA,
      message: mensajeTransporte(SESION_INVALIDA),
    };
  }

  return withTenantTransaction(ctx, (tx) =>
    cambiarSucursalActiva(ctx, parsed.data, tx),
  );
}
