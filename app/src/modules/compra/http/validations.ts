/**
 * Compra HTTP input validation (Zod).
 *
 * Zod owns the transport contract only: literal fiscal enums, integer ids,
 * Decimal-string shapes bounded to the column precision (cantidad `Decimal
 * (12,3)`, costoUnitario `Decimal(12,2)`), pagination bounds and the mandatory
 * cancel motivo. Business rules (rate ∈ {18,16,0}, product ownership, supplier
 * class, retention applicability) stay in the domain/application and surface as
 * stable codes — the transport layer must not second-guess them.
 */

import { z } from "zod";
import { TIPO_COMPRA, TIPO_NCF_COMPRA } from "../domain/compra";

const zTipoCompra = z.enum([
  TIPO_COMPRA.MERCANCIA,
  TIPO_COMPRA.SERVICIO_PROFESIONAL,
  TIPO_COMPRA.SERVICIO_TECNICO,
  TIPO_COMPRA.ALQUILER,
]);

const zTipoNcfCompra = z.enum([TIPO_NCF_COMPRA.B01, TIPO_NCF_COMPRA.B11]);

// Base-unit quantity: up to 9 integer digits and 3 decimals (Decimal(12,3)).
const zCantidad = z.string().regex(/^\d{1,9}(\.\d{1,3})?$/, "cantidad inválida");
// Unit cost: non-negative, up to 9 integer digits and 2 decimals (Decimal(12,2)).
const zCostoUnitario = z
  .string()
  .regex(/^\d{1,9}(\.\d{1,2})?$/, "costoUnitario inválido");

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
  ncf: z.string().trim().min(1).max(255).nullish(),
  tipoNcf: zTipoNcfCompra.nullish(),
  lineas: z.array(zLineaInput).min(1),
});
export type CrearCompraInputDto = z.infer<typeof zCrearCompraInput>;

// Draft edit: full line replacement; supplier is not editable.
export const zActualizarCompraInput = z.object({
  id: z.number().int().positive(),
  ncf: z.string().trim().min(1).max(255).nullable().optional(),
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
