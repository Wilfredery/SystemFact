/**
 * `/reportes/exportar-txt` — the server-side DGII TXT file response (FIS-6, EXP-3/EXP-4/EXP-5;
 * slice E).
 *
 * A GET route handler (not a Server Action) so the browser downloads a `.TXT` directly and the fiscal
 * panel stays interactive — generation runs server-side in ONE response (EXP-3). It is DEEP-LINKABLE:
 * it parses the SAME `/reportes?reporte&desde&hasta&sucursalId` contract through `ui/url.ts` and
 * re-runs the SAME canonical fiscal pipeline the panel does — session ctx → `normalizarFiltro` →
 * role gate → `generarTxtReporte` (the shared dispatcher routing to the 606/607/608 exporter, each
 * reusing the identical gate/widen/aggregate, EXP-4). A `parte` param selects which split file of a
 * >cap period to download (deterministic split — FIS-6).
 *
 * THE BYTES: the domain assembles the fixed-width body; this route applies the U1 encoding seam via
 * `infrastructure/dgii-writer.txtBuffer` (UTF-8/ASCII, NO BOM) and sets `Content-Disposition` to the
 * DGII filename (`DGII_F_<code>_<RNC>_<AAAAMM>.TXT`). It NEVER emits an IT-1 TXT — that is a summary
 * served by the CSV seam (FIS-2), and a non-DGII `reporte` id is denied before any read.
 *
 * Security mirrors the CSV route exactly: no ctx → 401; every read inside `withTenantTransaction`
 * (empresaId pinned + RLS, DB-3); a denied role → 403 with the SAME stable code as consultation;
 * an invalid range → 400 pre-query; no path reaches `MovimientoAuditoria` (EXP-4).
 */

import { createClient } from "@/lib/supabase/client";
import { withTenantTransaction } from "@/modules/tenant/infrastructure/withTenantTransaction";
import { getCurrentTenantContext } from "@/modules/tenant/infrastructure/tenant-runtime";
import { generarTxtReporte } from "@/modules/reportes/application/fiscal";
import {
  normalizarFiltro,
  type ReporteFiltro,
} from "@/modules/reportes/domain/reporte-filtro";
import { ReporteDomainError, REPORTE_NO_AUTORIZADO } from "@/modules/reportes/domain/errors";
import { esReporteId, type ReporteId } from "@/modules/reportes/domain/catalogo";
import {
  SESION_INVALIDA,
  mensajeTransporte,
} from "@/modules/reportes/http/validations";
import { txtBuffer, CONTENT_TYPE_DGII_TXT } from "@/modules/reportes/infrastructure/dgii-writer";

/** Map `URLSearchParams` onto the plain record `seleccionDesdeSearchParams` consumes (first-wins). */
function aRegistro(sp: URLSearchParams): Record<string, string> {
  const registro: Record<string, string> = {};
  for (const [clave, valor] of sp.entries()) {
    if (!(clave in registro)) registro[clave] = valor;
  }
  return registro;
}

/** The requested split-file index (`parte`, 1-based, floored at 1); a non-DGII id never reaches here. */
function enteroPositivo(valor: string | undefined): number {
  if (valor === undefined) return 1;
  const n = Number(valor);
  return Number.isInteger(n) && n >= 1 ? n : 1;
}

export async function GET(request: Request): Promise<Response> {
  const supabase = await createClient();
  const ctx = await getCurrentTenantContext(supabase);
  if (ctx === null) {
    return Response.json(
      { ok: false, error: { code: SESION_INVALIDA, message: mensajeTransporte(SESION_INVALIDA) } },
      { status: 401 },
    );
  }

  const sp = new URL(request.url).searchParams;
  const registro = aRegistro(sp);
  const rawReporte = registro.reporte;
  const reporte: ReporteId | null = esReporteId(rawReporte) ? rawReporte : null;

  // This route serves ONLY the three DGII TXT formats; anything else (a summary / dashboard) is a
  // wrong-route request, denied with the SAME code the fiscal exporters use (EXP-4 deny-by-default).
  if (
    reporte !== "dgii-606" &&
    reporte !== "dgii-607" &&
    reporte !== "dgii-608"
  ) {
    return Response.json(
      { ok: false, error: { code: REPORTE_NO_AUTORIZADO, message: "Este reporte no se exporta como TXT DGII." } },
      { status: 403 },
    );
  }

  const parte = enteroPositivo(registro.parte);

  let normalizado: ReporteFiltro;
  try {
    normalizado = normalizarFiltro({
      desde: registro.desde,
      hasta: registro.hasta,
      preset: registro.preset,
      sucursalId: enteroPositivoOrNull(registro.sucursalId),
    });
  } catch (e) {
    if (e instanceof ReporteDomainError) {
      return Response.json({ ok: false, error: { code: e.code, message: e.message } }, { status: 400 });
    }
    throw e;
  }

  return withTenantTransaction(ctx, async (tx) => {
    const resultado = await generarTxtReporte(tx, ctx, reporte, normalizado);
    if (!resultado.ok) {
      const status = resultado.code === REPORTE_NO_AUTORIZADO ? 403 : 400;
      return Response.json(
        { ok: false, error: { code: resultado.code, message: resultado.message } },
        { status },
      );
    }
    const { partes, cantidadArchivos } = resultado.data;
    // A `parte` past the available parts serves the last file (deterministic; the panel links each).
    const indice = Math.min(Math.max(1, parte), cantidadArchivos) - 1;
    const archivo = partes[indice];
    // `txtBuffer` returns a Node Buffer (UTF-8, no BOM, U1); wrap as a Uint8Array for a valid BodyInit.
    return new Response(new Uint8Array(txtBuffer(archivo.txt)), {
      status: 200,
      headers: {
        "Content-Type": CONTENT_TYPE_DGII_TXT,
        "Content-Disposition": `attachment; filename="${archivo.filename}"`,
        "Cache-Control": "no-store",
      },
    });
  });
}

/** A positive-int param or `null` (an absent/invalid branch drops the filter, never the tenant pin). */
function enteroPositivoOrNull(valor: string | undefined): number | null {
  if (valor === undefined || valor === "") return null;
  const n = Number(valor);
  return Number.isInteger(n) && n >= 1 ? n : null;
}
