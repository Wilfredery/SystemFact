/**
 * Reportes application — the CxC aging use case (FIN-1, FIN-2, FIN-3; slice C).
 *
 * A thin read orchestration (ADR-013) `(tx, ctx, filtro)` over the CANONICAL derived-balance
 * aggregate. It composes, never re-implements, the ratified pieces:
 *
 *   1. FIN-1 (canonical reuse, ADR-017): every per-invoice pending balance comes from
 *      `cobros/consultarSaldoCxcEnTx` verbatim. The report only filters its already-derived
 *      rows (`saldoPendiente > 0`) and applies the pure mora/aging rules — it NEVER recomputes
 *      `total − Σpagos − Σnotas` (a shared-query guard test proves byte-equal balances).
 *   2. FIN-3 (Cobrador = CxC family, own branch, server-enforced): the role gate reads the real
 *      DB roles first; a role that is neither Administrador nor Cobrador gets `REPORTE_NO_AUTORIZADO`
 *      with NO query (DB-2 "UI hiding is not the control"). A Cobrador's own branch is ALREADY the
 *      RLS-pinned GUC, so we run the canonical read with their ctx untouched and IGNORE any client
 *      `sucursalId` (no override is honoured).
 *   3. FIN-1 (branch narrowing without widen): an ADMIN with an explicit `sucursalId` runs the
 *      canonical read inside `conSucursalFijadaEnTx` — the branch GUC is PINNED to that single
 *      branch (a plain predicate), NEVER emptied. An ADMIN with no branch filter uses the ratified
 *      company-wide widen `conSucursalAmpliadaEnTx` (DB-4). Company-wide and branch-X therefore
 *      share one code path with two scopes, never two balance queries.
 *
 * The aging itself is the pure {@link construirFilaAging}/{@link resumirAging} over the reused
 * `en-mora` SD rule; the per-client credit term comes from `leerTerminosCreditoEnTx` and, when a
 * client has none (`plazoCreditoDias = 0`), falls back to the DB `PLAZO_CREDITO` parameter
 * ({@link leerPlazoCreditoEnTx}) — never a hardcoded default (FIN-2). Money is Decimal-string
 * end-to-end; the summary is a page-independent Decimal reduction.
 *
 * FIN-6 (data-layer page cut): the SCREEN page (`consultarCxcAging`) cuts its page in SQL —
 * `consultarSaldoCxcAgingEnTx`'s pinned-order `LIMIT`/`OFFSET` over the canonical fragment —
 * and its bucket summary rides `resumirAgingSqlEnTx`, with the pure
 * {@link construirFilaAging} recomputed on exactly the PAGE rows. The CSV export path
 * (`leerCxcAgingCompleto`) stays a deliberately UN-BOUNDED full read — regulated exports are
 * excluded from paging by design (FIN-6 "exports stay unbounded"). The D2 pin guarantees the
 * paged SQL order is the byte-identical pre-slice sort (`diasVencido DESC, saldoPendiente DESC,
 * facturaId ASC`), proven by the aging-sql-pin unit suite and the aging integration page walk.
 */

import { Decimal } from "decimal.js";
import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import {
  consultarSaldoCxcAgingEnTx,
  consultarSaldoCxcEnTx,
  leerTerminosCreditoEnTx,
  resumirAgingSqlEnTx,
} from "@/modules/cobros/infrastructure/saldo-cxc.repository";
import type { CxcAgingFila, ResumenAging } from "../domain/aging";
import { construirFilaAging, ORDEN_BUCKETS, resumirAging } from "../domain/aging";
import type { ReporteFiltro } from "../domain/reporte-filtro";
import { ok, error, type Pagina, type ReportResult, pagina } from "../domain/reporte-resultado";
import { REPORTE_NO_AUTORIZADO, messageFor } from "../domain/errors";
import { ROL, rolPermitidoParaReporte } from "../domain/roles";
import { REPORTE_ID } from "../domain/catalogo";
import { leerRolesUsuarioEnTx } from "../infrastructure/roles-repository";
import {
  conSucursalAmpliadaEnTx,
  conSucursalFijadaEnTx,
} from "../infrastructure/widen-sucursal-guc";
import { leerPlazoCreditoEnTx } from "../infrastructure/config-repository";

/** The fully-derived, UN-PAGED aging dataset (shared by the screen and the CSV export). */
export interface CxcAgingCompleto {
  /** Every open (saldoPendiente > 0) receivable, aged and ordered most-overdue first. */
  readonly filas: readonly CxcAgingFila[];
  /** The page-independent bucket summary. */
  readonly resumen: ResumenAging;
}

/** Options; `now` is injected for deterministic mora/aging boundary tests. */
export interface ConsultarCxcInput {
  readonly now?: Date;
}

/**
 * Resolve the role gate + company-wide/pinned scope and run the given full-set
 * read. Both the paged screen use case and the CSV export call THIS for their
 * authorization/scope, so an export can never carry a looser authorization or a
 * different predicate than its screen (EXP-2, EXP-4). Denied roles get
 * `REPORTE_NO_AUTORIZADO` before any canonical query runs (FIN-3, DB-2).
 */
async function conPermisoAging<T>(
  tx: PrismaTx,
  ctx: TenantCtx,
  filtro: ReporteFiltro,
  input: ConsultarCxcInput,
  leer: (txScoped: PrismaTx, now: Date) => Promise<T>,
): Promise<ReportResult<T>> {
  const roles = await leerRolesUsuarioEnTx(tx, ctx);
  if (!rolPermitidoParaReporte(roles, REPORTE_ID.CXC)) {
    return error(REPORTE_NO_AUTORIZADO, messageFor(REPORTE_NO_AUTORIZADO));
  }
  const esAdmin = roles.includes(ROL.ADMINISTRADOR);
  const now = input.now ?? new Date();

  // The read itself, scoped to the acting role's permitted view (no re-derivation —
  // FIN-1), keyed by the injected `now`.
  const obtener = (txScoped: PrismaTx): Promise<T> => leer(txScoped, now);

  const data: T = !esAdmin
    ? // COBRADOR — own branch already RLS-pinned by the session ctx; NO widen, NO
      // re-pin, NO client-supplied branch accepted (their ctx IS the boundary — FIN-3).
      await obtener(tx)
    : filtro.sucursalId !== undefined
      ? // ADMIN, branch filter active — PIN the branch GUC to that one branch (plain
        // predicate, never emptied): FIN-1 "the branch GUC stays pinned, never widened,
        // when a branch filter is active".
        await conSucursalFijadaEnTx(tx, ctx, filtro.sucursalId, obtener)
      : // ADMIN, no filter — the ratified company-wide widen over the pinned empresa (DB-4).
        await conSucursalAmpliadaEnTx(tx, ctx, obtener);

  return ok(data);
}

/**
 * Resolve the role gate + company-wide/pinned scope and return the FULL aged dataset.
 * Both the paged screen use case and the CSV export call THIS, so an export can never carry a looser
 * authorization or a different predicate than its screen (EXP-2, EXP-4). Denied roles get
 * `REPORTE_NO_AUTORIZADO` before any canonical query runs (FIN-3, DB-2).
 */
export async function leerCxcAgingCompleto(
  tx: PrismaTx,
  ctx: TenantCtx,
  filtro: ReporteFiltro,
  input: ConsultarCxcInput = {},
): Promise<ReportResult<CxcAgingCompleto>> {
  return conPermisoAging(tx, ctx, filtro, input, async (txScoped, now) => {
    // The canonical read, scoped by the caller (FIN-1).
    const filas = await consultarSaldoCxcEnTx(txScoped, ctx);
    const abiertas = filas.filter((f) => new Decimal(f.saldoPendiente).gt(0));

    // One batched terms read (no N+1); the DB PLAZO_CREDITO fallback is loaded ONLY when at
    // least one open invoice's client carries no term (FIN-2 "parameters from DB").
    const clienteIds = [...new Set(abiertas.map((f) => f.clienteId))];
    const terminos = await leerTerminosCreditoEnTx(txScoped, ctx, clienteIds);
    const necesitaParametro = abiertas.some(
      (f) => (terminos.get(f.clienteId)?.plazoCreditoDias ?? 0) <= 0,
    );
    const dbPlazo = necesitaParametro
      ? await leerPlazoCreditoEnTx(txScoped, ctx.empresaId, now)
      : null;

    const aging = abiertas.map((f) => {
      const term = terminos.get(f.clienteId)?.plazoCreditoDias ?? 0;
      const plazo = term > 0 ? term : (dbPlazo ?? 0);
      return construirFilaAging(
        {
          facturaId: f.facturaId,
          clienteId: f.clienteId,
          saldoPendiente: f.saldoPendiente,
          fechaEmision: f.fechaEmision,
          plazoCreditoDias: plazo,
        },
        now,
      );
    });

    // Stable order: most overdue first, then highest outstanding balance, then invoice id —
    // the EXACT order the paged aging query's pinned SQL `ORDER BY` reproduces (D2).
    aging.sort((a, b) => {
      if (a.diasVencido !== b.diasVencido) return b.diasVencido - a.diasVencido;
      const cmp = new Decimal(b.saldoPendiente).cmp(new Decimal(a.saldoPendiente));
      return cmp !== 0 ? cmp : a.facturaId - b.facturaId;
    });

    return { filas: aging, resumen: resumirAging(aging) };
  });
}

/**
 * The CxC aging SCREEN page ( FIN-6 data-layer cut): exactly one SQL `LIMIT`/`OFFSET`
 * page (`consultarSaldoCxcAgingEnTx`'s pinned order) + the SQL bucket summary
 * (`resumirAgingSqlEnTx`), with `construirFilaAging` re-derived PURELY on the PAGE
 * rows (bucket/vencimiento never re-encoded in SQL beyond the D2-sanctioned
 * day-count ordering expression). The summary is page-independent and the filtered
 * `total` is the summary's open-invoice count — the same integer `resumirAging`
 * reports for the full set, so the metadata is the whole-window truth (EXP-2).
 * The CSV export path keeps `leerCxcAgingCompleto` UN-BOUNDED (FIN-6 exports
 * excluded; the guard lives in the aging integration suite).
 */
export async function consultarCxcAging(
  tx: PrismaTx,
  ctx: TenantCtx,
  filtro: ReporteFiltro,
  input: ConsultarCxcInput = {},
): Promise<ReportResult<Pagina<CxcAgingFila>>> {
  const resultado = await conPermisoAging(
    tx,
    ctx,
    filtro,
    input,
    async (txScoped, now): Promise<{ filas: CxcAgingFila[]; resumen: ResumenAging }> => {
      // The paged path ALWAYS fetches the `PLAZO_CREDITO` parameter (D2's dbPlazo bind —
      // on a ≤100-row page one config row is cheaper than pre-scanning client terms).
      const dbPlazo = await leerPlazoCreditoEnTx(txScoped, ctx.empresaId, now);
      const [abiertas, resumen] = await Promise.all([
        consultarSaldoCxcAgingEnTx(txScoped, ctx, {
          page: filtro.page,
          pageSize: filtro.pageSize,
          now,
          dbPlazo,
        }),
        resumirAgingSqlEnTx(txScoped, ctx, { now, dbPlazo }),
      ]);
      // PURE aging per page row: the byte-identical facts (canonical balance, resolved
      // plazo) re-enter `construirFilaAging`, so vencimiento/bucket stay domain-owned.
      return {
        filas: abiertas.map((a) =>
          construirFilaAging(
            {
              facturaId: a.facturaId,
              clienteId: a.clienteId,
              saldoPendiente: a.saldoPendiente,
              fechaEmision: a.fechaEmision,
              plazoCreditoDias: a.plazoCreditoDias,
            },
            now,
          ),
        ),
        resumen,
      };
    },
  );
  if (!resultado.ok) return resultado;

  const { filas, resumen } = resultado.data;
  return ok(
    pagina<CxcAgingFila>(
      filtro,
      filas,
      resumen.facturasAbiertas,
      resumenAPagina(resumen),
    ),
  );
}

/** Flatten the Decimal bucket summary into the shared `Pagina.resumen` string map (EXP-2). */
export function resumenAPagina(resumen: ResumenAging): Record<string, string> {
  const plano: Record<string, string> = {
    saldoTotal: resumen.saldoTotal,
    facturasAbiertas: String(resumen.facturasAbiertas),
  };
  for (const b of ORDEN_BUCKETS) {
    plano[b] = resumen.porBucket[b];
    plano[`${b}_CNT`] = String(resumen.conteoPorBucket[b]);
  }
  return plano;
}
