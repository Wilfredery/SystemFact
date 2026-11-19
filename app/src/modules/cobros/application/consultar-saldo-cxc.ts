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
import { normalizarBusquedaCxc } from "../domain/busqueda-cxc";
import {
  clasificarProximidadVencimiento,
  diasHastaVencimientoEnSD,
  enMora,
  fechaVencimiento,
  type ProximidadVencimiento,
} from "../domain/en-mora";
import type { CobroResult, EstadoPagoDerivado, SaldoCxcFila } from "../domain/pago";
import type { TerminosCredito } from "../infrastructure/saldo-cxc.repository";
import {
  LIMITE_PROXIMAS_A_VENCER,
  consultarProximasAVencerEnTx,
  consultarSaldoCxcEnTx,
  contarSaldoCxcEnTx,
  consultarSaldoCxcTableroEnTx,
  leerTerminosCreditoEnTx,
  type FilaCxcTablero,
  type FilaProximaVencer,
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

/**
 * One BOARD row (board-03 S10): the canonical derived facts plus the two facts
 * only the board renders — the client's NAME and the SD calendar days the
 * invoice has been outstanding. Deliberately a SUPERTYPE of {@link SaldoCxCVista}
 * so the pure board classifier and the full statement/aging consumers keep
 * working unchanged, and the full read (estado de cuenta) never pays for a join
 * it does not render.
 */
export interface SaldoCxCVistaTablero extends SaldoCxCVista {
  readonly clienteNombre: string;
  readonly dias: number;
}

/**
 * The board's GLOBAL KPI strip (board-03 S11): the pending set over EVERY page of
 * the current search — never the served page. Money is `Decimal(12,2)` text.
 */
export interface ResumenTableroCxc {
  /** Σ open balance over the whole filtered set. */
  readonly totalPendiente: string;
  /** How many invoices make up the filtered set (any derived state). */
  readonly facturasPendientes: number;
  /** How many of them are in mora (≥ 1 full SD day past due). */
  readonly enMora: number;
  /** Σ open balance of the en-mora subset. */
  readonly saldoEnMora: string;
}

/**
 * One "Próximas a vencer" entry (board-03 S12): the invoice nearest its due date
 * with its derived due date, the SIGNED SD day distance (`> 0` overdue, `0` due
 * today, `< 0` days remaining) and the badge it resolves to. Every derived fact
 * is computed PURELY on the SQL-selected row — the SQL only picks the window.
 */
export interface ProximaAVencer {
  readonly facturaId: number;
  readonly clienteId: number;
  readonly clienteNombre: string;
  readonly saldoPendiente: string;
  /** SD calendar due date (`YYYY-MM-DD`). */
  readonly vencimiento: string;
  readonly diasHastaVencimiento: number;
  readonly proximidad: ProximidadVencimiento;
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
  readonly filas: readonly SaldoCxCVistaTablero[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
  readonly totalPages: number;
  /** GLOBAL KPI strip figures over the current search (S11 — never page-scoped). */
  readonly resumen: ResumenTableroCxc;
  /** The nearest-due open invoices, not page-scoped (S12). */
  readonly proximas: readonly ProximaAVencer[];
}

/** Page input for the board serving mode; clamps ride the shared contract. */
export interface ConsultarSaldoCxcPaginaInput {
  readonly page?: number;
  readonly pageSize?: number;
  readonly now?: Date;
  /** RAW board search text; normalized here before any data access (S12). */
  readonly busqueda?: string;
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
 *
 * Both new board surfaces ride the SAME read (board-03): the search term is
 * normalized HERE (`normalizarBusquedaCxc` — blank → no filter) before it
 * reaches SQL, so the page, the pagination total and the KPI strip are narrowed
 * by one identical predicate; and the GLOBAL KPI figures plus the
 * "Próximas a vencer" window are fetched alongside the page (three statements in
 * one round-trip, no per-row query), never derived from the served page.
 */
export async function consultarSaldoCxcPaginado(
  tx: PrismaTx,
  ctx: TenantCtx,
  input: ConsultarSaldoCxcPaginaInput = {},
): Promise<CobroResult<SaldoCxCVistaPagina>> {
  const page = normalizarPagina(input.page);
  const pageSize = normalizarTamanoPagina(input.pageSize);
  const now = input.now ?? new Date();
  const busqueda = normalizarBusquedaCxc(input.busqueda);
  const filtro = { now, busqueda };

  const [conteo, filas, proximasFilas] = await Promise.all([
    contarSaldoCxcEnTx(tx, ctx, filtro),
    consultarSaldoCxcTableroEnTx(tx, ctx, {
      pag: { offset: calcularOffset(page, pageSize), limit: pageSize },
      ...filtro,
    }),
    consultarProximasAVencerEnTx(tx, ctx, {
      now,
      limite: LIMITE_PROXIMAS_A_VENCER,
    }),
  ]);

  // The batched client-terms read is narrowed to THE PAGE's distinct clients —
  // never the whole tenant's set (R-C9 smaller read than the full path).
  const clienteIds = [...new Set(filas.map((f) => f.clienteId))];
  const terminos = await leerTerminosCreditoEnTx(tx, ctx, clienteIds);

  return {
    ok: true,
    data: {
      filas: filas.map((f) => derivarVistaTablero(f, terminos.get(f.clienteId), now)),
      total: conteo.pendientes,
      page,
      pageSize,
      totalPages: calcularTotalPages(conteo.pendientes, pageSize),
      resumen: {
        totalPendiente: conteo.saldoPendienteTotal,
        facturasPendientes: conteo.pendientes,
        enMora: conteo.enMora,
        saldoEnMora: conteo.saldoEnMora,
      },
      proximas: proximasFilas.map((f) => derivarProximaAVencer(f, now)),
    },
  };
}

/**
 * One board row: the shared derivation plus the two board-only facts the SQL
 * projected (client NAME, SD days outstanding). Same single derivation — the
 * paged path never re-implements money or mora.
 */
function derivarVistaTablero(
  f: FilaCxcTablero,
  terminos: TerminosCredito | undefined,
  now: Date,
): SaldoCxCVistaTablero {
  return {
    ...derivarVista(f, terminos, now),
    clienteNombre: f.clienteNombre,
    dias: f.dias,
  };
}

/**
 * The panel's derived entry: the SQL picks the window and the client term, while
 * the due date, the signed SD day distance and the badge are recomputed here with
 * the pure `en-mora` helpers (the same discipline the aging page applies to its
 * served rows) — never a second day-count rule and never manual hour math.
 */
function derivarProximaAVencer(
  f: FilaProximaVencer,
  now: Date,
): ProximaAVencer {
  const diasHastaVencimiento = diasHastaVencimientoEnSD({
    fechaEmision: f.fechaEmision,
    plazoCreditoDias: f.plazoCreditoDias,
    now,
  });
  return {
    facturaId: f.facturaId,
    clienteId: f.clienteId,
    clienteNombre: f.clienteNombre,
    saldoPendiente: f.saldoPendiente,
    vencimiento: fechaVencimiento(f.fechaEmision, f.plazoCreditoDias),
    diasHastaVencimiento,
    proximidad: clasificarProximidadVencimiento(diasHastaVencimiento),
  };
}
