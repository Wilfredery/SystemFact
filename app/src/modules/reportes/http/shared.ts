import type { ReporteErrorCode } from "../domain/errors";
import { SESION_INVALIDA, VALIDATION_ERROR } from "./validations";

/** Composed action error surface: reportes business catalog ∪ transport codes. */
export type ReportesAccionesErrorCode =
  | ReporteErrorCode
  | typeof VALIDATION_ERROR
  | typeof SESION_INVALIDA;

export type ActionResult<T> =
  | { readonly ok: true; readonly data: T }
  | {
      readonly ok: false;
      readonly error: {
        readonly code: ReportesAccionesErrorCode;
        readonly message: string;
      };
    };

export function ok<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}

export function fail(
  code: ReportesAccionesErrorCode,
  message: string,
): ActionResult<never> {
  return { ok: false, error: { code, message } };
}
