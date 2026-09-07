import { z } from "zod";

export const zCrearProductoInput = z.object({
  categoriaId: z.number().int().positive(),
  codigo: z.string().trim().min(1).max(255),
  nombre: z.string().trim().min(1).max(255),
  descripcion: z.string().trim().max(255).optional(),
  // Decimal(12,2): hasta 10 dígitos enteros + 2 decimales. El bound de magnitud
  // evita que un monto de 20 dígitos pase zod y explote al llegar a la BD.
  precioVenta: z
    .string()
    .regex(/^\d{1,10}(\.\d{1,2})?$/, "Monto inválido (máx 10 enteros y 2 decimales)"),
  itbisTasa: z.enum(["0", "16", "18"]),
  itbisVigenteDesde: z.coerce.date(),
  itbisVigenteHasta: z.coerce.date().nullable().optional(),
  itbisAplicaRetencionITBIS: z.boolean().default(false),
});

export type CrearProductoInputDto = z.infer<typeof zCrearProductoInput>;

export const zListarProductosQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  descripcion: z.string().trim().optional(),
  incluirInactivos: z.coerce.boolean().default(false),
});

export type ListarProductosQueryDto = z.infer<typeof zListarProductosQuery>;

// Campos editables del patch parcial (REQ-PROD-011). `id` y `version` son
// obligatorios pero NO cuentan como campo editable: el patch debe traer al
// menos uno de estos para ser una edición significativa.
const CAMPOS_EDITABLES = [
  "nombre",
  "descripcion",
  "precioVenta",
  "itbisTasa",
  "itbisVigenteDesde",
  "itbisVigenteHasta",
  "itbisAplicaRetencionITBIS",
  "codigo",
  "categoriaId",
] as const;

export const zActualizarProductoInput = z
  .object({
    id: z.number().int().positive(),
    version: z.number().int().positive(),
    nombre: z.string().trim().min(1).max(255).optional(),
    // null = limpiar descripción; undefined = preservar (semántica de patch).
    descripcion: z.string().trim().max(255).nullish(),
    // Mismo bound Decimal(12,2) que la creación: máx 10 enteros + 2 decimales.
    precioVenta: z
      .string()
      .regex(/^\d{1,10}(\.\d{1,2})?$/, "Monto inválido (máx 10 enteros y 2 decimales)")
      .optional(),
    itbisTasa: z.enum(["0", "16", "18"]).optional(),
    itbisVigenteDesde: z.coerce.date().optional(),
    itbisVigenteHasta: z.coerce.date().nullable().optional(),
    itbisAplicaRetencionITBIS: z.boolean().optional(),
    codigo: z.string().trim().min(1).max(255).optional(),
    categoriaId: z.number().int().positive().optional(),
  })
  .refine(
    (input) =>
      CAMPOS_EDITABLES.some((campo) => input[campo] !== undefined),
    { message: "Se requiere al menos un campo editable" },
  );

export type ActualizarProductoInputDto = z.infer<typeof zActualizarProductoInput>;

export const zDesactivarProductoInput = z.object({
  id: z.number().int().positive(),
});

export type DesactivarProductoInputDto = z.infer<typeof zDesactivarProductoInput>;
