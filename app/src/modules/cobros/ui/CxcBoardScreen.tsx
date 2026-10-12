"use client";

/**
 * CxC board screen (fase-6 PR-4, spec R-C7 / R-B1; R-C9 server paging).
 *
 * The collections board: three outstanding-receivable buckets — Pendiente,
 * Parcial and En Mora — served from the SINGLE canonical derived-balance view
 * via `consultarSaldoCxcAction` and NOTHING else: the balance, the derived
 * PENDIENTE/PARCIAL/PAGADA state and the Santo-Domingo mora flag all come from
 * that one server page (ADR-017 — no per-screen balance query, nothing cached).
 * THE PAGE CUT IS SERVER-SIDE (R-C9): one outstanding-filtered SQL page +
 * typed metadata per request; the screen navigates server pages by page number
 * and classifies the PAGE's rows client-side with the pure `clasificarTableroCxc`.
 *
 * Accepted behavior change (design risk #3, stated in the PR description): the
 * per-bucket counts (and rows) are PAGE-SCOPED — the three sections render the
 * current server page's classification, so a bucket's total is how many of THAT
 * page's rows fall in it. Per-bucket totals across the whole tenant would need
 * the derived mora/estado rules re-encoded in SQL — rejected. The PR
 * description documents this consequence.
 *
 * A row can open the inline `PaymentForm`; after a committed collection the
 * board RELOADS the same server page, so the row's new state and any bucket
 * move reflect the latest committed payment immediately.
 *
 * Server components by default; this is a client island purely for the interactivity
 * (fetch on mount, pagination, inline payment). The board NEVER computes money.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { consultarSaldoCxcAction } from "@/modules/cobros/http/actions";
import type {
  SaldoCxCVista,
  SaldoCxCVistaPagina,
} from "@/modules/cobros/application/consultar-saldo-cxc";
import type { EstadoPagoDerivado } from "@/modules/cobros/domain/pago";
import { clasificarTableroCxc, paginar } from "./board";
import { formatearFechaDO, formatearMontoDO } from "./format";
import { PaymentForm } from "./PaymentForm";

/** Which bucket is open for payment (a single invoice at a time). */
type Abierto = number | null;

const ETIQUETA_ESTADO: Record<EstadoPagoDerivado, string> = {
  PENDIENTE: "Pendiente",
  PARCIAL: "Parcial",
  PAGADA: "Pagada",
};

export function CxcBoardScreen() {
  const [servida, setServida] = useState<SaldoCxCVistaPagina | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [abierto, setAbierto] = useState<Abierto>(null);

  // Apply the canonical read's result to state. `recargar` reads a fresh
  // snapshot and pushes it in — the single source stays `consultarSaldoCxcAction`
  // (R-C9: one SQL page + typed metadata per request).
  function aplicar(r: Awaited<ReturnType<typeof consultarSaldoCxcAction>>): void {
    if (r.ok) {
      setServida(r.data);
      setError(null);
    } else {
      setError(`[${r.error.code}] ${r.error.message}`);
    }
    setCargando(false);
  }

  // Reload for handlers (after a committed collection) — the SAME server page,
  // a normal call, not in an effect, so the compiler's effect rule never applies.
  async function recargar(): Promise<void> {
    aplicar(await consultarSaldoCxcAction({ page: servida?.page ?? 1 }));
  }

  // The mount fetch settles state from the action's resolution callback (an
  // external-system boundary), never synchronously in the effect body — the same
  // convention as `PosScreen`/`ReturnForm`.
  useEffect(() => {
    void consultarSaldoCxcAction({ page: 1 }).then(aplicar);
  }, []);

  async function navegarA(page: number): Promise<void> {
    setCargando(true);
    aplicar(await consultarSaldoCxcAction({ page }));
  }

  if (cargando) {
    return <p className="text-sm text-zinc-500">Cargando cuentas por cobrar…</p>;
  }
  if (error !== null || servida === null) {
    // No stack traces / Prisma internals — only the stable catalog surface.
    return (
      <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">
        {error ?? "No hay datos del tablero."}
      </p>
    );
  }

  const tablero = clasificarTableroCxc(servida.filas);
  const pendiente = paginar(tablero.pendiente, servida);
  const parcial = paginar(tablero.parcial, servida);
  const enMora = paginar(tablero.enMora, servida);

  return (
    <div className="flex flex-col gap-6">
      <ReimpresorRecibo />

      {/* One board-level page navigation: the CUT is server-side, so the
          sections share the page cursor (R-C9) instead of paginating their
          buckets independently in memory. */}
      {servida.totalPages > 1 && (
        <nav
          aria-label="Paginación tablero"
          className="flex items-center justify-between gap-2 text-xs"
        >
          <button
            type="button"
            onClick={() => navegarA(servida.page - 1)}
            disabled={servida.page <= 1}
            aria-label="Página anterior"
            className="rounded border border-zinc-300 px-2 py-1 text-zinc-700 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300"
          >
            Anterior
          </button>
          <span className="text-zinc-500">
            Página {servida.page} de {servida.totalPages}
          </span>
          <button
            type="button"
            onClick={() => navegarA(servida.page + 1)}
            disabled={servida.page >= servida.totalPages}
            aria-label="Página siguiente"
            className="rounded border border-zinc-300 px-2 py-1 text-zinc-700 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300"
          >
            Siguiente
          </button>
        </nav>
      )}

      <SeccionCobros
        titulo="En mora"
        tono="mora"
        pagina={enMora}
        abierto={abierto}
        onAbrir={setAbierto}
        onCobrado={recargar}
      />
      <SeccionCobros
        titulo="Parciales"
        tono="parcial"
        pagina={parcial}
        abierto={abierto}
        onAbrir={setAbierto}
        onCobrado={recargar}
      />
      <SeccionCobros
        titulo="Pendientes"
        tono="pendiente"
        pagina={pendiente}
        abierto={abierto}
        onAbrir={setAbierto}
        onCobrado={recargar}
      />
    </div>
  );
}

function SeccionCobros({
  titulo,
  tono,
  pagina,
  abierto,
  onAbrir,
  onCobrado,
}: {
  readonly titulo: string;
  readonly tono: "pendiente" | "parcial" | "mora";
  readonly pagina: ReturnType<typeof paginar<SaldoCxCVista>>;
  readonly abierto: Abierto;
  readonly onAbrir: (id: Abierto) => void;
  readonly onCobrado: () => Promise<void> | void;
}) {
  return (
    <section
      aria-label={titulo}
      className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
    >
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
          {titulo}{" "}
          {/* Page-scoped bucket count (design risk #3 — accepted behavior
              change; documented in the PR description). */}
          <span className="text-xs font-normal text-zinc-500">({pagina.total})</span>
        </h2>
      </div>

      {pagina.total === 0 && (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Sin cuentas en esta categoría.</p>
      )}

      {pagina.total > 0 && (
        <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {pagina.items.map((f) => (
            <FilaCobro
              key={f.facturaId}
              fila={f}
              tono={tono}
              abierto={abierto === f.facturaId}
              onAbrir={onAbrir}
              onCobrado={onCobrado}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function FilaCobro({
  fila,
  tono,
  abierto,
  onAbrir,
  onCobrado,
}: {
  readonly fila: SaldoCxCVista;
  readonly tono: "pendiente" | "parcial" | "mora";
  readonly abierto: boolean;
  readonly onAbrir: (id: Abierto) => void;
  readonly onCobrado: () => Promise<void> | void;
}) {
  // Lookup instead of a nested ternary (S3358); `tono` is exhaustively typed
  // `"pendiente" | "parcial" | "mora"`, so the map covers every value the old
  // `else` branch handled. Rendering output is unchanged.
  const badge = {
    mora: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
    parcial: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
    pendiente: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  }[tono];

  return (
    <li data-testid={`cxc-fila-${fila.facturaId}`} className="py-2">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-50">
            Factura #{fila.facturaId} · Cliente #{fila.clienteId} ·{" "}
            {formatearMontoDO(fila.saldoPendiente)} pendientes
          </p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Total {formatearMontoDO(fila.total)} · Cobrado {formatearMontoDO(fila.cobrosAplicados)} ·
            {" "}
            <span className={`rounded px-1.5 py-0.5 font-medium ${badge}`}>
              {fila.enMora ? "En mora" : ETIQUETA_ESTADO[fila.estadoPago]}
            </span>
            {" · Vence "}
            {formatearFechaDO(fila.vencimiento)}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Link
            href={`/cobros/estado-cuenta/${fila.clienteId}`}
            aria-label={`Estado de cuenta cliente ${fila.clienteId}`}
            className="rounded border border-zinc-300 px-2 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            Estado de cuenta
          </Link>
          <button
            type="button"
            onClick={() => onAbrir(abierto ? null : fila.facturaId)}
            aria-label={`Cobrar factura ${fila.facturaId}`}
            aria-expanded={abierto}
            className="rounded border border-emerald-300 px-2 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-50 dark:border-emerald-700 dark:text-emerald-300 dark:hover:bg-zinc-800"
          >
            {abierto ? "Ocultar" : "Cobrar"}
          </button>
        </div>
      </div>
      {abierto && (
        <PaymentForm
          facturaId={fila.facturaId}
          saldoPendiente={fila.saldoPendiente}
          onCobrado={onCobrado}
          onCerrar={() => onAbrir(null)}
        />
      )}
    </li>
  );
}

/**
 * Reprint-by-number entry (R-C4). A persisted receipt is addressed by its company
 * `correlativoRecibo`, so the board exposes a small form to jump straight to the
 * non-fiscal reprint page for any number — the reprint route itself validates and
 * gates the read (a foreign/missing number surfaces `PAGO_NO_ENCONTRADO`).
 */
function ReimpresorRecibo() {
  const router = useRouter();
  const [correlativo, setCorrelativo] = useState("");

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const n = Number.parseInt(correlativo.trim(), 10);
        if (Number.isInteger(n) && n > 0) {
          router.push(`/cobros/recibo/${n}`);
        }
      }}
      className="flex items-center gap-2 text-xs"
      aria-label="Reimprimir recibo"
    >
      <label htmlFor="recibo-correlativo" className="font-medium text-zinc-700 dark:text-zinc-300">
        Reimprimir recibo #
      </label>
      <input
        id="recibo-correlativo"
        value={correlativo}
        inputMode="numeric"
        aria-label="Número de recibo a reimprimir"
        onChange={(e) => setCorrelativo(e.target.value)}
        className="w-28 rounded border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
      />
      <button
        type="submit"
        aria-label="Abrir recibo"
        className="rounded border border-zinc-300 px-2 py-1 font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
      >
        Abrir
      </button>
    </form>
  );
}
