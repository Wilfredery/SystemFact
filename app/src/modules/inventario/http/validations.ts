import { z } from "zod";

// Pagination for the stock listing (spec: default 25, max 100). Coercion lets
// the action accept the string params a client may send.
export const zListarInventarioQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export type ListarInventarioQueryDto = z.infer<typeof zListarInventarioQuery>;

// Manual adjustment. `cantidad` is a SIGNED delta (negative reduces stock) as a
// bounded decimal string: an optional sign, up to 9 integer digits and 3
// decimals, matching the DB `Decimal(12,3)` column magnitude headroom. The sign
// is validated here for shape; the domain validators still guard the magnitude
// and the non-negative stock invariant downstream.
const CANTIDAD_RE = /^[+-]?\d{1,9}(\.\d{1,3})?$/;

export const zAjustarInventarioInput = z.object({
  productoId: z.number().int().positive(),
  cantidad: z
    .string()
    .regex(CANTIDAD_RE, "Cantidad inválida (máx 9 enteros y 3 decimales)"),
  motivo: z.string().trim().min(1).max(255),
});

export type AjustarInventarioInputDto = z.infer<typeof zAjustarInventarioInput>;
