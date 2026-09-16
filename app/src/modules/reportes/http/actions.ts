/**
 * Reportes Server Action — thin HTTP adapter for the role-aware dashboard (DB-1..DB-6).
 *
 * The whole action is the SAME three steps and NOTHING more (zero business logic), mirroring
 * `auditoria/http/actions.ts` and `cobros/http/actions.ts`:
 *   1. Zod-parse the payload → stable `VALIDATION_ERROR` on a bad SHAPE (the dashboard has
 *      no business filter, so this is a no-op guard the later report actions share).
 *   2. Resolve the tenant context from the Supabase session — an AUTH read, not tenant-DB
 *      access, so it precedes the wrapper (venta/devolucion convention).
 *   3. Inside `withTenantTransaction`: delegate to the `consultarDashboard` use case, which
 *      owns the server-side role gate (DB-2 — it refuses an unauthorized actor BEFORE any
 *      aggregate and applies the ratified company-wide widen for Admin, DB-4) and forward
 *      its typed result.
 *
 * A consultation writes NO audit event (DB-6): there is no `registrarEventoAuditoria` call
 * anywhere in the reportes module — reading a report is not a significant write. Every read
 * is tenant-pinned + RLS-scoped inside the wrapper (DB-3), and only stable catalog codes
 * cross this boundary — Prisma/DB errors never leak to the client (AGENTS.md "Never expose
 * stack traces or internal Prisma errors"). No `withTenantTransaction` call sits outside a
 * wrapper, so the project-local ESLint rule `systemfact/server-action-must-wrap-tenant`
 * passes.
 */

"use server";

import { createClient } from "@/lib/supabase/client";
import { withTenantTransaction } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import { getCurrentTenantContext } from "@/modules/tenant/infrastructure/tenant-runtime";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import type { ReporteErrorCode } from "../domain/errors";
import { ReporteDomainError } from "../domain/errors";
import type { DashboardVista } from "../domain/dashboard";
import { consultarDashboard } from "../application/consultar-dashboard";
import {
  REPORTE_ID,
  type ReporteId,
} from "../domain/catalogo";
import {
  normalizarFiltro,
  type ReporteFiltro,
  type ReporteFiltroEntrada,
} from "../domain/reporte-filtro";
import type { Pagina, ReportResult } from "../domain/reporte-resultado";
import type {
  EstadoFacturaCelda,
  InventarioValorizadoFila,
  ProductoVendidoFila,
  VentasPeriodoFila,
} from "../domain/operacional";
import {
  consultarEstadoFacturas,
  consultarInventarioValorizado,
  consultarProductosVendidos,
  consultarVentasPorPeriodo,
} from "../application/operacional";
import {
  SESION_INVALIDA,
  VALIDATION_ERROR,
  mensajeTransporte,
  zDashboardInput,
  zReporteFiltroInput,
} from "./validations";

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

function ok<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}

function fail(
  code: ReportesAccionesErrorCode,
  message: string,
): ActionResult<never> {
  return { ok: false, error: { code, message } };
}

/** The tenant context comes from the Supabase session (auth read), not the DB. */
async function resolverCtx() {
  const supabase = await createClient();
  return getCurrentTenantContext(supabase);
}

/**
 * Loads the current SD-period dashboard for the acting user. The role gate, the admin
 * company-wide widen and the CxC reuse all live in the use case; this adapter only wires
 * session → tenant transaction → delegation.
 */
export async function consultarDashboardAction(
  input?: unknown,
): Promise<ActionResult<DashboardVista>> {
  const parsed = zDashboardInput.safeParse(input ?? {});
  if (!parsed.success) {
    return fail(VALIDATION_ERROR, mensajeTransporte(VALIDATION_ERROR));
  }

  const ctx = await resolverCtx();
  if (ctx === null) {
    return fail(SESION_INVALIDA, mensajeTransporte(SESION_INVALIDA));
  }

  return withTenantTransaction(ctx, async (tx) => {
    const result = await consultarDashboard(tx, ctx, {});
    if (!result.ok) return fail(result.code, result.message);
    return ok(result.data);
  });
}

/**
 * The shared operational-consultation adapter (OP-6). The WHOLE flow is transport + wiring,
 * zero business logic:
 *   1. Zod-parse the transport shape (a `YYYY-MM-DD` SD date, positive-int page/sucursalId).
 *   2. `normalizarFiltro` (the shared DB-5 domain contract) resolves the SD window, presets,
 *      the 25/100 clamp and REJECTS a `desde > hasta` range with `REPORTE_VALIDACION` —
 *      BEFORE the tenant transaction opens, so an invalid range never queries (OP-6).
 *   3. Resolve the session ctx, then inside `withTenantTransaction` delegate to the report
 *      use case (which owns the server-side role gate + admin widen, DB-2/DB-4) and forward
 *      its typed `Pagina`. Only stable catalog codes cross this boundary; a Prisma/DB error
 *      PROPAGATES to the Next action layer and is never translated into a business code here.
 */
async function consultarReporteOperativo<T>(
  input: unknown,
  usarCaso: (
    tx: PrismaTx,
    ctx: TenantCtx,
    filtro: ReporteFiltro,
  ) => Promise<ReportResult<Pagina<T>>>,
): Promise<ActionResult<Pagina<T>>> {
  const parsed = zReporteFiltroInput.safeParse(input ?? {});
  if (!parsed.success) {
    return fail(VALIDATION_ERROR, mensajeTransporte(VALIDATION_ERROR));
  }

  const entrada: ReporteFiltroEntrada = parsed.data;
  let filtro: ReporteFiltro;
  try {
    filtro = normalizarFiltro(entrada);
  } catch (e) {
    if (e instanceof ReporteDomainError) {
      return fail(e.code, e.message);
    }
    throw e;
  }

  const ctx = await resolverCtx();
  if (ctx === null) {
    return fail(SESION_INVALIDA, mensajeTransporte(SESION_INVALIDA));
  }

  return withTenantTransaction(ctx, async (tx) => {
    const result = await usarCaso(tx, ctx, filtro);
    if (!result.ok) return fail(result.code, result.message);
    return ok(result.data);
  });
}

/** OP-1 — Ventas por período (confirmed sales grouped by SD calendar day). */
export function consultarVentasPorPeriodoAction(
  input?: unknown,
): Promise<ActionResult<Pagina<VentasPeriodoFila>>> {
  return consultarReporteOperativo(input, consultarVentasPorPeriodo);
}

/** OP-2 — Productos más/menos vendidos (units-ranked, monto secondary). */
export function consultarProductosVendidosAction(
  input?: unknown,
): Promise<ActionResult<Pagina<ProductoVendidoFila>>> {
  return consultarReporteOperativo(input, consultarProductosVendidos);
}

/** OP-3 — Inventario actual / valorizado por sucursal. */
export function consultarInventarioValorizadoAction(
  input?: unknown,
): Promise<ActionResult<Pagina<InventarioValorizadoFila>>> {
  return consultarReporteOperativo(input, consultarInventarioValorizado);
}

/** OP-4 — Estado de facturas (estado × tipoNcf grid + derived payment state). */
export function consultarEstadoFacturasAction(
  input?: unknown,
): Promise<ActionResult<Pagina<EstadoFacturaCelda>>> {
  return consultarReporteOperativo(input, consultarEstadoFacturas);
}

/** The report ids the slice-B operational actions serve (deep-link dispatch for the shell). */
export const ACCIONES_OPERATIVAS: Readonly<
  Partial<Record<ReporteId, (input?: unknown) => Promise<ActionResult<unknown>>>>
> = {
  [REPORTE_ID.VENTAS]: consultarVentasPorPeriodoAction,
  [REPORTE_ID.PRODUCTOS]: consultarProductosVendidosAction,
  [REPORTE_ID.INVENTARIO]: consultarInventarioValorizadoAction,
  [REPORTE_ID.FACTURAS]: consultarEstadoFacturasAction,
};
