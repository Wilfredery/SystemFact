/**
 * Traductor de dominio → Prisma: `TenantFilter` (agnóstico) → `where` (Prisma).
 *
 * Vive en infrastructure (no domain) porque su salida está acoplada a la
 * semántica de queries de Prisma (`sucursalId?: number` distingue "ignorar
 * el campo" de "match null"). Mantener esta traducción en el dialecto de
 * infraestructura preserva al dominio de detalles del ORM.
 *
 * El dominio produce `TenantFilter` (tagged union: scope=company / scope=branch)
 * vía `tenantFilter(ctx)`. Esta función toma ese intent de dominio y lo
 * convierte a la forma que `prisma.<tabla>.findMany({ where })` consume.
 *
 * Tests de esta función son integration (R1.C) — el shape de salida se valida
 * junto con queries reales contra Supabase con RLS activo.
 */

import type { TenantFilter } from "@/modules/tenant/domain/tenant";

/**
 * Forma de `where` que las queries Prisma aceptan para tablas con
 * `empresaId` (y opcionalmente `sucursalId`).
 *
 * Documentamos el tipo aquí (en vez de importarlo del cliente Prisma) para
 * evitar una dependencia transitiva que arrastra todo el cliente generado
 * a este archivo.
 */
export type PrismaTenantWhere = {
  empresaId: number;
  sucursalId?: number;
};

/**
 * Traduce un `TenantFilter` de dominio a la forma `where` que Prisma consume.
 *
 *   - `scope: "company"`  → `{ empresaId }` (sin sucursalId)
 *   - `scope: "branch"`   → `{ empresaId, sucursalId }`
 *
 * Para tablas hijas sin `empresaId` propio, el call site debe combinar este
 * filtro con la navegación de relación Prisma:
 *
 *   ```ts
 *   prisma.detalleVenta.findMany({
 *     where: { venta: tenantWhere(tenantFilter(ctx)), ... },
 *   });
 *   ```
 */
export function tenantWhere(filter: TenantFilter): PrismaTenantWhere {
  if (filter.scope === "company") {
    return { empresaId: filter.empresaId };
  }
  return { empresaId: filter.empresaId, sucursalId: filter.sucursalId };
}