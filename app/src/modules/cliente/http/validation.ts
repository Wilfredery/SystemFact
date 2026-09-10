import { z } from "zod";
import { TIPO_CLIENTE } from "../domain/cliente";

// Fiscal classification travels as its frozen literal; the zod enum mirrors the
// domain union so loose strings die at the boundary.
const zTipoCliente = z.enum([
  TIPO_CLIENTE.MINORISTA,
  TIPO_CLIENTE.MAYORISTA,
  TIPO_CLIENTE.CREDITO,
]);

// Fiscal-ID FORMAT is NOT validated here: normalization + the mod-11 check are
// domain-owned (shared `fiscal-id`), surfaced by the use case as
// IDENTIFICACION_FISCAL_INVALIDA / CREDITO_REQUIERE_FISCAL_IDENTIDAD. Zod only
// bounds the transport (trimmed, sane length). `null` is a legitimate stored
// value (Consumidor Final / unverified), so the field is nullish.
export const zCrearClienteInput = z.object({
  nombre: z.string().trim().min(1).max(255),
  telefono: z.string().trim().min(1).max(255),
  direccion: z.string().trim().min(1).max(255),
  identificacionFiscal: z.string().trim().min(1).max(255).nullish(),
  tipoCliente: zTipoCliente,
  // Credit fields are transport-bounded only; the cross-field credit⇒RNC rule
  // is domain logic. `limiteCredito` is a `Decimal(12,2)` STRING — never a
  // float on the wire (money precision, AGENTS.md).
  creditoHabilitado: z.boolean().optional(),
  limiteCredito: z
    .string()
    .regex(/^\d{1,10}(\.\d{1,2})?$/, "Monto decimal inválido")
    .optional(),
  plazoCreditoDias: z.number().int().min(1).optional(),
});

export type CrearClienteInputDto = z.infer<typeof zCrearClienteInput>;

export const zObtenerClienteInput = z.object({
  id: z.number().int().positive(),
});

export type ObtenerClienteInputDto = z.infer<typeof zObtenerClienteInput>;

export const zListarClientesQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  buscar: z.string().trim().min(1).max(100).optional(),
  incluirInactivos: z.coerce.boolean().default(false),
});

export type ListarClientesQueryDto = z.infer<typeof zListarClientesQuery>;

// Partial edit: `identificacionFiscal` distinguishes absent (keep) from null
// (clear) from a new string (normalize + uniqueness probe). A patch without any
// editable field is rejected here (mirrors the proveedor "at least one" refine).
// Credit fields ride the SAME command — the action layers an Administrador-only
// gate over them server-side (design "Credit authorization").
export const zActualizarClienteInput = z
  .object({
    id: z.number().int().positive(),
    version: z.number().int().positive(),
    nombre: z.string().trim().min(1).max(255).optional(),
    telefono: z.string().trim().min(1).max(255).optional(),
    direccion: z.string().trim().min(1).max(255).optional(),
    identificacionFiscal: z.string().trim().min(1).max(255).nullable().optional(),
    tipoCliente: zTipoCliente.optional(),
    creditoHabilitado: z.boolean().optional(),
    limiteCredito: z
      .string()
      .regex(/^\d{1,10}(\.\d{1,2})?$/, "Monto decimal inválido")
      .optional(),
    plazoCreditoDias: z.number().int().min(1).optional(),
  })
  .refine(
    (input) =>
      input.nombre !== undefined ||
      input.telefono !== undefined ||
      input.direccion !== undefined ||
      input.identificacionFiscal !== undefined ||
      input.tipoCliente !== undefined ||
      input.creditoHabilitado !== undefined ||
      input.limiteCredito !== undefined ||
      input.plazoCreditoDias !== undefined,
    { message: "Se requiere al menos un campo editable" },
  );

export type ActualizarClienteInputDto = z.infer<typeof zActualizarClienteInput>;

export const zDesactivarClienteInput = z.object({
  id: z.number().int().positive(),
});

export type DesactivarClienteInputDto = z.infer<typeof zDesactivarClienteInput>;
