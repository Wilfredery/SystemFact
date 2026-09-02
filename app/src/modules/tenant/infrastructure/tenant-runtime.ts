/**
 * Módulo RUNTIME de tenant — funciones con efectos en BD (Prisma + sesión Postgres).
 *
 * Separado de `../domain/tenant.ts` (puro) por dos razones:
 *   1. Los unit tests del módulo de dominio no arrastran el cliente generado
 *      de Prisma (ESM-only, incompatible con CJS en Jest 29 + ts-jest).
 *   2. ADR-013: la capa de infrastructure traduce el dominio a su dialecto
 *      (Prisma aquí), el dominio no conoce el dialecto.
 *
 * Contiene:
 *   - `setTenantContext(tx, ctx)`: setea variables Postgres para RLS.
 *   - `setLoginFlow(tx)`: flag para el gallina-huevo del path de login.
 *   - `getCurrentTenantContext(supabase)`: resuelve el contexto desde sesión.
 *
 * El traductor `TenantFilter` (dominio) → `where` (Prisma) vive en
 * `./tenant-where.ts` para mantener este archivo enfocado en operaciones
 * que tocan la BD (y por ende requieren tests de integration, no unit).
 */

import type { Prisma } from "@/generated/prisma/client";
import type { SupabaseClient } from "@supabase/supabase-js";
import { prisma } from "@/lib/prisma";
import { buildTenantContext, type TenantCtx } from "@/modules/tenant/domain/tenant";

/**
 * Sufijo del email sintético que Supabase Auth usa para mapear cada
 * `nombreUsuario` (ADR-014). Nunca se muestra al usuario en la UI.
 */
const SYNTHETIC_EMAIL_SUFFIX = "@users.systemfact.internal";

/**
 * Setea el contexto de tenant en la sesión Postgres de la transacción.
 *
 * Implementación: usa `set_config(name, value, is_local)` con `is_local = true`
 * — equivalente a `SET LOCAL` pero permite parámetros bindados (seguro contra
 * inyección SQL).
 *
 * Variables que quedan disponibles para las policies RLS:
 *   - `current_setting('app.current_empresa_id', true)::int`
 *   - `current_setting('app.current_sucursal_id', true)::int`   (NULL si Admin empresa-wide)
 *   - `current_setting('app.current_usuario_id', true)::int`
 *   - `current_setting('app.current_es_admin', true)`           ('true' | 'false')
 *
 * IMPORTANTE: DEBE llamarse dentro de `prisma.$transaction(async tx => { ... })`
 * para que la conexión Postgres sea la misma durante toda la transacción.
 * Fuera de `$transaction`, Prisma 7 con `@prisma/adapter-pg` puede cambiar
 * de conexión entre queries y `set_config(..., true)` se pierde.
 */
export async function setTenantContext(
  tx: Prisma.TransactionClient,
  ctx: TenantCtx,
): Promise<void> {
  await tx.$executeRaw`SELECT set_config('app.current_empresa_id', ${ctx.empresaId.toString()}, true)`;
  if (ctx.sucursalId !== null) {
    await tx.$executeRaw`SELECT set_config('app.current_sucursal_id', ${ctx.sucursalId.toString()}, true)`;
  }
  await tx.$executeRaw`SELECT set_config('app.current_usuario_id', ${ctx.usuarioId.toString()}, true)`;
  await tx.$executeRaw`SELECT set_config('app.current_es_admin', ${ctx.esAdmin ? "true" : "false"}, true)`;
}

/**
 * Activa la flag `app.is_login_flow` en la sesión Postgres de la transacción.
 *
 * Esta flag es leída por las policies RLS de `USUARIO` y `USUARIO_ROL`
 * (ver migración `*_enable_rls`) para permitir el `findUnique` inicial del
 * path de login — sin contexto de tenant todavía. Es la excepción controlada
 * al aislamiento multi-tenant (ADR-019) que resuelve el problema gallina-huevo
 * de autenticar antes de tener un TenantCtx resuelto.
 *
 * Solo debe usarse en:
 *   - `auth-service.ts` → lookup de USUARIO por email/nombreUsuario post-login.
 *   - Cualquier path que resuelva identidad antes de tener tenant.
 *
 * NO usar en queries de negocio. Toda Server Action de negocio debe llamar
 * `setTenantContext(tx, ctx)` con un ctx ya validado.
 */
export async function setLoginFlow(
  tx: Prisma.TransactionClient,
): Promise<void> {
  await tx.$executeRaw`SELECT set_config('app.is_login_flow', 'true', true)`;
}

/**
 * Lee el TenantCtx del request actual a partir de la sesión Supabase.
 *
 * Resolución:
 *   1. `supabase.auth.getUser()` → valida JWT y devuelve el email sintético.
 *   2. Decodifica `nombreUsuario` del sufijo del email.
 *   3. `prisma.usuario.findUnique` dentro de `$transaction` con `app.is_login_flow`
 *      activado (resuelve el gallina-huevo del path de auth — ver ADR-019 y
 *      migración `*_enable_rls`, policy `usuario_select`).
 *   4. `buildTenantContext(...)` para armar el contexto final.
 */
export async function getCurrentTenantContext(
  supabase: SupabaseClient,
): Promise<TenantCtx | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user === null) return null;

  const email = user.email ?? "";
  if (!email.endsWith(SYNTHETIC_EMAIL_SUFFIX)) return null;
  const nombreUsuario = email.slice(0, -SYNTHETIC_EMAIL_SUFFIX.length);

  // NOTA (ADR-019 / R1.B): con RLS activo, este findUnique NO tiene contexto
  // de tenant (lo estamos construyendo). Se activa `app.is_login_flow` para
  // que la policy de USUARIO lo permita.
  const usuario = await prisma.$transaction(async (tx) => {
    await setLoginFlow(tx);
    return tx.usuario.findUnique({
      where: { nombreUsuario },
      select: {
        id: true,
        empresaId: true,
        sucursalId: true,
        activo: true,
        roles: {
          select: { rol: { select: { nombre: true } } },
        },
      },
    });
  });
  if (usuario === null || !usuario.activo) return null;

  const roles = usuario.roles.map((r) => r.rol.nombre);
  return buildTenantContext(
    {
      id: usuario.id,
      empresaId: usuario.empresaId,
      sucursalId: usuario.sucursalId,
    },
    roles,
  );
}

// Re-exports para que el call site importe todo desde un solo módulo:
//   import { setTenantContext, tenantFilter } from "@/modules/tenant";
//   import type { TenantCtx } from "@/modules/tenant";
export {
  buildTenantContext,
  tenantFilter,
  type TenantCtx,
  type TenantFilter,
} from "@/modules/tenant/domain/tenant";
export { tenantWhere } from "@/modules/tenant/infrastructure/tenant-where";