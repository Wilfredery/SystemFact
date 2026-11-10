import { z } from "@/lib/zod";

export const zCrearProductoInput = z.object({
  categoriaId: z.number().int().positive(),
  codigo: z.string().trim().min(1).max(255),
  nombre: z.string().trim().min(1).max(255),
  descripcion: z.string().trim().max(255).optional(),
  // Unidad de presentación (Libra, Unidad, Caja...). Opcional: la pantalla la
  // ofrece, pero un cliente anterior puede seguir creando sin ella.
  unidadMedida: z.string().trim().max(255).optional(),
  // Decimal(12,2): hasta 10 dígitos enteros + 2 decimales. El bound de magnitud
  // evita que un monto de 20 dígitos pase zod y explote al llegar a la BD.
  precioVenta: z
    .string()
    .regex(/^\d{1,10}(\.\d{1,2})?$/, "Monto inválido (máx 10 enteros y 2 decimales)"),
  itbisTasa: z.enum(["0", "16", "18"]),
  // La pantalla no expone la fecha de vigencia: si no llega, el adaptador usa el
  // instante de creación. Un cliente que la envía conserva el control total.
  itbisVigenteDesde: z.coerce.date().optional(),
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

// Consulta filtrada de la pantalla de Productos (plan Step 2). `estado` cubre
// activos/inactivos/todos; los llamadores anteriores siguen usando
// `incluirInactivos` en el caso de uso.
export const zConsultarProductosQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  busqueda: z.string().trim().optional(),
  categoriaId: z.coerce.number().int().positive().optional(),
  estado: z.enum(["activos", "inactivos", "todos"]).default("activos"),
});

export type ConsultarProductosQueryDto = z.infer<typeof zConsultarProductosQuery>;

export const zObtenerProductoPorIdInput = z.object({
  id: z.number().int().positive(),
});

export type ObtenerProductoPorIdInputDto = z.infer<typeof zObtenerProductoPorIdInput>;

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
  "unidadMedida",
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
    unidadMedida: z.string().trim().max(255).optional(),
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
