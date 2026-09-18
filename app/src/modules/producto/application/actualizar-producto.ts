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

/**
 * Table-driven declaration of one editable producto field: how to read the
 * incoming value, the stored value, compare them for equality, and format the
 * audit value. `key` is the shared UPDATE-payload/audit column name (it can
 * differ from the input property name, e.g. `itbisTasa` → `tasaItbis`).
 *
 * `leerInput` never null-coalesces, so the builder keeps `undefined` (skip the
 * field) distinct from `null` (clear it) — the R-QC-02 null-vs-undefined
 * contract. `iguales`/`formatearAuditoria` are field-specific so Decimal,
 * Date and scalar comparison/format stay correct.
 */
interface CampoEdicionProducto {
  readonly key: keyof ActualizarProductoData;
  readonly leerInput: (input: ActualizarProductoInput) => unknown;
  readonly leerActual: (actual: Producto) => unknown;
  readonly iguales: (a: unknown, b: unknown) => boolean;
  readonly formatearAuditoria: (value: unknown) => unknown;
}

const igualesScalar = (a: unknown, b: unknown): boolean => a === b;
const igualesDecimal = (a: unknown, b: unknown): boolean =>
  (a as Decimal).equals(b as Decimal);
const igualesFecha = (a: unknown, b: unknown): boolean =>
  mismaFecha(a as Date | null, b as Date | null);

const formatoIdentidad = (value: unknown): unknown => value;
const formatoDecimal = (value: unknown): unknown =>
  value === null || value === undefined ? null : (value as Decimal).toString();
const formatoFecha = (value: unknown): unknown =>
  value === null || value === undefined ? null : (value as Date).toISOString();

const CAMPOS_EDICION_PRODUCTO: readonly CampoEdicionProducto[] = [
  { key: "nombre", leerInput: (i) => i.nombre, leerActual: (p) => p.nombre, iguales: igualesScalar, formatearAuditoria: formatoIdentidad },
  { key: "descripcion", leerInput: (i) => i.descripcion, leerActual: (p) => p.descripcion, iguales: igualesScalar, formatearAuditoria: formatoIdentidad },
  { key: "precioVenta", leerInput: (i) => i.precioVenta, leerActual: (p) => p.precioVenta, iguales: igualesDecimal, formatearAuditoria: formatoDecimal },
  { key: "tasaItbis", leerInput: (i) => i.itbisTasa, leerActual: (p) => p.itbis.tasa, iguales: igualesScalar, formatearAuditoria: formatoIdentidad },
  { key: "itbisVigenteDesde", leerInput: (i) => i.itbisVigenteDesde, leerActual: (p) => p.itbis.vigenteDesde, iguales: igualesFecha, formatearAuditoria: formatoFecha },
  { key: "itbisVigenteHasta", leerInput: (i) => i.itbisVigenteHasta, leerActual: (p) => p.itbis.vigenteHasta, iguales: igualesFecha, formatearAuditoria: formatoFecha },
  { key: "itbisAplicaRetencionITBIS", leerInput: (i) => i.itbisAplicaRetencionITBIS, leerActual: (p) => p.itbis.aplicaRetencionITBIS, iguales: igualesScalar, formatearAuditoria: formatoIdentidad },
  { key: "codigo", leerInput: (i) => i.codigo, leerActual: (p) => p.codigo, iguales: igualesScalar, formatearAuditoria: formatoIdentidad },
  { key: "categoriaId", leerInput: (i) => i.categoriaId, leerActual: (p) => p.categoriaId, iguales: igualesScalar, formatearAuditoria: formatoIdentidad },
];

/**
 * Pure builder: turns the input into the UPDATE payload plus the old/new audit
 * diff of only the genuinely-changed fields. A field present as `undefined` is
 * skipped entirely (neither patched nor audited); a field present as `null`
 * (or any value) is always written, but recorded in the audit only when it
 * differs from the stored value.
 */
function construirPatchYDif(
  actual: Producto,
  input: ActualizarProductoInput,
  campos: readonly CampoEdicionProducto[],
): {
  data: ActualizarProductoData;
  antiguos: Record<string, unknown>;
  nuevos: Record<string, unknown>;
} {
  const data: ActualizarProductoData = {};
  const payload = data as Record<string, unknown>;
  const antiguos: Record<string, unknown> = {};
  const nuevos: Record<string, unknown> = {};

  for (const campo of campos) {
    const valor = campo.leerInput(input);
    if (valor === undefined) continue;
    payload[campo.key] = valor;
    const anterior = campo.leerActual(actual);
    if (!campo.iguales(anterior, valor)) {
      antiguos[campo.key] = campo.formatearAuditoria(anterior);
      nuevos[campo.key] = campo.formatearAuditoria(valor);
    }
  }

  return { data, antiguos, nuevos };
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
  if (!current?.producto.activo) {
    // Inactive rows are not editable and a foreign-tenant id looks identical
    // to a missing one: no cross-tenant disclosure (REQ-PROD-013). Optional
    // chaining also satisfies S6582 (`current === null || !....activo`).
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

  // Build the UPDATE payload plus the old/new audit diff of changed fields via
  // the table-driven pure helper (undefined skips, null writes, audit only on a
  // real change). This lowers cognitive complexity without touching the
  // undefined-vs-null semantics locked by the golden tests.
  const { data, antiguos, nuevos } = construirPatchYDif(
    actual,
    input,
    CAMPOS_EDICION_PRODUCTO,
  );

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
