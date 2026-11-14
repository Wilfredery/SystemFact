/**
 * `/api/caja/cierre-pdf` — the server-side PDF of the day's close (S4, docs/19:167).
 *
 * A GET route handler (not a Server Action) so "Exportar PDF" is a plain, deep-linkable download:
 * the browser receives `application/pdf` in ONE response generated server-side, with no client JS
 * and no external network (pdfkit's built-in standard fonts only, so nothing is read from disk).
 *
 * The pipeline is the SAME one the /caja screen runs, in the same order, so the document and the
 * screen can never disagree:
 *
 *   session ctx → withTenantTransaction → role gate (`ROLES_VER_CAJA`, server-side)
 *               → `consultarCierreDiario` (the one use case that owns the SD day + aggregates)
 *               → `construirCierrePdf` (pure projection: labels and formats from the screen's own
 *                 helpers)
 *
 * Security, identical to the read actions and the export routes: no session → 401 JSON; a denied
 * role → 403 with the catalog's `CAJA_NO_AUTORIZADO` BEFORE any aggregate runs (deny-by-default —
 * hiding the button is not the control); a typed use-case refusal → a coded JSON failure, never a
 * PDF. Every DB read happens inside the tenant transaction (empresaId pinned + RLS).
 *
 * There is no query parameter: the close is always TODAY in America/Santo_Domingo and the scope is
 * the session's empresa + sucursal, so a retroactive date or a branch override has no way in (S1).
 */

import { createClient } from "@/lib/supabase/client";
import { withTenantTransaction } from "@/modules/tenant/infrastructure/withTenantTransaction";
import { getCurrentTenantHeader } from "@/modules/tenant/infrastructure/tenant-runtime";
import { tieneRolPermitidoEnTx } from "@/modules/venta/infrastructure/venta-repository";
import { consultarCierreDiario } from "@/modules/caja/application/consultar-cierre-diario";
import { CAJA_NO_AUTORIZADO, messageFor } from "@/modules/caja/domain/errors";
import { ROLES_VER_CAJA } from "@/modules/caja/http/shared";
import { etiquetaAlcance } from "@/modules/caja/ui/caja-formato";
import { SESION_INVALIDA, mensajeTransporte } from "@/modules/caja/http/validations";
import { construirCierrePdf } from "./cierre-pdf";

// PDF bytes come from pdfkit (Node streams/fs): the route must run on the Node runtime.
export const runtime = "nodejs";
// Always reflect the current day's data: never cache an export.
export const dynamic = "force-dynamic";

/** The coded JSON refusal every non-PDF outcome speaks (same envelope as the Caja actions). */
function negativa(status: number, code: string, message: string): Response {
  return Response.json({ ok: false, error: { code, message } }, { status });
}

export async function GET(): Promise<Response> {
  const supabase = await createClient();
  // The display names the PDF prints come from the SAME header read the /caja page uses; its
  // result is a superset of TenantCtx, so transaction/gate/use case need nothing else.
  const ctx = await getCurrentTenantHeader(supabase);
  if (ctx === null) {
    return negativa(401, SESION_INVALIDA, mensajeTransporte(SESION_INVALIDA));
  }

  return withTenantTransaction(ctx, async (tx) => {
    const permitido = await tieneRolPermitidoEnTx(
      tx,
      ctx.usuarioId,
      ctx.empresaId,
      ROLES_VER_CAJA,
    );
    if (!permitido) {
      return negativa(403, CAJA_NO_AUTORIZADO, messageFor(CAJA_NO_AUTORIZADO));
    }

    const resultado = await consultarCierreDiario(tx, ctx);
    if (!resultado.ok) {
      // A typed business refusal (e.g. an impossible SD day) is never served as an empty PDF.
      return negativa(400, resultado.code, resultado.message);
    }

    const pdf = await construirCierrePdf({
      cierre: resultado.data,
      // The SAME scope label the /caja page renders: company-wide for an Administrador, whose
      // figures the use case widens past the session branch.
      alcanceNombre: etiquetaAlcance({
        esAdmin: ctx.esAdmin,
        empresaNombre: ctx.empresaNombre,
        sucursalNombre: ctx.sucursalNombre,
      }),
    });

    // `construirCierrePdf` returns a Node Buffer; wrap it as a plain ArrayBufferView so it is a
    // valid `BodyInit` and the bytes ship exactly as generated.
    return new Response(new Uint8Array(pdf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="cierre-caja-${resultado.data.fechaSD}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  });
}
