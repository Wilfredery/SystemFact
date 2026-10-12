/**
 * Cobros application — canonical CxC view (R-B1; sole entry for board/aging/
 * mora/credit) + the R-C9 server-paged board serving mode.
 *
 * Two named serving modes over the SAME canonical aggregate + the pure
 * classifiers (`clasificarEstadoPago`, `enMora`/`fechaVencimiento`), sharing ONE
 * row-derivation helper so the derived facts are byte-identical in both:
 *
 *   - {@link consultarSaldoCxC} — the FULL read (every VIGENTE receivable): the
 *     contract the estado de cuenta (R-C7 "a statement lists the whole account",
 *     PAGADA included) and the cross-module consumers ride. ABSENT paging keeps
 *     this path untouched.
 *   - {@link consultarSaldoCxcPaginado} — the BOARD page (R-C9, design D4): the
 *     page cut executes in SQL (`consultarSaldoCxcTableroEnTx` + filtered
 *     `contarSaldoCxcEnTx`), the page params normalize through the shared
 *     pagination playbook BEFORE any data access, and the client-terms read
 *     covers only the page's distinct clients (a smaller read than the full
 *     path). The page-wide derived facts are computed PURELY on the page rows —
 *     the mora/estado rules are NEVER re-encoded in SQL.
 *
 * This is the ONLY application surface for a receivable: the board, the estado
 * de cuenta, aging and the credit gate all consume these two and NOTHING
 * else, so the balance, derived state and mora decision can never diverge
 * between screens (ADR-017 — nothing is cached or materialized; a re-run always
 * reflects the latest committed payment).
 *
 * Runs inside the caller's `withTenantTransaction`, so the aggregate is already
 * RLS-scoped; the explicit `empresaId` in the aggregate + the term read are the
 * second defense. Every monetary value crosses here as a `Decimal(12,2)` string.
 */

import { Decimal } from "decimal.js";
import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import {
  calcularOffset,
  calcularTotalPages,
  normalizarPagina,
  normalizarTamanoPagina,
} from "@/shared/domain/pagination";
import { clasificarEstadoPago } from "../domain/clasificar-estado-pago";
import { enMora, fechaVencimiento } from "../domain/en-mora";
import type { CobroResult, EstadoPagoDerivado, SaldoCxcFila } from "../domain/pago";
import type { TerminosCredito } from "../infrastructure/saldo-cxc.repository";
import {
  consultarSaldoCxcEnTx,
  contarSaldoCxcEnTx,
  consultarSaldoCxcTableroEnTx,
  leerTerminosCreditoEnTx,
} from "../infrastructure/saldo-cxc.repository";

/**
 * One receivable as the board/aging/mora/credit consumers need it: the summed
 * facts from the canonical aggregate plus the DERIVED payment state and the
 * Santo-Domingo mora/aging facts resolved from the client's credit terms.
 */
export interface SaldoCxCVista {
  readonly facturaId: number;
  readonly clienteId: number;
  readonly total: string;
  readonly cobrosAplicados: string;
  readonly saldoPendiente: string;
  readonly estadoPago: EstadoPagoDerivado;
  readonly enMora: boolean;
  /** SD calendar due date (`YYYY-MM-DD`), for aging buckets. */
  readonly vencimiento: string;
  readonly creditoHabilitado: boolean;
  readonly limiteCredito: string;
}

/** Options for the full read; `now` is injected for deterministic mora tests. */
export interface ConsultarSaldoCxcInput {
  readonly now?: Date;
}

/**
 * One board page + typed pagination metadata (R-C9/D4): the page's derived
 * rows, the server-computed FILTERED total (outstanding receivables only — the
 * PAGADA rows are already excluded by the SQL threshold), the echoed page/page
 * size and the page count. `totalPages` is the shared audited semantics (0 when
 * there are no rows); the board UI composes its min-1 presentation at its own
 * layer (D3 — the shared contract does NOT force one shape).
 */
export interface SaldoCxCVistaPagina {
  readonly filas: readonly SaldoCxCVista[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
  readonly totalPages: number;
}

/** Page input for the board serving mode; clamps ride the shared contract. */
export interface ConsultarSaldoCxcPaginaInput {
  readonly page?: number;
  readonly pageSize?: number;
  readonly now?: Date;
}

/**
 * The single pure derivation for one canonical row — EVERY serving mode
 * funnels through this ONE function, so a paged row carries the byte-identical
 * derived facts the full read builds (D4 "the paged path must produce
 * byte-identical derived facts per row").
 */
function derivarVista(
  f: SaldoCxcFila,
  terminos: TerminosCredito | undefined,
  now: Date,
): SaldoCxCVista {
  const plazo = terminos?.plazoCreditoDias ?? 0;
  return {
    facturaId: f.facturaId,
    clienteId: f.clienteId,
    total: f.total,
    cobrosAplicados: f.cobrosAplicados,
    saldoPendiente: f.saldoPendiente,
    estadoPago: clasificarEstadoPago(
      new Decimal(f.cobrosAplicados),
      new Decimal(f.total),
    ),
    enMora: enMora({
      fechaEmision: f.fechaEmision,
      plazoCreditoDias: plazo,
      now,
    }),
    vencimiento: fechaVencimiento(f.fechaEmision, plazo),
    creditoHabilitado: terminos?.creditoHabilitado ?? false,
    limiteCredito: terminos?.limiteCredito ?? "0.00",
  };
}

/**
 * Returns every VIGENTE receivable of the (branch-scoped) tenant with its derived
 * state and mora, newest first. This is the single canonical CxC query.
 */
export async function consultarSaldoCxC(
  tx: PrismaTx,
  ctx: TenantCtx,
  input: ConsultarSaldoCxcInput = {},
): Promise<CobroResult<SaldoCxCVista[]>> {
  const filas = await consultarSaldoCxcEnTx(tx, ctx);

  // One batched read of the distinct clients' terms — never a per-invoice query.
  const clienteIds = [...new Set(filas.map((f) => f.clienteId))];
  const terminos = await leerTerminosCreditoEnTx(tx, ctx, clienteIds);

  const now = input.now ?? new Date();
  return {
    ok: true,
    data: filas.map((f) => derivarVista(f, terminos.get(f.clienteId), now)),
  };
}

/**
 * Serve the CxC board ONE page at the data layer (R-C9). The page params run
 * through the shared pagination playbook (`normalizarPagina`/`normalizarTamanoPagina`
 * — 0/absent → default 25, 250 → 100, page floor ≥ 1) BEFORE any data access;
 * the SQL wrapper executes the page cut with the pinned order and the count
 * carries the FILTERED total; nothing sends the full VIGENTE set to the
 * application. Derived facts stay pure on the page rows.
 */
export async function consultarSaldoCxcPaginado(
  tx: PrismaTx,
  ctx: TenantCtx,
  input: ConsultarSaldoCxcPaginaInput = {},
): Promise<CobroResult<SaldoCxCVistaPagina>> {
  const page = normalizarPagina(input.page);
  const pageSize = normalizarTamanoPagina(input.pageSize);

  const [conteo, filas] = await Promise.all([
    contarSaldoCxcEnTx(tx, ctx),
    consultarSaldoCxcTableroEnTx(tx, ctx, {
      offset: calcularOffset(page, pageSize),
      limit: pageSize,
    }),
  ]);

  const now = input.now ?? new Date();
  // The batched client-terms read is narrowed to THE PAGE's distinct clients —
  // never the whole tenant's set (R-C9 smaller read than the full path).
  const clienteIds = [...new Set(filas.map((f) => f.clienteId))];
  const terminos = await leerTerminosCreditoEnTx(tx, ctx, clienteIds);

  return {
    ok: true,
    data: {
      filas: filas.map((f) => derivarVista(f, terminos.get(f.clienteId), now)),
      total: conteo.pendientes,
      page,
      pageSize,
      totalPages: calcularTotalPages(conteo.pendientes, pageSize),
    },
  };
}
