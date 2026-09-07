import { z } from "zod";

export const zCrearCategoriaInput = z.object({
  nombre: z.string().trim().min(1).max(255),
});

export type CrearCategoriaInputDto = z.infer<typeof zCrearCategoriaInput>;

export const zListarCategoriasQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  incluirInactivas: z.coerce.boolean().default(false),
});

export type ListarCategoriasQueryDto = z.infer<typeof zListarCategoriasQuery>;

// CAT-004 partial edit (task 5.1): `nombre` is typed optional — it is the
// single editable field of the patch — but a patch without any editable field
// is rejected here, mirroring Producto's "at least one editable field" refine.
export const zActualizarCategoriaInput = z
  .object({
    id: z.number().int().positive(),
    version: z.number().int().positive(),
    nombre: z.string().trim().min(1).max(255).optional(),
  })
  .refine((input) => input.nombre !== undefined, {
    message: "Se requiere al menos un campo editable",
  });

export type ActualizarCategoriaInputDto = z.infer<typeof zActualizarCategoriaInput>;

export const zDesactivarCategoriaInput = z.object({
  id: z.number().int().positive(),
});

export type DesactivarCategoriaInputDto = z.infer<typeof zDesactivarCategoriaInput>;
