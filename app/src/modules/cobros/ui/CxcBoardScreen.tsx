"use client";

/**
 * CxC board screen (fase-6 PR-4, spec R-C7 / R-B1; R-C9 server paging; board-03
 * S10/S11/S12/S16 retrofit).
 *
 * The collections board: three outstanding-receivable buckets — En Mora, Parcial
 * and Pendiente — served from the SINGLE canonical derived-balance view via
 * `consultarSaldoCxcAction` and NOTHING else: the balance, the derived
 * PENDIENTE/PARCIAL/PAGADA state, the Santo-Domingo mora flag, the client name and
 * the days outstanding all come from that one server page (ADR-017 — no
 * per-screen balance query, nothing cached).
 * THE PAGE CUT IS SERVER-SIDE (R-C9): one outstanding-filtered SQL page + typed
 * metadata per request; the screen navigates server pages by page number and
 * classifies the PAGE's rows client-side with the pure `clasificarTableroCxc`.
 *
 * Accepted behavior change (design risk #3, stated in the PR description): the
 * per-bucket counts (and rows) are PAGE-SCOPED — the three sections render the
 * current server page's classification, so a bucket's total is how many of THAT
 * page's rows fall in it. The KPI strip is NOT: `resumen` is a global FILTER
 * aggregate over the whole filtered set (board-03 S11), never the served page.
 *
 * Board-03 surfaces:
 *   • S10 — every row shows the CLIENT NAME and Días (SD calendar days since
 *     `fechaEmision`, computed in SQL/pure helpers — never manual hour math);
 *   • S11 — a KPI strip: Total pendiente / Facturas pendientes / En mora, from
 *     the canonical aggregate globally; mora = ≥ 1 full SD day (the wireframe's
 *     "> 30 días" wording is dropped);
 *   • S12 — server-side search by client name or invoice number (normalized in
 *     the domain) plus a "Próximas a vencer" panel with Próxima / Vence hoy /
 *     Vencida badges. No Estado dropdown;
 *   • S16 — F0 primitives + token classes only (no raw palette, no `dark:`
 *     overrides) and the unchanged section order En mora → Parciales →
 *     Pendientes with the existing aria/role conventions.
 *
 * A row opens the shared S15 confirmation modal (`ModalRegistrarPago`); after a
 * committed collection the board RELOADS the same server page, so the row's new
 * state and any bucket move reflect the latest committed payment immediately. A
 * row ALSO links (S13) to the per-invoice detail route
 * `/cobros/factura/[facturaId]` — additive navigation only; both entry points
 * open the SAME modal, so the collection surface never diverges.
 *
 * Server components by default; this is a client island purely for the
 * interactivity (fetch on mount, search, pagination, payment modal). The board
 * NEVER computes money.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { consultarSaldoCxcAction } from "@/modules/cobros/http/actions";
import type {
  ProximaAVencer,
  ResumenTableroCxc,
  SaldoCxCVistaPagina,
  SaldoCxCVistaTablero,
} from "@/modules/cobros/application/consultar-saldo-cxc";
import type { EstadoPagoDerivado } from "@/modules/cobros/domain/pago";
import type { ProximidadVencimiento } from "@/modules/cobros/domain/en-mora";
import { clasificarTableroCxc, etiquetaDiasTranscurridos, paginar } from "./board";
import { formatearFechaSD, formatearMonto } from "@/shared/ui/format";
import { ModalRegistrarPago } from "./ModalRegistrarPago";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

/** Which invoice is open in the shared confirmation modal (one at a time). */
type CobroAbierto = {
  readonly facturaId: number;
  readonly saldoPendiente: string;
};

const ETIQUETA_ESTADO: Record<EstadoPagoDerivado, string> = {
  PENDIENTE: "Pendiente",
  PARCIAL: "Parcial",
  PAGADA: "Pagada",
};

/** S12 badges: token classes only (F0.1 registry, no `dark:` overrides). */
const ETIQUETA_PROXIMIDAD: Record<ProximidadVencimiento, string> = {
  PROXIMA: "Próxima",
  VENCE_HOY: "Vence hoy",
  VENCIDA: "Vencida",
};

const CLASE_PROXIMIDAD: Record<ProximidadVencimiento, string> = {
  PROXIMA: "border-transparent bg-surface-raised text-ink",
  VENCE_HOY: "border-transparent bg-warn-bg text-warn",
  VENCIDA: "border-transparent bg-danger/10 text-danger",
};

/** The board's bucket tone → its badge classes (a lookup, never a ternary chain). */
const CLASE_TONO: Record<"pendiente" | "parcial" | "mora", string> = {
  mora: "border-transparent bg-danger/10 text-danger",
  parcial: "border-transparent bg-warn-bg text-warn",
  pendiente: "border-transparent bg-surface-raised text-ink",
};

/** The board's section tones, in render order (En mora → Parciales → Pendientes). */
type Tono = keyof typeof CLASE_TONO;

export function CxcBoardScreen() {
  const [servida, setServida] = useState<SaldoCxCVistaPagina | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cobro, setCobro] = useState<CobroAbierto | null>(null);
  // The input's text (what the user types) and the search actually served by the
  // server — nothing is filtered client-side (S12: the LIKE runs in SQL).
  const [texto, setTexto] = useState("");
  const [busqueda, setBusqueda] = useState<string | null>(null);

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

  // One read for one server page; the payload carries the search ONLY when a
  // filter is applied (a blank search must never look like a filter on the wire).
  async function consultar(page: number, termino: string | null): Promise<void> {
    aplicar(
      await consultarSaldoCxcAction(
        termino === null ? { page } : { page, busqueda: termino },
      ),
    );
  }

  // Reload for handlers (after a committed collection) — the SAME server page and
  // the SAME search, a normal call, not in an effect, so the compiler's effect
  // rule never applies.
  async function recargar(): Promise<void> {
    await consultar(servida?.page ?? 1, busqueda);
  }

  // The mount fetch settles state from the action's resolution callback (an
  // external-system boundary), never synchronously in the effect body — the same
  // convention as `PosScreen`/`ReturnForm`.
  useEffect(() => {
    void consultarSaldoCxcAction({ page: 1 }).then(aplicar);
  }, []);

  async function navegarA(page: number): Promise<void> {
    setCargando(true);
    await consultar(page, busqueda);
  }

  async function buscar(): Promise<void> {
    const termino = texto.trim();
    const aplicada = termino === "" ? null : termino;
    setBusqueda(aplicada);
    setCargando(true);
    await consultar(1, aplicada);
  }

  if (cargando) {
    return <p className="text-sm text-ink-muted">Cargando cuentas por cobrar…</p>;
  }
  if (error !== null || servida === null) {
    // No stack traces / Prisma internals — only the stable catalog surface.
    return (
      <p role="alert" className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
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
      <div className="flex flex-wrap items-end justify-between gap-4">
        <form
          role="search"
          aria-label="Buscar en cuentas por cobrar"
          onSubmit={(e) => {
            e.preventDefault();
            void buscar();
          }}
          className="flex flex-wrap items-end gap-2"
        >
          <div className="flex flex-col gap-1">
            <Label htmlFor="cxc-busqueda">Buscar cliente o factura</Label>
            <Input
              id="cxc-busqueda"
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              placeholder="Nombre del cliente o # de factura"
              className="w-72"
            />
          </div>
          <Button type="submit">Buscar</Button>
          {busqueda !== null && (
            <Button
              type="button"
              variant="ghost"
              aria-label="Limpiar búsqueda"
              onClick={() => {
                setTexto("");
                setBusqueda(null);
                setCargando(true);
                void consultar(1, null);
              }}
            >
              Limpiar
            </Button>
          )}
        </form>
        <ReimpresorRecibo />
      </div>

      <ResumenTablero resumen={servida.resumen} />

      {/* One board-level page navigation: the CUT is server-side, so the
          sections share the page cursor (R-C9) instead of paginating their
          buckets independently in memory. */}
      {servida.totalPages > 1 && (
        <nav
          aria-label="Paginación tablero"
          className="flex items-center justify-between gap-2 text-xs"
        >
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void navegarA(servida.page - 1)}
            disabled={servida.page <= 1}
            aria-label="Página anterior"
          >
            Anterior
          </Button>
          <span className="text-ink-muted">
            Página {servida.page} de {servida.totalPages}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void navegarA(servida.page + 1)}
            disabled={servida.page >= servida.totalPages}
            aria-label="Página siguiente"
          >
            Siguiente
          </Button>
        </nav>
      )}

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <div className="flex min-w-0 flex-col gap-6">
          <SeccionCobros
            titulo="En mora"
            tono="mora"
            pagina={enMora}
            onAbrir={setCobro}
          />
          <SeccionCobros
            titulo="Parciales"
            tono="parcial"
            pagina={parcial}
            onAbrir={setCobro}
          />
          <SeccionCobros
            titulo="Pendientes"
            tono="pendiente"
            pagina={pendiente}
            onAbrir={setCobro}
          />
        </div>
        <ProximasAVencer proximas={servida.proximas} />
      </div>

      {/* S15: ONE shared confirmation modal for the whole module. Opening it
          confirms nothing — `registrarCobroAction` is the fiscal authority. */}
      <ModalRegistrarPago
        abierto={cobro !== null}
        facturaId={cobro?.facturaId ?? 0}
        saldoPendiente={cobro?.saldoPendiente ?? "0.00"}
        onCerrar={() => setCobro(null)}
        onCobrado={recargar}
      />
    </div>
  );
}

/**
 * The global KPI strip (S11): Total pendiente / Facturas pendientes / En mora,
 * read straight from the server aggregate — the board never sums money here.
 */
function ResumenTablero({ resumen }: { readonly resumen: ResumenTableroCxc }) {
  return (
    <section
      aria-label="Resumen de cuentas por cobrar"
      className="grid gap-3 sm:grid-cols-3"
    >
      <TarjetaKpi
        etiqueta="Total pendiente"
        valor={formatearMonto(resumen.totalPendiente)}
        testId="cxc-kpi-total-pendiente"
      />
      <TarjetaKpi
        etiqueta="Facturas pendientes"
        valor={String(resumen.facturasPendientes)}
        testId="cxc-kpi-facturas-pendientes"
      />
      <TarjetaKpi
        etiqueta="En mora"
        valor={`${resumen.enMora} · ${formatearMonto(resumen.saldoEnMora)}`}
        testId="cxc-kpi-en-mora"
      />
    </section>
  );
}

function TarjetaKpi({
  etiqueta,
  valor,
  testId,
}: {
  readonly etiqueta: string;
  readonly valor: string;
  readonly testId: string;
}) {
  return (
    <Card size="sm" className="gap-1">
      <CardHeader>
        <CardDescription>{etiqueta}</CardDescription>
        <CardTitle
          data-testid={testId}
          className="text-base font-semibold tabular-nums"
        >
          {valor}
        </CardTitle>
      </CardHeader>
    </Card>
  );
}

/**
 * "Próximas a vencer" (S12): the invoices nearest their due date, NOT
 * page-scoped, with Próxima / Vence hoy / Vencida badges. Rejecting the Estado
 * dropdown kept this list instead of a filter.
 */
function ProximasAVencer({
  proximas,
}: {
  readonly proximas: readonly ProximaAVencer[];
}) {
  return (
    <aside aria-label="Próximas a vencer" className="min-w-0">
      <Card>
        <CardHeader>
          <CardTitle>Próximas a vencer</CardTitle>
          <CardDescription>Facturas más cercanas a su vencimiento.</CardDescription>
        </CardHeader>
        <CardContent>
          {proximas.length === 0 && (
            <p className="text-sm text-ink-muted">Sin facturas próximas a vencer.</p>
          )}
          {proximas.length > 0 && (
            <ul className="flex flex-col divide-y divide-line">
              {proximas.map((p) => (
                <li
                  key={p.facturaId}
                  data-testid={`cxc-proxima-${p.facturaId}`}
                  className="flex items-center justify-between gap-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-ink">
                      {p.clienteNombre}
                    </p>
                    <p className="text-xs text-ink-muted">
                      Factura #{p.facturaId} · Vence {formatearFechaSD(p.vencimiento)}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span className="text-sm tabular-nums text-ink">
                      {formatearMonto(p.saldoPendiente)}
                    </span>
                    <Badge className={CLASE_PROXIMIDAD[p.proximidad]}>
                      {ETIQUETA_PROXIMIDAD[p.proximidad]}
                    </Badge>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </aside>
  );
}

function SeccionCobros({
  titulo,
  tono,
  pagina,
  onAbrir,
}: {
  readonly titulo: string;
  readonly tono: Tono;
  readonly pagina: ReturnType<typeof paginar<SaldoCxCVistaTablero>>;
  readonly onAbrir: (fila: CobroAbierto) => void;
}) {
  return (
    <Card aria-label={titulo} size="sm">
      <CardHeader>
        <CardTitle className="text-sm font-semibold">
          {titulo}{" "}
          {/* Page-scoped bucket count (design risk #3 — accepted behavior
              change). The GLOBAL figures live in the KPI strip above. */}
          <span className="text-xs font-normal text-ink-muted">({pagina.total})</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {pagina.total === 0 && (
          <p className="text-sm text-ink-muted">Sin cuentas en esta categoría.</p>
        )}

        {pagina.total > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cliente</TableHead>
                <TableHead>Días</TableHead>
                <TableHead>Vence</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Cobrado</TableHead>
                <TableHead className="text-right">Saldo</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>
                  <span className="sr-only">Acciones</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pagina.items.map((f) => (
                <FilaCobro
                  key={f.facturaId}
                  fila={f}
                  tono={tono}
                  onAbrir={onAbrir}
                />
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function FilaCobro({
  fila,
  tono,
  onAbrir,
}: {
  readonly fila: SaldoCxCVistaTablero;
  readonly tono: Tono;
  readonly onAbrir: (fila: CobroAbierto) => void;
}) {
  return (
    <TableRow data-testid={`cxc-fila-${fila.facturaId}`}>
        <TableCell>
          <p className="max-w-56 truncate font-medium text-ink">
            {fila.clienteNombre}
          </p>
          <p className="text-xs text-ink-muted">Factura #{fila.facturaId}</p>
        </TableCell>
        <TableCell className="tabular-nums">
          {etiquetaDiasTranscurridos(fila.dias)}
        </TableCell>
        <TableCell className="tabular-nums">
          {formatearFechaSD(fila.vencimiento)}
        </TableCell>
        <TableCell className="text-right tabular-nums">
          {formatearMonto(fila.total)}
        </TableCell>
        <TableCell className="text-right tabular-nums">
          {formatearMonto(fila.cobrosAplicados)}
        </TableCell>
        <TableCell className="text-right font-medium tabular-nums">
          {formatearMonto(fila.saldoPendiente)}
        </TableCell>
        <TableCell>
          <Badge className={CLASE_TONO[tono]}>
            {fila.enMora ? "En mora" : ETIQUETA_ESTADO[fila.estadoPago]}
          </Badge>
        </TableCell>
        <TableCell className="text-right">
          <div className="flex flex-wrap justify-end gap-2">
            <Link
              href={`/cobros/estado-cuenta/${fila.clienteId}`}
              aria-label={`Estado de cuenta cliente ${fila.clienteId}`}
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              Estado de cuenta
            </Link>
            {/* S13 additive navigation: the per-invoice detail (header + payment
                history) next to the S15 Cobrar affordance. */}
            <Link
              href={`/cobros/factura/${fila.facturaId}`}
              aria-label={`Ver detalle factura ${fila.facturaId}`}
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              Detalle
            </Link>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() =>
                onAbrir({
                  facturaId: fila.facturaId,
                  saldoPendiente: fila.saldoPendiente,
                })
              }
              aria-label={`Cobrar factura ${fila.facturaId}`}
              aria-haspopup="dialog"
            >
              Cobrar
            </Button>
          </div>
        </TableCell>
      </TableRow>
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
      className="flex items-end gap-2"
      aria-label="Reimprimir recibo"
    >
      <div className="flex flex-col gap-1">
        <Label htmlFor="recibo-correlativo">Reimprimir recibo #</Label>
        <Input
          id="recibo-correlativo"
          value={correlativo}
          inputMode="numeric"
          aria-label="Número de recibo a reimprimir"
          onChange={(e) => setCorrelativo(e.target.value)}
          className="w-28"
        />
      </div>
      <Button type="submit" variant="outline" aria-label="Abrir recibo">
        Abrir
      </Button>
    </form>
  );
}
