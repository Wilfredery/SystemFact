/**
 * Módulo PURO de tenant — sin imports de Prisma, Supabase ni nada con efectos en BD.
 *
 * Contiene:
 *   - `TenantCtx`: tipo inmutable con el contexto de tenant del request actual.
 *   - `TenantFilter`: intención de filtrado a nivel de dominio (tagged union),
 *     agnóstica de la capa de infraestructura (no expone semántica de Prisma).
 *   - `buildTenantContext(usuario, roles)`: constructor puro del contexto.
 *   - `tenantFilter(ctx)`: traduce un TenantCtx a un TenantFilter de dominio.
 *
 * Las funciones con efectos en BD (`setTenantContext`, `setLoginFlow`,
 * `getCurrentTenantContext`) viven en `../infrastructure/tenant-runtime.ts`.
 * El traductor de TenantFilter a la forma que Prisma consume vive en
 * `../infrastructure/tenant-where.ts`.
 *
 * Los IDs son `Int` porque el ERD v4.7 usa `@id @default(autoincrement())`
 * (`app/prisma/schema.prisma`). Coherente con la BD real.
 *
 * Esta separación cumple ADR-013 (modular monolith): el dominio no sabe de
 * infraestructura, y la infraestructura traduce el dominio a su dialecto.
 */

/**
 * Contexto de tenant para el request actual.
 *
 * Se construye UNA vez al inicio de la Server Action (vía
 * `getCurrentTenantContext` en `../infrastructure/tenant-runtime.ts`) y se
 * propaga a:
 *   - `tenantFilter(ctx)` para producir el filtro de dominio (capa A — ADR-019).
 *   - `setTenantContext(tx, ctx)` para policies RLS en Postgres (capa B).
 *
 * Invariantes:
 *   - `empresaId` siempre presente (no nulo).
 *   - `sucursalId` es `null` SOLO cuando `esAdmin === true` y el Administrador
 *     opera a nivel de empresa (P6 de `docs/20-Respreguntas_jefe_seguridad_auth.md`).
 *   - `esAdmin` se deriva de los roles del USUARIO (no es un flag separado).
 */
export type TenantCtx = {
  readonly empresaId: number;
  readonly sucursalId: number | null;
  readonly usuarioId: number;
  readonly esAdmin: boolean;
};

/**
 * Intención de filtrado multi-tenant a nivel de dominio.
 *
 * Tagged union: hace explícito si el filtro aplica a nivel de empresa
 * (Administrador empresa-wide) o a nivel de sucursal concreta.
 *
 * Este tipo es AGNÓSTICO de Prisma. La traducción a la forma que Prisma
 * consume (con `sucursalId` opcional) vive en `../infrastructure/tenant-where.ts`.
 * Esa separación evita que el dominio "leakee" semántica de query de Prisma
 * (donde `sucursalId?: number` distingue "ignorar" de "match null").
 */
export type TenantFilter =
  | {
      readonly scope: "company";
      readonly empresaId: number;
    }
  | {
      readonly scope: "branch";
      readonly empresaId: number;
      readonly sucursalId: number;
    };

/**
 * Constructor puro del TenantCtx desde datos ya resueltos.
 * Función pura — fácil de testear sin DB.
 *
 * @param usuario USUARIO ya leído de la BD (id, empresaId, sucursalId).
 * @param roles   Nombres de roles del usuario (vía `USUARIO_ROL` → `ROL`).
 */
export function buildTenantContext(
  usuario: { id: number; empresaId: number; sucursalId: number },
  roles: readonly string[],
): TenantCtx {
  return {
    empresaId: usuario.empresaId,
    sucursalId: usuario.sucursalId,
    usuarioId: usuario.id,
    esAdmin: roles.includes("Administrador"),
  };
}

/**
 * Traduce un `TenantCtx` a un `TenantFilter` de dominio.
 *
 * Si `sucursalId` es `null` (Admin empresa-wide), produce `scope: "company"`.
 * Si tiene sucursal, produce `scope: "branch"` con el id de sucursal.
 *
 * Para tablas hijas sin `empresaId` propio (`DETALLE_VENTA`,
 * `DETALLE_COMPRA`, `DETALLE_NOTA_CREDITO`, `MOVIMIENTO_INVENTARIO`)
 * la capa de aplicación debe combinar este filtro con la navegación de la
 * relación Prisma (`where: { venta: { empresaId: filter.empresaId, ... } }`).
 *
 * Para tablas cuya única ancla de tenant es `sucursalId` (`INVENTARIO`),
 * usar `where: { sucursal: { empresaId: filter.empresaId } }`.
 */
export function tenantFilter(
  ctx: TenantCtx,
): TenantFilter {
  if (ctx.sucursalId === null) {
    return { scope: "company", empresaId: ctx.empresaId };
  }
  return {
    scope: "branch",
    empresaId: ctx.empresaId,
    sucursalId: ctx.sucursalId,
  };
}