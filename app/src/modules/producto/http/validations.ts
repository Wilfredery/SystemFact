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
