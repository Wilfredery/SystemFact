/**
 * Prisma port — SUCURSAL reads for the tenant module (“auth-tenant-selector”,
 * design D3). Narrow select: id + nombre only; no deep tenant data.
 *
 * The Prisma field is `activa` (schema.prisma pin; design resolves the delta
 * specs' generic "activo" wording) — ` @@map("SUCURSAL")`.
 */

import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";

/** Shape the selector screen consumes: id + nombre, nothing deeper. */
export type SucursalResumen = {
  readonly id: number;
  readonly nombre: string;
};

/**
 * Lists the caller-empresa's ACTIVE branches, ordered by nombre ascending.
 * Scope must be the session `empresaId` (P6 — never a client-provided filter).
 */
export async function listarSucursalesActivas(
  tx: PrismaTx,
  empresaId: number,
): Promise<{ id: number; nombre: string }[]> {
  return tx.sucursal.findMany({
    where: { empresaId, activa: true },
    select: { id: true, nombre: true },
    orderBy: { nombre: "asc" },
  });
}
