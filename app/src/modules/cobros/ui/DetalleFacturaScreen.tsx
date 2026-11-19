"use client";

/**
 * Per-invoice CxC detail (board-03 S13; wireframe `03-Cobros-Detalle`).
 *
 * One invoice, one screen: the header card (NCF, fecha, vence, cliente, RNC,
 * tipo, Total / Abonado / Saldo and the En Mora + "N días vencida" badge), the
 * payment history and the "Registrar Pago" panel. EVERY number and flag comes
 * from the single `obtenerDetalleCxcAction` read — the canonical derived balance
 * of that invoice plus the SD due/mora facts the board also uses (ADR-017: no
 * per-screen balance query, nothing cached, nothing summed here). A committed
 * collection RELOADS the same read, so the header and the history always show the
 * latest committed state.
 *
 * Boundary discipline mirrors `PaymentForm` (whose use case is reused verbatim —
 * `registrarCobroAction`, no second write path): the amount is validated with the
 * SHARED `zRegistrarCobroInput` before any call, the submit control is disabled on
 * the FIRST click (single-flight guard plus the disabled button) and the server
 * revalidates everything inside `withTenantTransaction`.
 *
 * S13 scope only: no editable Fecha del pago and no Referencia (S14/T10), and no
 * keypad/modal upgrade (S15/T10). Money entry behaves like `PaymentForm`.
 *
 * F0 primitives + token classes only (S16): no raw palette, no `dark:` overrides.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  obtenerDetalleCxcAction,
  registrarCobroAction,
} from "@/modules/cobros/http/actions";
import type {
  DetalleCxcVista,
  PagoHistorialVista,
} from "@/modules/cobros/application/consultar-detalle-cxc";
import {
  zRegistrarCobroInput,
  VALIDATION_ERROR,
} from "@/modules/cobros/http/validations";
import { formatearFechaSD, formatearMonto } from "@/shared/ui/format";
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

/** The wireframe says "Tipo: Crédito"; everything else is a contado client. */
function etiquetaTipoCliente(tipoCliente: string): string {
  return tipoCliente === "CREDITO" ? "Crédito" : "Contado";
}

/** "36 días vencida" (singular for one full SD day past due). */
function etiquetaDiasVencida(dias: number): string {
  return dias === 1 ? "1 día vencida" : `${dias} días vencida`;
}

/** Wireframe payment-history labels for the two frozen payment directions. */
const ETIQUETA_TIPO_PAGO: Record<string, string> = {
  COBRO: "Cobro",
  REEMBOLSO: "Reembolso",
};

export function DetalleFacturaScreen({ facturaId }: { readonly facturaId: number }) {
  const [detalle, setDetalle] = useState<DetalleCxcVista | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  function aplicar(r: Awaited<ReturnType<typeof obtenerDetalleCxcAction>>): void {
    if (r.ok) {
      setDetalle(r.data);
      setError(null);
    } else {
      setError(`[${r.error.code}] ${r.error.message}`);
    }
    setCargando(false);
  }

  // Reload after a committed collection (a normal handler call, not in an effect).
  async function recargar(): Promise<void> {
    aplicar(await obtenerDetalleCxcAction({ facturaId }));
  }

  // The mount fetch settles state from the action's resolution callback (an
  // external-system boundary), never synchronously in the effect body.
  useEffect(() => {
    void obtenerDetalleCxcAction({ facturaId }).then(aplicar);
  }, [facturaId]);

  if (cargando) {
    return <p className="text-sm text-ink-muted">Cargando factura…</p>;
  }
  if (error !== null || detalle === null) {
    // Stable catalog surface only — never a stack trace or a Prisma internal.
    return (
      <p role="alert" className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
        {error ?? "No se pudo cargar la factura."}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold text-ink">
          Detalle de Factura {detalle.correlativoInterno}
        </h1>
        <Link
          href="/cobros/cxc-board"
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          Volver
        </Link>
      </div>

      <CabeceraFactura detalle={detalle} />

      <HistorialPagos historial={detalle.historial} />

      <RegistrarPagoPanel
        facturaId={detalle.facturaId}
        saldo={detalle.saldo}
        onCobrado={recargar}
      />
    </div>
  );
}

/** The invoice header card: fiscal identity, client facts and the derived money. */
function CabeceraFactura({ detalle }: { readonly detalle: DetalleCxcVista }) {
  return (
    <Card data-testid="detalle-factura-cabecera">
      <CardHeader>
        <CardTitle>{detalle.clienteNombre}</CardTitle>
        <CardDescription>NCF {detalle.ncf}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
          <Dato etiqueta="Factura" valor={detalle.correlativoInterno} />
          <Dato etiqueta="NCF" valor={detalle.ncf} />
          <Dato etiqueta="Fecha" valor={formatearFechaSD(detalle.fechaEmision)} />
          <Dato etiqueta="Vence" valor={formatearFechaSD(detalle.vencimiento)} />
          <Dato etiqueta="Cliente" valor={detalle.clienteNombre} />
          <Dato etiqueta="RNC" valor={detalle.clienteRnc ?? "—"} />
          <Dato etiqueta="Tipo" valor={etiquetaTipoCliente(detalle.tipoCliente)} />
          <Dato etiqueta="Total" valor={formatearMonto(detalle.total)} />
          <Dato etiqueta="Abonado" valor={formatearMonto(detalle.abonado)} />
          <Dato
            etiqueta="Saldo"
            valor={formatearMonto(detalle.saldo)}
            testId="detalle-saldo"
            enfasis
          />
        </dl>

        {detalle.enMora && (
          // Mora semantic (design-system gap #3): the --danger family, never a
          // raw red palette and never a `dark:` override.
          <div className="flex flex-wrap items-center gap-2" data-testid="detalle-mora">
            <Badge variant="destructive">En Mora</Badge>
            <span className="text-sm font-medium text-danger">
              {etiquetaDiasVencida(detalle.diasVencida)}
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Dato({
  etiqueta,
  valor,
  testId,
  enfasis = false,
}: {
  readonly etiqueta: string;
  readonly valor: string;
  readonly testId?: string;
  readonly enfasis?: boolean;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-ink-muted">{etiqueta}</dt>
      <dd
        data-testid={testId}
        className={
          enfasis
            ? "text-base font-semibold tabular-nums text-ink"
            : "tabular-nums text-ink"
        }
      >
        {valor}
      </dd>
    </div>
  );
}

/** The invoice's full payment history, newest first (wireframe empty state). */
function HistorialPagos({
  historial,
}: {
  readonly historial: readonly PagoHistorialVista[];
}) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>Historial de Pagos</CardTitle>
        <CardDescription>Pagos registrados sobre esta factura.</CardDescription>
      </CardHeader>
      <CardContent>
        {historial.length === 0 && (
          <p className="text-sm text-ink-muted">Sin pagos registrados</p>
        )}

        {historial.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fecha</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead className="text-right">Monto</TableHead>
                <TableHead>Método</TableHead>
                <TableHead>Referencia</TableHead>
                <TableHead>Usuario</TableHead>
                <TableHead className="text-right">Recibo</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {historial.map((p) => (
                <TableRow key={p.correlativoRecibo} data-testid={`detalle-pago-${p.correlativoRecibo}`}>
                  <TableCell className="tabular-nums">
                    {formatearFechaSD(p.fecha)}
                  </TableCell>
                  <TableCell>
                    {ETIQUETA_TIPO_PAGO[p.tipo] ?? p.tipo}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatearMonto(p.monto)}
                  </TableCell>
                  <TableCell>{p.metodoPago}</TableCell>
                  <TableCell className="text-ink-muted">
                    {p.referencia ?? "—"}
                  </TableCell>
                  <TableCell>{p.usuarioNombre}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {p.correlativoRecibo}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

type Mensaje =
  | { readonly kind: "ok"; readonly text: string }
  | { readonly kind: "error"; readonly code: string; readonly text: string }
  | null;

/**
 * "Registrar Pago" (S13 scope): monto del pago prefilled with the derived pending
 * balance, the saldo note and the confirm action wired to the EXISTING
 * `registrarCobroAction`. Fecha/Referencia and the keypad/modal confirm are
 * S14/S15 (T10) — deliberately absent here.
 */
function RegistrarPagoPanel({
  facturaId,
  saldo,
  onCobrado,
}: {
  readonly facturaId: number;
  /** The derived pending balance to prefill a full payment (`Decimal(12,2)`). */
  readonly saldo: string;
  /** Notified after a committed collection so the screen reloads the invoice. */
  readonly onCobrado: () => Promise<void> | void;
}) {
  const [monto, setMonto] = useState(saldo);
  const [enviando, setEnviando] = useState(false);
  const [mensaje, setMensaje] = useState<Mensaje>(null);
  const [reciboEmitido, setReciboEmitido] = useState<number | null>(null);

  async function enviar(): Promise<void> {
    // Single-flight guard (belt-and-braces with the disabled button): a second
    // event in the SAME render cycle must never fire a second collection.
    if (enviando) return;

    const parsed = zRegistrarCobroInput.safeParse({
      facturaId,
      monto: monto.trim(),
    });
    if (!parsed.success) {
      setMensaje({
        kind: "error",
        code: VALIDATION_ERROR,
        text: "Ingresa un monto válido mayor que cero.",
      });
      return;
    }

    // Disable on the FIRST click: flip `enviando` before the await.
    setEnviando(true);
    setMensaje(null);
    const r = await registrarCobroAction(parsed.data);
    if (r.ok) {
      setReciboEmitido(r.data.correlativoRecibo);
      setMensaje({
        kind: "ok",
        text: `Pago registrado. Nuevo saldo: ${formatearMonto(r.data.saldoPendiente)}.`,
      });
      await onCobrado();
    } else {
      setMensaje({ kind: "error", code: r.error.code, text: r.error.message });
    }
    setEnviando(false);
  }

  return (
    <Card size="sm" aria-label="Registrar Pago">
      <CardHeader>
        <CardTitle>Registrar Pago</CardTitle>
        <CardDescription>
          El saldo se recalcula con la consulta canónica al confirmar.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {mensaje !== null && (
          <p
            role="status"
            aria-live="polite"
            className={
              mensaje.kind === "ok"
                ? "rounded-md bg-success-bg px-3 py-2 text-sm text-ink"
                : "rounded-md bg-danger/10 px-3 py-2 text-sm text-danger"
            }
          >
            {mensaje.kind === "error" && (
              <span className="mr-2 font-mono text-xs">[{mensaje.code}]</span>
            )}
            {mensaje.text}
          </p>
        )}

        {mensaje?.kind === "ok" && reciboEmitido !== null && (
          <Link
            href={`/cobros/recibo/${reciboEmitido}`}
            data-testid={`detalle-recibo-link-${reciboEmitido}`}
            aria-label={`Reimprimir recibo ${reciboEmitido}`}
            className="text-sm font-medium text-link hover:underline"
          >
            Ver / reimprimir recibo #{reciboEmitido} (no fiscal)
          </Link>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void enviar();
          }}
          className="flex flex-col gap-3"
        >
          <div className="flex flex-col gap-1">
            <Label htmlFor="detalle-monto-pago">Monto del pago (RD$)</Label>
            <Input
              id="detalle-monto-pago"
              value={monto}
              inputMode="decimal"
              disabled={enviando}
              aria-label={`Monto del pago factura ${facturaId}`}
              onChange={(e) => setMonto(e.target.value)}
              className="max-w-48"
            />
          </div>

          <p data-testid="detalle-saldo-pendiente" className="text-sm text-ink-muted">
            Saldo pendiente: <span className="font-medium text-ink">{formatearMonto(saldo)}</span>
          </p>

          <Button
            type="submit"
            disabled={enviando}
            aria-label={`Confirmar pago factura ${facturaId}`}
            className="w-fit"
          >
            {enviando ? "Registrando…" : "Confirmar Pago"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
