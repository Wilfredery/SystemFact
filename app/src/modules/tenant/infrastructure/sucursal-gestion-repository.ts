/**
 * Tenant repository — the SUCURSAL management WRITES (odd/tasks/
 * administracion-sucursales-crear-editar.md, S3-S7).
 *
 * Everything runs INSIDE the caller's `withTenantTransaction` (RLS GUCs set; the
 * admin-only write policies of migration `20261115120000_sucursal_writes_admin_only`
 * are the second wall). Every statement ALSO pins `empresaId` (AGENTS.md).
 * Branches are NEVER deleted (master entity): this file exposes no delete.
 *
 * Failed writes (unique-name violation, RLS refusal) abort the surrounding
 * Postgres transaction (25P02). Each write therefore runs inside a SAVEPOINT
 * (`escribirGuardado`): on those two expected failures the savepoint is rolled
 * back, the transaction stays usable and the caller gets a typed outcome, never
 * a Prisma error. Anything else is a defect and propagates untouched.
 */

import { Prisma } from "@/generated/prisma/client";
import { ACCION_AUDITORIA } from "@/modules/auditoria/domain/auditoria";
import { registrarEventoAuditoriaEnTx } from "@/modules/auditoria/application/auditoria-write-port";
import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "../domain/tenant";
import type { DatosSucursal } from "../domain/sucursal-gestion";
import {
  abrirSavepoint,
  liberarSavepoint,
  revertarSavepoint,
} from "./savepoint";

export interface SucursalGestionable extends DatosSucursal {
  readonly id: number;
  readonly activa: boolean;
  readonly version: number;
}

const sucursalSelect = {
  id: true,
  nombre: true,
  direccion: true,
  telefono: true,
  activa: true,
  version: true,
} as const;

/** Static savepoint name — never derived from user input. */
const SAVEPOINT_ESCRITURA = "sf_sucursal_escritura";

export type EscrituraRechazada =
  | { readonly tipo: "NOMBRE_DUPLICADO" }
  | { readonly tipo: "DENEGADA" };

type EscrituraGuardada<T> =
  | { readonly tipo: "OK"; readonly valor: T }
  | EscrituraRechazada;

function esNombreDuplicado(err: unknown): boolean {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
    return true;
  }
  const texto = err instanceof Error ? err.message : "";
  return /SUCURSAL_empresaId_nombre_lower_key|duplicate key value|unique constraint/i.test(texto);
}

function esDenegadoPorRls(err: unknown): boolean {
  const texto = err instanceof Error ? err.message : "";
  return /row-level security/i.test(texto);
}

async function escribirGuardado<T>(
  tx: PrismaTx,
  escribir: () => Promise<T>,
): Promise<EscrituraGuardada<T>> {
  const guardaActiva = await abrirSavepoint(tx, SAVEPOINT_ESCRITURA);
  try {
    const valor = await escribir();
    if (guardaActiva) await liberarSavepoint(tx, SAVEPOINT_ESCRITURA);
    return { tipo: "OK", valor };
  } catch (err) {
    const rechazo: EscrituraRechazada | null = esNombreDuplicado(err)
      ? { tipo: "NOMBRE_DUPLICADO" }
      : esDenegadoPorRls(err)
        ? { tipo: "DENEGADA" }
        : null;
    if (rechazo === null) throw err;
    if (guardaActiva) await revertarSavepoint(tx, SAVEPOINT_ESCRITURA);
    return rechazo;
  }
}

/** The branch as the write sees it; `null` = unknown or foreign empresa (indistinguishable). */
export async function leerSucursalGestionableEnTx(
  tx: PrismaTx,
  empresaId: number,
  sucursalId: number,
): Promise<SucursalGestionable | null> {
  return tx.sucursal.findFirst({
    where: { id: sucursalId, empresaId },
    select: sucursalSelect,
  });
}

/**
 * Duplicate probe over ALL branches of the empresa, inactive ones included,
 * with the same identity as the unique index: `lower(btrim(nombre))`.
 * On edit the branch itself is excluded (`excluirSucursalId`).
 */
export async function existeSucursalConNombreEnTx(
  tx: PrismaTx,
  empresaId: number,
  nombre: string,
  excluirSucursalId: number | null,
): Promise<boolean> {
  const filas = await tx.$queryRaw<{ id: number }[]>`
    SELECT s."id"
    FROM "SUCURSAL" s
    WHERE s."empresaId" = ${empresaId}
      AND lower(btrim(s."nombre")) = lower(btrim(${nombre}))
      AND (${excluirSucursalId}::int IS NULL OR s."id" <> ${excluirSucursalId}::int)
    LIMIT 1`;
  return filas.length > 0;
}

export type ResultadoCrearSucursal =
  | { readonly tipo: "CREADA"; readonly sucursal: SucursalGestionable }
  | EscrituraRechazada;

/** INSERT a new ACTIVE branch (version 1) of the SESSION empresa. */
export async function crearSucursalEnTx(
  tx: PrismaTx,
  ctx: TenantCtx,
  datos: DatosSucursal,
): Promise<ResultadoCrearSucursal> {
  const resultado = await escribirGuardado(tx, () =>
    tx.sucursal.create({
      data: {
        empresaId: ctx.empresaId,
        nombre: datos.nombre,
        direccion: datos.direccion,
        telefono: datos.telefono,
        activa: true,
        version: 1,
      },
      select: sucursalSelect,
    }),
  );
  return resultado.tipo === "OK"
    ? { tipo: "CREADA", sucursal: resultado.valor }
    : resultado;
}

export type ResultadoActualizarSucursal =
  | { readonly tipo: "APLICADA"; readonly version: number }
  | { readonly tipo: "SIN_FILAS" }
  | EscrituraRechazada;

/**
 * Verified UPDATE: `WHERE id AND empresaId AND version = esperada`, bumping
 * `version` atomically. `SIN_FILAS` = stale version (or an RLS-filtered write;
 * the use case tells them apart by re-reading).
 */
export async function actualizarSucursalEnTx(
  tx: PrismaTx,
  empresaId: number,
  sucursalId: number,
  versionEsperada: number,
  cambios: Partial<DatosSucursal>,
): Promise<ResultadoActualizarSucursal> {
  const resultado = await escribirGuardado(tx, () =>
    tx.sucursal.updateMany({
      where: { id: sucursalId, empresaId, version: versionEsperada },
      data: { ...cambios, version: { increment: 1 } },
    }),
  );
  if (resultado.tipo !== "OK") return resultado;
  if (resultado.valor.count === 0) return { tipo: "SIN_FILAS" };
  return { tipo: "APLICADA", version: versionEsperada + 1 };
}

/** ONE append-only audit row for a created branch (company-wide event: sucursalId null). */
export async function registrarAuditSucursalCreadaEnTx(
  tx: PrismaTx,
  ctx: TenantCtx,
  sucursal: SucursalGestionable,
): Promise<void> {
  await registrarEventoAuditoriaEnTx(tx, ctx, {
    accion: ACCION_AUDITORIA.CREAR,
    entidad: "Sucursal",
    idEntidad: String(sucursal.id),
    sucursalId: null,
    valorNuevo: JSON.stringify({
      nombre: sucursal.nombre,
      direccion: sucursal.direccion,
      telefono: sucursal.telefono,
    }),
  });
}

/** ONE append-only audit row for an edited branch: before/after of the changed fields only. */
export async function registrarAuditSucursalActualizadaEnTx(
  tx: PrismaTx,
  ctx: TenantCtx,
  sucursalId: number,
  antes: Partial<DatosSucursal>,
  despues: Partial<DatosSucursal>,
): Promise<void> {
  await registrarEventoAuditoriaEnTx(tx, ctx, {
    accion: ACCION_AUDITORIA.ACTUALIZAR,
    entidad: "Sucursal",
    idEntidad: String(sucursalId),
    sucursalId: null,
    valorAnterior: JSON.stringify(antes),
    valorNuevo: JSON.stringify(despues),
  });
}
