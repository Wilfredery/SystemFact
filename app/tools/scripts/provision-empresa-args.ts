/**
 * Pure argument validation for `provision-empresa.ts` (operator procedure that
 * creates a company; odd/tasks/multi-company-codigo.md S2/S3, C1/C2/C4).
 *
 * No DB, no filesystem, no process access: everything the script needs to know
 * BEFORE it opens a connection is decided here so it can be unit tested.
 * The password is never an argument: it is read by the caller from the env var
 * `ADMIN_PASSWORD` and only its length is checked here.
 */

import {
  CODIGO_EMPRESA_REGEX,
  validarNombreUsuarioNuevo,
} from "@/modules/auth/domain/nombre-usuario";
import { validarRnc } from "@/shared/domain/fiscal-id";

/** Largest consecutive the frozen R-N2 `%08d` NCF composition can encode (same as seed-ncf.ts). */
export const NCF_MAX_CONSECUTIVO_PROVISION = 99_999_999;

/** Same floor the Supabase Auth policy enforces at sign-in (docs: app/USER-PROVISIONING.md). */
export const ADMIN_PASSWORD_MIN_LONGITUD_PROVISION = 12;

export const TIPOS_NCF_PROVISION = ["B01", "B02", "B03", "B04", "B11"] as const;
export type TipoNcfProvision = (typeof TIPOS_NCF_PROVISION)[number];

export interface RangoNcfProvision {
  readonly tipoNcf: TipoNcfProvision;
  readonly rangoInicio: number;
  readonly rangoFin: number;
  readonly vigenciaInicio: Date;
  readonly vigenciaFin: Date;
}

export interface ArgsProvision {
  /** Upper-case, validated against CODIGO_EMPRESA_REGEX. */
  readonly codigo: string;
  readonly nombreComercial: string;
  /** Digits only, mod-11 valid. */
  readonly rnc: string;
  readonly sucursal: string;
  /** Part AFTER the prefix, as typed by the operator. */
  readonly adminUsuario: string;
  /** Canonical `<CODIGO>-<resto>`. */
  readonly adminNombreUsuario: string;
  readonly rangosArchivo: string;
  readonly apply: boolean;
}

export type ResultadoArgs =
  | { readonly ok: true; readonly value: ArgsProvision }
  | { readonly ok: false; readonly errors: readonly string[] };

const FLAGS_CON_VALOR = [
  "--codigo",
  "--nombre-comercial",
  "--rnc",
  "--sucursal",
  "--admin-usuario",
  "--ncf-file",
] as const;
type FlagConValor = (typeof FLAGS_CON_VALOR)[number];

/** Flags that would carry a secret on the command line: refused with a pointer to the env var. */
const FLAGS_SECRETO = ["--password", "--admin-password", "--contrasena", "--clave"];

/**
 * Parses and validates the CLI arguments plus the password length.
 * Collects every problem so the operator fixes them in one pass.
 */
export function validarArgsProvision(
  argv: readonly string[],
  contrasena: string | undefined,
): ResultadoArgs {
  const errors: string[] = [];
  const valores = new Map<FlagConValor, string>();
  let apply = false;

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i] ?? "";
    const [flag, inline] = token.includes("=") ? splitFirst(token, "=") : [token, undefined];
    if (flag === "--apply") {
      if (inline !== undefined) errors.push("--apply does not take a value.");
      apply = true;
      continue;
    }
    if (FLAGS_SECRETO.includes(flag)) {
      errors.push(`${flag} is refused: the password is read from the ADMIN_PASSWORD env var only.`);
      continue;
    }
    if ((FLAGS_CON_VALOR as readonly string[]).includes(flag)) {
      const clave = flag as FlagConValor;
      let valor = inline;
      if (valor === undefined) {
        const siguiente = argv[i + 1];
        if (siguiente === undefined || siguiente.startsWith("--")) {
          errors.push(`${flag} needs a value.`);
          continue;
        }
        valor = siguiente;
        i++;
      }
      if (valores.has(clave)) errors.push(`${flag} was given more than once.`);
      valores.set(clave, valor);
      continue;
    }
    errors.push(`Unknown argument "${flag}".`);
  }

  const requerido = (flag: FlagConValor): string => {
    const v = valores.get(flag)?.trim();
    if (v === undefined || v === "") {
      errors.push(`${flag} is required.`);
      return "";
    }
    return v;
  };

  const codigoCrudo = requerido("--codigo");
  const nombreComercial = requerido("--nombre-comercial");
  const rncCrudo = requerido("--rnc");
  const sucursal = requerido("--sucursal");
  const adminUsuario = requerido("--admin-usuario");
  const rangosArchivo = requerido("--ncf-file");

  const codigo = codigoCrudo.toUpperCase();
  if (codigoCrudo !== "" && !CODIGO_EMPRESA_REGEX.test(codigo)) {
    errors.push(`--codigo "${codigoCrudo}" is invalid: 3 to 6 characters A-Z0-9 (case-insensitive input).`);
  }

  let rnc = "";
  if (rncCrudo !== "") {
    const r = validarRnc(rncCrudo);
    if (r.ok) rnc = r.value;
    else errors.push(`--rnc "${rncCrudo}" is not a valid 9-digit RNC.`);
  }

  let adminNombreUsuario = "";
  if (adminUsuario !== "" && CODIGO_EMPRESA_REGEX.test(codigo)) {
    if (adminUsuario.toUpperCase().startsWith(`${codigo}-`)) {
      errors.push(
        `--admin-usuario takes only the part AFTER the prefix ("${codigo}-" is added for you); got "${adminUsuario}".`,
      );
    } else {
      const v = validarNombreUsuarioNuevo(codigo, `${codigo}-${adminUsuario}`);
      if (v.ok) adminNombreUsuario = v.nombreUsuario;
      else errors.push(`--admin-usuario "${adminUsuario}" is invalid: ${v.message} (${v.code}).`);
    }
  }

  if (contrasena === undefined || contrasena.length === 0) {
    errors.push("ADMIN_PASSWORD env var is not set (never pass the password as an argument).");
  } else if (contrasena.length < ADMIN_PASSWORD_MIN_LONGITUD_PROVISION) {
    errors.push(`ADMIN_PASSWORD must be at least ${String(ADMIN_PASSWORD_MIN_LONGITUD_PROVISION)} characters.`);
  }

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      codigo,
      nombreComercial,
      rnc,
      sucursal,
      adminUsuario,
      adminNombreUsuario,
      rangosArchivo,
      apply,
    },
  };
}

function splitFirst(texto: string, sep: string): [string, string] {
  const idx = texto.indexOf(sep);
  return [texto.slice(0, idx), texto.slice(idx + sep.length)];
}

export type ResultadoRangos =
  | { readonly ok: true; readonly rangos: readonly RangoNcfProvision[] }
  | { readonly ok: false; readonly errors: readonly string[] };

/**
 * Validates the parsed JSON of the NCF ranges file: an array of objects
 * `{ tipoNcf, rangoInicio, rangoFin, vigenciaInicio, vigenciaFin }` (ISO dates).
 * Nothing is defaulted: the ranges are the company's OWN DGII authorization.
 */
export function validarRangosNcf(json: unknown): ResultadoRangos {
  const errors: string[] = [];
  if (!Array.isArray(json) || json.length === 0) {
    return { ok: false, errors: ["NCF file must be a non-empty JSON array of ranges."] };
  }
  const rangos: RangoNcfProvision[] = [];
  const vistos = new Set<string>();
  json.forEach((item: unknown, idx: number) => {
    const etiqueta = `ranges[${String(idx)}]`;
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      errors.push(`${etiqueta} must be an object.`);
      return;
    }
    const o = item as Record<string, unknown>;
    const tipo = o["tipoNcf"];
    if (typeof tipo !== "string" || !(TIPOS_NCF_PROVISION as readonly string[]).includes(tipo)) {
      errors.push(`${etiqueta}.tipoNcf must be one of ${TIPOS_NCF_PROVISION.join(", ")}.`);
      return;
    }
    if (vistos.has(tipo)) {
      errors.push(`${etiqueta}.tipoNcf "${tipo}" is duplicated (one range per type).`);
      return;
    }
    vistos.add(tipo);
    const inicio = o["rangoInicio"];
    const fin = o["rangoFin"];
    if (
      typeof inicio !== "number" ||
      typeof fin !== "number" ||
      !Number.isInteger(inicio) ||
      !Number.isInteger(fin) ||
      inicio < 1 ||
      fin > NCF_MAX_CONSECUTIVO_PROVISION ||
      fin < inicio
    ) {
      errors.push(
        `${etiqueta} (${tipo}): rangoInicio/rangoFin must be integers with 1 <= inicio <= fin <= ${String(NCF_MAX_CONSECUTIVO_PROVISION)}.`,
      );
      return;
    }
    const desde = parseFechaIso(o["vigenciaInicio"]);
    const hasta = parseFechaIso(o["vigenciaFin"]);
    if (desde === null || hasta === null || hasta.getTime() <= desde.getTime()) {
      errors.push(`${etiqueta} (${tipo}): vigenciaInicio/vigenciaFin must be ISO dates with fin after inicio.`);
      return;
    }
    rangos.push({
      tipoNcf: tipo as TipoNcfProvision,
      rangoInicio: inicio,
      rangoFin: fin,
      vigenciaInicio: desde,
      vigenciaFin: hasta,
    });
  });
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, rangos };
}

function parseFechaIso(valor: unknown): Date | null {
  if (typeof valor !== "string" || !/^\d{4}-\d{2}-\d{2}(T[\d:.]+Z?)?$/.test(valor)) return null;
  const d = new Date(valor);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Exactly what `--apply` would create; printed by the dry run. Never includes the password. */
export function describirPlanProvision(
  args: ArgsProvision,
  rangos: readonly RangoNcfProvision[],
  extra: { readonly itbis: string; readonly claves: readonly string[]; readonly roles: readonly string[] },
): string {
  const lineasRangos = rangos.map(
    (r) =>
      `    ${r.tipoNcf}  ${String(r.rangoInicio)}-${String(r.rangoFin)}  valid ${r.vigenciaInicio.toISOString().slice(0, 10)} .. ${r.vigenciaFin.toISOString().slice(0, 10)}  (secuenciaActual ${String(r.rangoInicio - 1)})`,
  );
  return [
    "Would create (nothing is written without --apply):",
    `  EMPRESA        codigo=${args.codigo} nombreComercial="${args.nombreComercial}" rnc=${args.rnc} activa=true`,
    `  SUCURSAL       "${args.sucursal}"`,
    `  ROL            find-or-create: ${extra.roles.join(", ")}`,
    `  CONFIGURACION  ${extra.claves.join(", ")}  (ITBIS ${extra.itbis})`,
    "  NCF_SECUENCIA  the company's OWN ranges from the JSON file:",
    ...lineasRangos,
    `  USUARIO        ${args.adminNombreUsuario} (rol Administrador, authUserId bound on first login)`,
    `  auth.users     ${args.adminNombreUsuario.toLowerCase()}@users.systemfact.internal (password from ADMIN_PASSWORD, never printed)`,
    "  AUDITORIA      one MOVIMIENTO_AUDITORIA row (CREAR EMPRESA)",
  ].join("\n");
}
