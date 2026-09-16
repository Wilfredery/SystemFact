/**
 * `/reportes/exportar` — the server-side CSV file response (EXP-3, EXP-5; slice B).
 *
 * A GET route handler (not a Server Action) so the browser downloads a file directly and the
 * consultation screen stays interactive — generation runs server-side in ONE response, no
 * client-side loop over fetched pages (EXP-3). It is DEEP-LINKABLE: it parses the SAME
 * `/reportes?reporte&desde&hasta&sucursalId&...` contract through `ui/url.ts` and re-runs the
 * SAME canonical pipeline the screen does — session ctx → `normalizarFiltro` → role gate →
 * `generarCsvOperativo` (which reuses the identical gate/widen/query, EXP-4). The CSV carries
 * the FULL filtered dataset independent of screen pagination (EXP-2).
 *
 * Security: the tenant context is resolved from the Supabase session (an auth read); no ctx →
 * 401. Every DB read is inside `withTenantTransaction` (empresaId pinned + RLS, DB-3). A denied
 * role gets 403 with the SAME stable code as consultation (`REPORTE_NO_AUTORIZADO`) — an export
 * bypass is structurally impossible because the gate code path is shared, not duplicated. An
 * invalid range is rejected pre-query (400). No path here touches `MovimientoAuditoria`.
 */

import { createClient } from "@/lib/supabase/client";
import { withTenantTransaction } from "@/modules/tenant/infrastructure/withTenantTransaction";
import { getCurrentTenantContext } from "@/modules/tenant/infrastructure/tenant-runtime";
import { generarCsvOperativo } from "@/modules/reportes/application/exportar-operativos";
import {
  normalizarFiltro,
  type ReporteFiltro,
} from "@/modules/reportes/domain/reporte-filtro";
import { ReporteDomainError, REPORTE_NO_AUTORIZADO } from "@/modules/reportes/domain/errors";
import {
  SESION_INVALIDA,
  mensajeTransporte,
} from "@/modules/reportes/http/validations";
import {
  CONTENT_TYPE_CSV,
  csvBuffer,
} from "@/modules/reportes/infrastructure/csv-writer";
import { seleccionDesdeSearchParams } from "@/modules/reportes/ui/url";

/**
 * Map `URLSearchParams` onto the plain record `seleccionDesdeSearchParams` consumes. On a
 * repeated key we KEEP THE FIRST occurrence (mirroring `url.ts`'s `primero`, which reads
 * `array[0]`) so the route and the screen resolve a duplicate query param identically — the
 * export is the exact same filtered view, never a last-wins divergence (EXP-5).
 */
function aRegistro(sp: URLSearchParams): Record<string, string> {
  const registro: Record<string, string> = {};
  for (const [clave, valor] of sp.entries()) {
    if (!(clave in registro)) registro[clave] = valor;
  }
  return registro;
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

  const { reporte, filtro } = seleccionDesdeSearchParams(
    aRegistro(new URL(request.url).searchParams),
  );

  // Resolve + validate the shared filter contract BEFORE opening the tenant transaction, so an
  // invalid range never reaches a query (OP-6, identical to the consult actions).
  let normalizado: ReporteFiltro;
  try {
    normalizado = normalizarFiltro(filtro);
  } catch (e) {
    if (e instanceof ReporteDomainError) {
      return Response.json(
        { ok: false, error: { code: e.code, message: e.message } },
        { status: 400 },
      );
    }
    throw e;
  }

  return withTenantTransaction(ctx, async (tx) => {
    const resultado = await generarCsvOperativo(tx, ctx, reporte, normalizado);
    if (!resultado.ok) {
      // A role refusal is 403; every other stable business code (e.g. an invalid range) is 400.
      const status = resultado.code === REPORTE_NO_AUTORIZADO ? 403 : 400;
      return Response.json(
        { ok: false, error: { code: resultado.code, message: resultado.message } },
        { status },
      );
    }
    const { filename, csv } = resultado.data;
    // `csvBuffer` returns a Node Buffer (UTF-8, no BOM); wrap as a plain ArrayBufferView so it
    // is a valid `BodyInit` and the byte stream (no-BOM, deterministic) is exactly what ships.
    return new Response(new Uint8Array(csvBuffer(csv)), {
      status: 200,
      headers: {
        "Content-Type": CONTENT_TYPE_CSV,
        "Content-Disposition": `attachment; filename="${filename}"`,
        // No cache: an export must reflect the current filtered data (RLS-scoped).
        "Cache-Control": "no-store",
      },
    });
  });
}
