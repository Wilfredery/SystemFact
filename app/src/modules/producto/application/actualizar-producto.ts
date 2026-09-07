import type { Prisma } from "@/generated/prisma/client";
import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import { Decimal } from "decimal.js";
import {
  PRODUCTO_NO_ENCONTRADO,
  CONCURRENCIA_CONFLICTO,
  CODIGO_PRODUCTO_DUPLICADO,
  TASA_ITBIS_INVALIDA,
  PRECIO_BASE_INVALIDO,
  VIGENCIA_INVALIDA,
  CATEGORIA_INVALIDA,
  VALIDATION_ERROR,
  messageFor,
  ProductoDomainError,
  type ProductoErrorCode,
} from "../domain/errors";
import {
  esTasaItbisValida,
  buildProductoItbis,
  type Producto,
  type TasaItbis,
} from "../domain/producto";
import {
  obtenerProductoPorId,
  existeCodigoEnEmpresa,
  actualizarProductoEnTx,
  registrarProductoActualizadoEnTx,
  type ActualizarProductoData,
} from "../infrastructure/producto-repository";
// Design D3 (fase-3-2): category ownership belongs to the Categoria module.
import { categoriaPerteneceAEmpresa } from "@/modules/categoria/infrastructure/categoria-repository";

/**
 * Partial-edit command (REQ-PROD-011). `id` + `version` identify the target
 * row and its expected state; every other field is an optional patch entry.
 */
export interface ActualizarProductoInput {
  readonly id: number;
  readonly version: number;
  readonly nombre?: string;
  readonly descripcion?: string | null;
  readonly precioVenta?: Prisma.Decimal;
  readonly itbisTasa?: TasaItbis;
  readonly itbisVigenteDesde?: Date;
  readonly itbisVigenteHasta?: Date | null;
  readonly itbisAplicaRetencionITBIS?: boolean;
  readonly codigo?: string;
  readonly categoriaId?: number;
}

export type ActualizarProductoResult =
  | { ok: true; producto: Producto; version: number }
  | { ok: false; code: ProductoErrorCode; message: string };

// Same Decimal(12,2) magnitude bound as creation: 10 integer digits + 2
// decimals. Duplicated instead of shared by explicit YAGNI decision
// (proposal: "Refactoring crear-producto.ts to shared validation helpers"
// is out of scope).
const MAGNITUD_MAX_PRECIO = new Decimal("10000000000");

function esPrecioValido(precio: Decimal): boolean {
  return (
    !precio.isNegative() &&
    precio.decimalPlaces() <= 2 &&
    precio.lt(MAGNITUD_MAX_PRECIO)
  );
}

function buildError(
  code: ProductoErrorCode,
): { ok: false; code: ProductoErrorCode; message: string } {
  return { ok: false, code, message: messageFor(code) };
}

const CAMPOS_EDITABLES: readonly (keyof ActualizarProductoInput)[] = [
  "nombre",
  "descripcion",
  "precioVenta",
  "itbisTasa",
  "itbisVigenteDesde",
  "itbisVigenteHasta",
  "itbisAplicaRetencionITBIS",
  "codigo",
  "categoriaId",
];

function tieneAlgunCampoEditable(input: ActualizarProductoInput): boolean {
  return CAMPOS_EDITABLES.some((campo) => input[campo] !== undefined);
}

function mismaFecha(a: Date | null, b: Date | null): boolean {
  if (a === null || b === null) return a === b;
  return a.getTime() === b.getTime();
}

export async function actualizarProducto(
  tx: PrismaTx,
  ctx: TenantCtx,
  input: ActualizarProductoInput,
): Promise<ActualizarProductoResult> {
  // Adapter-level zod enforces this too; the use case guards its own contract
  // because an empty patch would bump `version` without changing anything.
  if (!tieneAlgunCampoEditable(input)) {
    return buildError(VALIDATION_ERROR);
  }

  const current = await obtenerProductoPorId(tx, ctx.empresaId, input.id);
  if (current === null || !current.producto.activo) {
    // Inactive rows are not editable and a foreign-tenant id looks identical
    // to a missing one: no cross-tenant disclosure (REQ-PROD-013).
    return buildError(PRODUCTO_NO_ENCONTRADO);
  }
  const actual = current.producto;

  // Domain validation on supplied fields only; unchanged fields are preserved.
  if (input.itbisTasa !== undefined && !esTasaItbisValida(input.itbisTasa)) {
    return buildError(TASA_ITBIS_INVALIDA);
  }
  if (input.precioVenta !== undefined && !esPrecioValido(input.precioVenta)) {
    return buildError(PRECIO_BASE_INVALIDO);
  }
  try {
    buildProductoItbis({
      tasa: input.itbisTasa ?? actual.itbis.tasa,
      vigenteDesde: input.itbisVigenteDesde ?? actual.itbis.vigenteDesde,
      vigenteHasta:
        input.itbisVigenteHasta !== undefined
          ? input.itbisVigenteHasta
          : actual.itbis.vigenteHasta,
      aplicaRetencionITBIS:
        input.itbisAplicaRetencionITBIS ?? actual.itbis.aplicaRetencionITBIS,
    });
  } catch (err) {
    // Only the known vigencia violation becomes a typed result; anything
    // else is a defect and must propagate.
    if (err instanceof ProductoDomainError && err.code === VIGENCIA_INVALIDA) {
      return buildError(VIGENCIA_INVALIDA);
    }
    throw err;
  }

  // Uniqueness is probed only when the code actually changes; the edited row
  // itself is excluded so re-submitting its own code is a no-op.
  if (input.codigo !== undefined && input.codigo !== actual.codigo) {
    const duplicado = await existeCodigoEnEmpresa(
      tx,
      ctx.empresaId,
      input.codigo,
      input.id,
    );
    if (duplicado) {
      return buildError(CODIGO_PRODUCTO_DUPLICADO);
    }
  }

  if (input.categoriaId !== undefined && input.categoriaId !== actual.categoriaId) {
    const categoriaValida = await categoriaPerteneceAEmpresa(
      tx,
      ctx.empresaId,
      input.categoriaId,
    );
    if (!categoriaValida) {
      return buildError(CATEGORIA_INVALIDA);
    }
  }

  // Build the UPDATE payload plus the old/new audit diff of changed fields.
  const data: ActualizarProductoData = {};
  const antiguos: Record<string, unknown> = {};
  const nuevos: Record<string, unknown> = {};

  if (input.nombre !== undefined) {
    data.nombre = input.nombre;
    if (input.nombre !== actual.nombre) {
      antiguos.nombre = actual.nombre;
      nuevos.nombre = input.nombre;
    }
  }
  if (input.descripcion !== undefined) {
    data.descripcion = input.descripcion;
    if (input.descripcion !== actual.descripcion) {
      antiguos.descripcion = actual.descripcion;
      nuevos.descripcion = input.descripcion;
    }
  }
  if (input.precioVenta !== undefined) {
    data.precioVenta = input.precioVenta;
    if (!actual.precioVenta.equals(input.precioVenta)) {
      antiguos.precioVenta = actual.precioVenta.toString();
      nuevos.precioVenta = input.precioVenta.toString();
    }
  }
  if (input.itbisTasa !== undefined) {
    data.tasaItbis = input.itbisTasa;
    if (input.itbisTasa !== actual.itbis.tasa) {
      antiguos.tasaItbis = actual.itbis.tasa;
      nuevos.tasaItbis = input.itbisTasa;
    }
  }
  if (input.itbisVigenteDesde !== undefined) {
    data.itbisVigenteDesde = input.itbisVigenteDesde;
    if (!mismaFecha(input.itbisVigenteDesde, actual.itbis.vigenteDesde)) {
      antiguos.itbisVigenteDesde = actual.itbis.vigenteDesde.toISOString();
      nuevos.itbisVigenteDesde = input.itbisVigenteDesde.toISOString();
    }
  }
  if (input.itbisVigenteHasta !== undefined) {
    data.itbisVigenteHasta = input.itbisVigenteHasta;
    if (!mismaFecha(input.itbisVigenteHasta, actual.itbis.vigenteHasta)) {
      antiguos.itbisVigenteHasta = actual.itbis.vigenteHasta?.toISOString() ?? null;
      nuevos.itbisVigenteHasta = input.itbisVigenteHasta?.toISOString() ?? null;
    }
  }
  if (input.itbisAplicaRetencionITBIS !== undefined) {
    data.itbisAplicaRetencionITBIS = input.itbisAplicaRetencionITBIS;
    if (
      input.itbisAplicaRetencionITBIS !== actual.itbis.aplicaRetencionITBIS
    ) {
      antiguos.itbisAplicaRetencionITBIS = actual.itbis.aplicaRetencionITBIS;
      nuevos.itbisAplicaRetencionITBIS = input.itbisAplicaRetencionITBIS;
    }
  }
  if (input.codigo !== undefined) {
    data.codigo = input.codigo;
    if (input.codigo !== actual.codigo) {
      antiguos.codigo = actual.codigo;
      nuevos.codigo = input.codigo;
    }
  }
  if (input.categoriaId !== undefined) {
    data.categoriaId = input.categoriaId;
    if (input.categoriaId !== actual.categoriaId) {
      antiguos.categoriaId = actual.categoriaId;
      nuevos.categoriaId = input.categoriaId;
    }
  }

  let update;
  try {
    update = await actualizarProductoEnTx(
      tx,
      ctx.empresaId,
      input.id,
      // The optimistic lock is driven by the CLIENT-submitted version, not the
      // freshly-read DB version: `UPDATE ... WHERE version = input.version`
      // only matches while the row is still at the version the caller edited
      // against, so a stale submission yields { updated: false } (CRITICAL-1).
      input.version,
      data,
    );
  } catch (err) {
    // P2002 race on the partial unique (empresaId, codigo) maps to the
    // duplicate-code result; unexpected errors propagate untouched.
    if (
      err instanceof ProductoDomainError &&
      err.code === CODIGO_PRODUCTO_DUPLICADO
    ) {
      return buildError(CODIGO_PRODUCTO_DUPLICADO);
    }
    throw err;
  }
  if (!update.updated) {
    return buildError(CONCURRENCIA_CONFLICTO);
  }

  // Re-read inside the same transaction: the returned entity reflects the
  // committed state (including the bumped version), not a local guess.
  const refreshed = await obtenerProductoPorId(tx, ctx.empresaId, input.id);
  if (refreshed === null) {
    // Defensive: the row existed microseconds ago inside this transaction.
    return buildError(PRODUCTO_NO_ENCONTRADO);
  }

  // Audit runs only after the mutation succeeded, inside the same tx, so a
  // rolled-back edit persists neither change nor event (REQ-PROD-014).
  await registrarProductoActualizadoEnTx(
    tx,
    ctx,
    input.id,
    antiguos,
    nuevos,
  );

  return { ok: true, producto: refreshed.producto, version: update.newVersion };
}
