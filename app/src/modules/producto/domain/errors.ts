export const CODIGO_PRODUCTO_DUPLICADO = "CODIGO_PRODUCTO_DUPLICADO";
export const TASA_ITBIS_INVALIDA = "TASA_ITBIS_INVALIDA";
export const PRECIO_BASE_INVALIDO = "PRECIO_BASE_INVALIDO";
export const VIGENCIA_INVALIDA = "VIGENCIA_INVALIDA";
export const LIMITE_PAGINACION_INVALIDO = "LIMITE_PAGINACION_INVALIDO";
export const PAGINA_INVALIDA = "PAGINA_INVALIDA";
export const CANTIDAD_INVALIDA = "CANTIDAD_INVALIDA";
export const NO_AUTORIZADO = "NO_AUTORIZADO";
export const SESION_INVALIDA = "SESION_INVALIDA";
export const CATEGORIA_INVALIDA = "CATEGORIA_INVALIDA";
export const VALIDATION_ERROR = "VALIDATION_ERROR";

export type ProductoErrorCode =
  | typeof CODIGO_PRODUCTO_DUPLICADO
  | typeof TASA_ITBIS_INVALIDA
  | typeof PRECIO_BASE_INVALIDO
  | typeof VIGENCIA_INVALIDA
  | typeof LIMITE_PAGINACION_INVALIDO
  | typeof PAGINA_INVALIDA
  | typeof CANTIDAD_INVALIDA
  | typeof NO_AUTORIZADO
  | typeof SESION_INVALIDA
  | typeof CATEGORIA_INVALIDA
  | typeof VALIDATION_ERROR;

const MESSAGES: Record<ProductoErrorCode, string> = {
  [CODIGO_PRODUCTO_DUPLICADO]: "Ya existe un producto con ese código en la empresa",
  [TASA_ITBIS_INVALIDA]: "La tasa de ITBIS debe ser 0%, 16% o 18%",
  [PRECIO_BASE_INVALIDO]: "El precio base debe ser un monto mayor o igual a cero con hasta 2 decimales",
  [VIGENCIA_INVALIDA]: "La fecha de vigencia hasta no puede ser menor que la fecha desde",
  [LIMITE_PAGINACION_INVALIDO]: "El límite de paginación debe estar entre 1 y 100",
  [PAGINA_INVALIDA]: "La página debe ser mayor o igual a 1",
  [CANTIDAD_INVALIDA]: "La cantidad debe ser mayor o igual a cero",
  [NO_AUTORIZADO]: "No tiene permisos para realizar esta acción",
  [SESION_INVALIDA]: "Sesión no válida o expirada",
  [CATEGORIA_INVALIDA]: "La categoría no existe en la empresa",
  [VALIDATION_ERROR]: "Datos de entrada inválidos",
};

export function messageFor(code: ProductoErrorCode): string {
  return MESSAGES[code];
}

export class ProductoDomainError extends Error {
  readonly code: ProductoErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(code: ProductoErrorCode, details?: Record<string, unknown>) {
    super(messageFor(code));
    this.code = code;
    this.details = details;
  }
}
