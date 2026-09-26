/**
 * Compra HTTP input validation (Zod).
 *
 * Zod owns the transport contract only: literal fiscal enums, integer ids,
 * Decimal-string shapes bounded to the column precision (cantidad `Decimal
 * (12,3)`, costoUnitario `Decimal(12,2)`), pagination bounds and the mandatory
 * cancel motivo. Business rules (rate ∈ {18,16,0}, product ownership, supplier
 * class, retention applicability) stay in the domain/application and surface as
 * stable codes — the transport layer must not second-guess them.
 *
 * The NCF field is the one shape a domain INVARIANT (not a rule invented here)
 * is applied to: `NCF_COMPRA_REGEX` is imported from `domain/compra` and merely
 * enforced at the boundary, so the grammar has exactly one definition in the
 * codebase. Its former `.min(1).max(255)` was a no-op length bound (the column is
 * `VarChar(255)`) and did not constrain the value's shape.
 */

import { z } from "zod";
import {
  NCF_COMPRA_REGEX,
  TIPO_COMPRA,
  TIPO_NCF_COMPRA,
  type TipoCompra,
  type TipoNcfCompra,
} from "../domain/compra";
import { RE_CANTIDAD, RE_COSTO_UNITARIO } from "../domain/calculators";

// Enums derived from the domain literals so adding a fiscal value can never
// silently desync the transport (the same no-drift goal as RE_CANTIDAD above).
const zTipoCompra = z.enum(
  Object.values(TIPO_COMPRA) as [TipoCompra, ...TipoCompra[]],
);

const zTipoNcfCompra = z.enum(
  Object.values(TIPO_NCF_COMPRA) as [TipoNcfCompra, ...TipoNcfCompra[]],
);

// Base-unit quantity and unit cost: the exact `Decimal(12,3)` / `Decimal(12,2)`
// width rules live in the domain (`RE_CANTIDAD` / `RE_COSTO_UNITARIO`) so the
// two layers can never drift again — the transport only re-applies them here.
const zCantidad = z.string().regex(RE_CANTIDAD, "cantidad inválida");
const zCostoUnitario = z.string().regex(RE_COSTO_UNITARIO, "costoUnitario inválido");

const zLineaInput = z.object({
  productoId: z.number().int().positive(),
  cantidad: zCantidad,
  costoUnitario: zCostoUnitario,
});

export const zCrearCompraInput = z.object({
  proveedorId: z.number().int().positive(),
  tipoCompra: zTipoCompra,
  fecha: z.coerce.date().refine((d) => !Number.isNaN(d.getTime()), {
    message: "fecha inválida",
  }),
  // Optional until receipt; when present it MUST satisfy the domain NCF grammar
  // (11 positions: B01/B11 + an 8-digit consecutive). Anchored, so this also pins the
  // length that the column's VarChar(255) never enforced and rejects interior control
  // characters (CR/LF/TAB) that would desync the 606 fixed-width record layout.
  ncf: z.string().trim().regex(NCF_COMPRA_REGEX, "ncf inválido").nullish(),
  tipoNcf: zTipoNcfCompra.nullish(),
  lineas: z.array(zLineaInput).min(1),
});
export type CrearCompraInputDto = z.infer<typeof zCrearCompraInput>;

// Draft edit: full line replacement; supplier is not editable.
export const zActualizarCompraInput = z.object({
  id: z.number().int().positive(),
  // Same NCF grammar as the create schema (draft edit); null/omitted keeps the field absent.
  ncf: z.string().trim().regex(NCF_COMPRA_REGEX, "ncf inválido").nullable().optional(),
  tipoNcf: zTipoNcfCompra.nullable().optional(),
  lineas: z.array(zLineaInput).min(1),
});
export type ActualizarCompraInputDto = z.infer<typeof zActualizarCompraInput>;

export const zConfirmarCompraInput = z.object({
  id: z.number().int().positive(),
});
export type ConfirmarCompraInputDto = z.infer<typeof zConfirmarCompraInput>;

// Motivo is mandatory (trimmed non-empty); the use case double-checks.
export const zCancelarCompraInput = z.object({
  id: z.number().int().positive(),
  motivo: z.string().trim().min(1).max(255),
});
export type CancelarCompraInputDto = z.infer<typeof zCancelarCompraInput>;

// Receipt: identifies the purchase only. State/branch guards are the use case's
// job (server-side), not the transport's.
export const zRecibirCompraInput = z.object({
  id: z.number().int().positive(),
});
export type RecibirCompraInputDto = z.infer<typeof zRecibirCompraInput>;

export const zListarComprasQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  // max 100 is the hard pagination ceiling (19-directivas §Performance).
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type ListarComprasQueryDto = z.infer<typeof zListarComprasQuery>;

export const zObtenerCompraInput = z.object({
  id: z.number().int().positive(),
});
export type ObtenerCompraInputDto = z.infer<typeof zObtenerCompraInput>;
