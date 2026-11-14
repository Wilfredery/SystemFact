import { z } from "@/lib/zod";
import { TIPOS_MOVIMIENTO } from "../domain/movimientos";

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
  // One-time id of the user's intention (the form generates a UUID). The server
  // dedupes on it per inventory row, so a retried request is applied once.
  requestId: z.string().min(8).max(255),
});

export type AjustarInventarioInputDto = z.infer<typeof zAjustarInventarioInput>;

// Inventario consulta screen: pagination + the three wireframe filters. Empty
// strings from a cleared form field count as "no filter".
// Largest value of a Postgres int4 id column: beyond it the database raises a
// range error, so it must be rejected here as a plain validation error.
const MAX_ID_INT4 = 2147483647;

const vacioAUndefined = (v: unknown) => (v === "" || v === null ? undefined : v);

export const zConsultarInventarioQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  busqueda: z.preprocess(vacioAUndefined, z.string().trim().max(100).optional()),
  categoriaId: z.preprocess(vacioAUndefined, z.coerce.number().int().positive().max(MAX_ID_INT4).optional()),
  estado: z.preprocess(
    vacioAUndefined,
    z.enum(["normal", "bajo_stock", "agotado"]).optional(),
  ),
});

export type ConsultarInventarioQueryDto = z.infer<typeof zConsultarInventarioQuery>;

// Movement history (odd/tasks/inventario-historial.md S1/S4). Shape only: the
// range rules (inverted, wider than 90 days, real calendar dates) belong to the
// domain. Cleared form fields (empty string / null) mean "no filter". `page` is
// bounded to int4 so `skip` stays a sane Postgres offset.
const FECHA_SD_RE = /^\d{4}-\d{2}-\d{2}$/;

export const zListarMovimientosQuery = z.object({
  page: z.coerce.number().int().min(1).max(MAX_ID_INT4).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  tipo: z.preprocess(vacioAUndefined, z.enum(TIPOS_MOVIMIENTO).optional()),
  producto: z.preprocess(vacioAUndefined, z.string().trim().max(100).optional()),
  desde: z.preprocess(vacioAUndefined, z.string().regex(FECHA_SD_RE).optional()),
  hasta: z.preprocess(vacioAUndefined, z.string().regex(FECHA_SD_RE).optional()),
});

export type ListarMovimientosQueryDto = z.infer<typeof zListarMovimientosQuery>;
