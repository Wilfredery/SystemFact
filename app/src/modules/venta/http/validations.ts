/**
 * Venta HTTP input validation (Zod) + transport error codes.
 *
 * Zod owns the TRANSPORT contract only: the frozen `DescuentoTipo` enum, integer
 * ids, Decimal-string shapes bounded to the column precision (cantidad
 * `Decimal(12,3)`, prices/discounts `Decimal(12,2)`), pagination bounds and the
 * mandatory ≥1 line. Business rules — rate ∈ {18,16,0}, product ownership, the
 * admin-only discount, the `DESC_MAX` cap, tenant/branch scoping — stay in the
 * domain/application and surface as stable codes; the transport layer must not
 * second-guess them and zod is NEVER the authorization authority.
 *
 * The three codes below are the HTTP/transport rejections (auth + malformed
 * payload). They are deliberately NOT in the venta DOMAIN catalog (R-V13 pins the
 * 14 business codes) — they live at the boundary, mirroring how the ESSENTIAL
 * distinction between "your session/role is wrong" and "your sale is invalid" is
 * kept out of the fiscal business rules.
 */

import { z } from "zod";
import { DESCUENTO_TIPO } from "../domain/venta";

/** Stable HTTP/transport codes (not part of the domain business catalog). */
export const VALIDATION_ERROR = "VALIDATION_ERROR";
export const SESION_INVALIDA = "SESION_INVALIDA";
export const NO_AUTORIZADO = "NO_AUTORIZADO";

const MENSAJES_TRANSPORTE: Record<string, string> = {
  [VALIDATION_ERROR]: "Datos de entrada inválidos",
  [SESION_INVALIDA]: "Sesión no válida o expirada",
  [NO_AUTORIZADO]: "No tiene permisos para realizar esta acción",
};

export function mensajeTransporte(code: string): string {
  return MENSAJES_TRANSPORTE[code] ?? "Error";
}

// --- shared primitives ---

const zDescuentoTipo = z.enum([DESCUENTO_TIPO.PORCENTAJE, DESCUENTO_TIPO.MONTO]);

// A discount value travels as a Decimal-compatible STRING: non-negative, up to
// 9 integer digits and 2 decimals. Money is NEVER a float on the wire.
const zDescuentoValor = z
  .string()
  .regex(/^\d{1,9}(\.\d{1,2})?$/, "descuentoValor inválido");

const zDescuento = z.object({
  descuentoTipo: zDescuentoTipo,
  descuentoValor: zDescuentoValor,
});

// Base-unit quantity: up to 9 integer digits and 3 decimals (Decimal(12,3)).
const zCantidad = z.string().regex(/^\d{1,9}(\.\d{1,3})?$/, "cantidad inválida");
// Unit price: non-negative, `Decimal(12,2)`, ITBIS-EXCLUSIVE net price.
const zPrecioUnitario = z
  .string()
  .regex(/^\d{1,9}(\.\d{1,2})?$/, "precioUnitario inválido");

const zLineaInput = z.object({
  productoId: z.number().int().positive(),
  cantidad: zCantidad,
  precioUnitario: zPrecioUnitario,
  descuento: zDescuento.default({
    descuentoTipo: DESCUENTO_TIPO.PORCENTAJE,
    descuentoValor: "0.00",
  }),
});

// A positive discount is accepted at the boundary for BOTH roles; the
// Administrador-only rule is re-enforced server-side in the use case (R-V8).
export const zCrearVentaInput = z.object({
  // null = contado → Consumidor Final via the 5a seam.
  clienteId: z.number().int().positive().nullable(),
  fecha: z.coerce.date().refine((d) => !Number.isNaN(d.getTime()), {
    message: "fecha inválida",
  }),
  lineas: z.array(zLineaInput).min(1),
  descuentoCabecera: zDescuento.optional(),
});
export type CrearVentaInputDto = z.infer<typeof zCrearVentaInput>;

// Draft edit: full line replacement + optional client re-selection.
export const zActualizarVentaInput = z.object({
  id: z.number().int().positive(),
  lineas: z.array(zLineaInput).min(1),
  // undefined keeps the current client; null switches to contado/CF.
  clienteId: z.number().int().positive().nullable().optional(),
  fecha: z.coerce.date().refine((d) => !Number.isNaN(d.getTime()), {
    message: "fecha inválida",
  }),
  descuentoCabecera: zDescuento.optional(),
});
export type ActualizarVentaInputDto = z.infer<typeof zActualizarVentaInput>;

// Cancel: motivo is OPTIONAL for a draft (it never had fiscal effect).
export const zCancelarVentaInput = z.object({
  id: z.number().int().positive(),
  motivo: z.string().trim().min(1).max(255).optional(),
});
export type CancelarVentaInputDto = z.infer<typeof zCancelarVentaInput>;

export const zListarVentasQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  // Hard pagination ceiling: size >100 is rejected HERE with a stable
  // validation error, so no unbounded query can execute (R-V12).
  limit: z.coerce.number().int().min(1).max(100).default(25),
  // 5b drafts only ever sit in BORRADOR/CANCELADA; CONFIRMADA is a 5c seam.
  estado: z.enum(["BORRADOR", "CANCELADA"]).optional(),
  soloMios: z.coerce.boolean().default(false),
});
export type ListarVentasQueryDto = z.infer<typeof zListarVentasQuery>;

export const zObtenerVentaInput = z.object({
  id: z.number().int().positive(),
});
export type ObtenerVentaInputDto = z.infer<typeof zObtenerVentaInput>;

// Confirm (R-V15): ONLY the sale id travels. The client, lines, rates, discounts
// and totals are re-derived server-side from the persisted draft; nothing is
// trusted from the wire (the server recomputes fiscally and emits the invoice).
export const zConfirmarVentaInput = z.object({
  id: z.number().int().positive(),
});
export type ConfirmarVentaInputDto = z.infer<typeof zConfirmarVentaInput>;
