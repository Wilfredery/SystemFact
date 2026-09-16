/**
 * Reportes infrastructure — the DGII fiscal PERIOD-PARAMETER readers (U3, B02 threshold;
 * slice E, tasks 5.1/5.2).
 *
 * AGENTS.md "Parameters from DB, never hardcoded constants" applies to the fiscal exports too: the
 * 607 B02 consumption-detail threshold and the 607 D5 Tipo-Ingreso code table are read from
 * `ConfiguracionEmpresa` exactly like `reportes/config-repository.ts` reads `PLAZO_CREDITO` and
 * `venta/infrastructure/config-repository.ts` reads `DESC_MAX` — ACTIVE row whose validity window
 * covers `now`, deterministic newest-`vigenciaInicio` tie-break (R-V17), value grammar validated,
 * inside the caller's `withTenantTransaction` (RLS) with `empresaId` pinned (defense in depth).
 * `CONFIGURACION_EMPRESA` is empresa-anchored, so it reads identically whether the branch GUC is
 * pinned or widened (the 607/606 company-wide export path).
 *
 * WHY A STATUTORY DEFAULT (unlike the venta READER, which throws on a missing key): the RD$250,000
 * B02 detail threshold and the "graviada general" income class are FIXED values set by DGII norms
 * (Norma 10-18; Anexo B), NOT tenant business policy — so a tenant that has not configured them
 * still gets the STATUTORY value ({@link UMBRAL_CONSUMO_607_ESTATUTARIO} / the domain's
 * `TIPO_INGRESO_POR_DEFECTO`), while the DB key lets a future norm change be a DATA edit with zero
 * code change. This mirrors the "safe default per mapping table in config" the task names for U3.
 */

import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { MapaTipoIngreso } from "../domain/dgii/tipo-ingreso";

/** `ConfiguracionEmpresa.clave` for the 607 B02 consumption-detail threshold. */
const CLAVE_UMBRAL_CONSUMO_607 = "UMBRAL_CONSUMO_607";
/** `ConfiguracionEmpresa.clave` for the 607 D5 Tipo-Ingreso code table (a JSON map). */
const CLAVE_TIPO_INGRESO_607 = "DGII_TIPO_INGRESO_607";

/**
 * The STATUTORY B02 threshold when the tenant configured none: RD$250,000.00 inclusive, per
 * Norma 10-18 (research §3). A documented legal default, overridable by the DB key — never an
 * arbitrary business constant. Returned as a `Decimal(12,2)` string.
 */
export const UMBRAL_CONSUMO_607_ESTATUTARIO = "250000.00";

/**
 * Load the tenant's 607 B02 consumption-detail threshold (gross total ≥ this earns a 607 row),
 * or the statutory default when no active/conforming row exists. A non-negative `Decimal(12,2)`
 * grammar is enforced; a malformed value is treated as "not configured" (fall back), never guessed.
 */
export async function leerUmbralConsumo607EnTx(
  tx: PrismaTx,
  empresaId: number,
  now: Date,
): Promise<string> {
  const row = await tx.configuracionEmpresa.findFirst({
    where: {
      empresaId,
      clave: CLAVE_UMBRAL_CONSUMO_607,
      activa: true,
      vigenciaInicio: { lte: now },
      vigenciaFin: { gte: now },
    },
    orderBy: { vigenciaInicio: "desc" },
    select: { valor: true },
  });
  if (row === null) return UMBRAL_CONSUMO_607_ESTATUTARIO;
  const trimmed = row.valor.trim();
  if (!/^\d{1,12}(\.\d{1,2})?$/.test(trimmed)) return UMBRAL_CONSUMO_607_ESTATUTARIO;
  return trimmed;
}

/**
 * Load the tenant's 607 D5 Tipo-Ingreso code table (a JSON object keyed on document class → DGII
 * income code), or an empty map when unconfigured/unparseable (the domain resolver then applies
 * its single documented default). The table itself is research-UNVERIFIED (U3), so this is the
 * config seam the pre-validation tool confirms; parsing failure NEVER invents a code.
 */
export async function leerMapaTipoIngreso607EnTx(
  tx: PrismaTx,
  empresaId: number,
  now: Date,
): Promise<MapaTipoIngreso> {
  const row = await tx.configuracionEmpresa.findFirst({
    where: {
      empresaId,
      clave: CLAVE_TIPO_INGRESO_607,
      activa: true,
      vigenciaInicio: { lte: now },
      vigenciaFin: { gte: now },
    },
    orderBy: { vigenciaInicio: "desc" },
    select: { valor: true },
  });
  if (row === null) return {};
  try {
    const parsed: unknown = JSON.parse(row.valor);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const mapa: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === "string") mapa[k] = v;
      else if (typeof v === "number") mapa[k] = String(v);
    }
    return mapa;
  } catch {
    return {};
  }
}

/**
 * Load the remitter's RNC for the DGII header (research §8: the company RNC, dashes stripped, never
 * blank — a DGII file with a blank `RNC_CEDULA` is rejected). Returns the separator-stripped digits;
 * the caller MUST refuse the export when this is empty (a tenant with no RNC cannot file).
 */
export async function leerRncEmpresaEnTx(
  tx: PrismaTx,
  empresaId: number,
): Promise<string> {
  const empresa = await tx.empresa.findFirst({
    where: { id: empresaId },
    select: { rnc: true },
  });
  if (empresa === null) return "";
  // DGII RNC_CEDULA must never contain dashes/special chars (research §2 field rule).
  return empresa.rnc.replace(/[\s-]/g, "");
}
