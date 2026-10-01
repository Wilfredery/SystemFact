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
 *   - `getCurrentTenantContext(supabase)`: resuelve el contexto desde sesión.
 *
 * `setLoginFlow(tx)` (flag para el gallina-huevo del path de login) vive en
 * `./login-flow.ts` y se re-exporta aquí para no romper los call sites; ver ese
 * archivo por el alcance exacto de la excepción.
 *
 * El traductor `TenantFilter` (dominio) → `where` (Prisma) vive en
 * `./tenant-where.ts` para mantener este archivo enfocado en operaciones
 * que tocan la BD (y por ende requieren tests de integration, no unit).
 */

import type { Prisma } from "@/generated/prisma/client";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildTenantContext, type TenantCtx } from "@/modules/tenant/domain/tenant";
import {
  buscarUsuarioPorAuthSub,
  resolverAuthSubDeSesion,
} from "@/modules/auth/infrastructure/auth-identity";

/**
 * Setea el contexto de tenant en la sesión Postgres de la transacción.
 *
 * Implementación: usa `set_config(name, value, is_local)` con `is_local = true`
 * — equivalente a `SET LOCAL` pero permite parámetros bindados (seguro contra
 * inyección SQL).
 *
 * Variables que quedan disponibles para las policies RLS:
 *   - `current_setting('app.current_empresa_id', true)::int`
 *   - `current_setting('app.current_sucursal_id', true)::int`   (nunca NULL: P6 cerró el
 *     modo Admin empresa-wide, así que `TenantCtx.sucursalId` es siempre una sucursal)
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
  await tx.$executeRaw`SELECT set_config('app.current_empresa_id', ${String(ctx.empresaId)}, true)`;
  await tx.$executeRaw`SELECT set_config('app.current_sucursal_id', ${String(ctx.sucursalId)}, true)`;
  await tx.$executeRaw`SELECT set_config('app.current_usuario_id', ${String(ctx.usuarioId)}, true)`;
  await tx.$executeRaw`SELECT set_config('app.current_es_admin', ${String(ctx.esAdmin)}, true)`;
}

/**
 * Lee el TenantCtx del request actual a partir de la sesión Supabase.
 *
 * Resolución (audit v2r-01 — la identidad se resuelve por `sub`, NO por email):
 *   1. `supabase.auth.getUser()` valida el JWT y devuelve el `sub` del usuario
 *      de Auth, su identificador INMUTABLE.
 *   2. `buscarUsuarioPorAuthSub(sub, select)` busca la fila de USUARIO por
 *      `authUserId = sub` dentro de `$transaction` con `app.is_login_flow`
 *      activado (gallina-huevo del path de auth — ver ADR-019 y migración
 *      `*_enable_rls`, policy `usuario_select`).
 *   3. `buildTenantContext(...)` para armar el contexto final.
 *
 * El email sintético NO participa: ADR-014 lo declara no-credencial y un admin
 * de Auth puede cambiarlo, así que un binding por email no es a prueba de
 * manipulación. Una fila con `authUserId IS NULL` (nuncalogueada desde que
 * existe la columna) resuelve `null` y el usuario debe volver a entrar una vez.
 */
export async function getCurrentTenantContext(
  supabase: SupabaseClient,
): Promise<TenantCtx | null> {
  // NOTA (ADR-019 / R1.B): con RLS activo, este lookup NO tiene contexto de
  // tenant (lo estamos construyendo). Se activa `app.is_login_flow` para que la
  // policy de USUARIO lo permita. La resolución por `sub` vive en
  // auth-identity, que ya abre su propia transacción con esa flag.
  const authSub = await resolverAuthSubDeSesion(supabase);
  if (authSub === null) return null;

  const usuario = await buscarUsuarioPorAuthSub(authSub, {
    id: true,
    empresaId: true,
    sucursalId: true,
    activo: true,
    roles: {
      select: { rol: { select: { nombre: true } } },
    },
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
export { setLoginFlow } from "@/modules/tenant/infrastructure/login-flow";