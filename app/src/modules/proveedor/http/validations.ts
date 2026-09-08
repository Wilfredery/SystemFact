import { z } from "zod";
import { TIPO_PROVEEDOR, TIPO_PERSONA } from "../domain/proveedor";

// The fiscal classifications travel as their frozen literal values; the zod
// enums mirror the domain unions, so loose strings die at the boundary.
const zTipoProveedor = z.enum([TIPO_PROVEEDOR.FORMAL, TIPO_PROVEEDOR.INFORMAL]);
const zTipoPersona = z.enum([TIPO_PERSONA.FISICA, TIPO_PERSONA.JURIDICA]);

// RNC FORMAT is NOT checked here: normalization and the 9–11-digit rule are
// domain logic (normalizeRnc), surfaced as RNC_FORMATO_INVALIDO by the use
// case. Zod only bounds the transport (trimmed, sane length).
export const zCrearProveedorInput = z.object({
  nombre: z.string().trim().min(1).max(255),
  contacto: z.string().trim().min(1).max(255),
  telefono: z.string().trim().min(1).max(255),
  rnc: z.string().trim().min(1).max(255).nullish(),
  tipoProveedor: zTipoProveedor,
  tipoPersona: zTipoPersona,
});

export type CrearProveedorInputDto = z.infer<typeof zCrearProveedorInput>;

export const zListarProveedoresQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  buscar: z.string().trim().min(1).max(100).optional(),
  incluirInactivos: z.coerce.boolean().default(false),
});

export type ListarProveedoresQueryDto = z.infer<typeof zListarProveedoresQuery>;

// PRV-EDIT partial edit: `rnc` distinguishes absent (keep), null (clear) and
// a new string (normalize + uniqueness probe); a patch without any editable
// field is rejected here, mirroring the Categoria "at least one field" refine.
export const zActualizarProveedorInput = z
  .object({
    id: z.number().int().positive(),
    version: z.number().int().positive(),
    nombre: z.string().trim().min(1).max(255).optional(),
    contacto: z.string().trim().min(1).max(255).optional(),
    telefono: z.string().trim().min(1).max(255).optional(),
    rnc: z.string().trim().min(1).max(255).nullable().optional(),
    tipoProveedor: zTipoProveedor.optional(),
    tipoPersona: zTipoPersona.optional(),
  })
  .refine(
    (input) =>
      input.nombre !== undefined ||
      input.contacto !== undefined ||
      input.telefono !== undefined ||
      input.rnc !== undefined ||
      input.tipoProveedor !== undefined ||
      input.tipoPersona !== undefined,
    { message: "Se requiere al menos un campo editable" },
  );

export type ActualizarProveedorInputDto = z.infer<
  typeof zActualizarProveedorInput
>;

export const zDesactivarProveedorInput = z.object({
  id: z.number().int().positive(),
});

export type DesactivarProveedorInputDto = z.infer<
  typeof zDesactivarProveedorInput
>;
