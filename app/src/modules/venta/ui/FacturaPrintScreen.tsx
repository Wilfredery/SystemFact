"use client";

/**
 * Printable fiscal-invoice island (factura-print.md T2, S2/S3/S4).
 *
 * Pattern: the same client-island shape as `ReciboReprintScreen` (fetch on mount
 * through the module's thin read action, error/loading/view states), rendering a
 * `<article data-testid="factura-print">` document that follows DGII 254-06
 * Art. 7/11: denomination per type top-right, the NCF clearly visible, the NCF
 * expiry date (from the governing sequence range, never hardcoded), emisor
 * identity, receptor identity (RNC required for B01), frozen lines, ITBIS
 * desglosado per rate, descuento before ITBIS (ADR-018), total, and forma de
 * pago derived from the canonical balance.
 *
 * Fiscal semantics (S4): this is a REPRESENTATION of the persisted record —
 * reprinting never mints a new NCF; a CANCELADA invoice renders its no-fiscal-
 * effect banner and an ANULADA one its reported-in-608 banner, both prominent
 * and unmissable.
 *
 * Print CSS (new in the app): one inline `<style>` (legal — style-src
 * 'unsafe-inline' is the owner decision S2; scripts stay nonce-only) defines
 * `@media print` visibility isolation so ONLY the document prints, regardless
 * of the app shell around it, plus `@page` margins. The print button is
 * screen-only (`no-print`).
 */

import Link from "next/link";
import { useEffect, useState } from "react";
import { Decimal } from "decimal.js";
import { formatearMonto } from "@/shared/ui/format";
import {
  consultarFacturaParaImpresionAction,
  type FacturaParaImpresionDto,
} from "@/modules/venta/http/actions.lectura";

const DENOMINACION_POR_TIPO: Record<string, string> = {
  B01: "Factura de Crédito Fiscal",
  B02: "Factura de Consumo",
};

type Estado =
  | { readonly kind: "cargando" }
  | { readonly kind: "error"; readonly mensaje: string }
  | { readonly kind: "vista"; readonly data: FacturaParaImpresionDto };

function formatoFecha(iso: string): string {
  // America/Santo_Domingo presentation of a stored-UTC instant (AGENTS.md
  // dates); 4-digit year — a fiscal document's issue date must be unambiguous.
  return new Intl.DateTimeFormat("es-DO", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
    timeZone: "America/Santo_Domingo",
  }).format(new Date(iso));
}

function esCero(valor: string): boolean {
  // Money is a Decimal string (AGENTS.md): compare exactly, never through a float.
  return new Decimal(valor).isZero();
}

export function FacturaPrintScreen({ facturaId }: { readonly facturaId: number }) {
  const [estado, setEstado] = useState<Estado>({ kind: "cargando" });

  useEffect(() => {
    let activo = true;
    consultarFacturaParaImpresionAction({ facturaId })
      .then((r) => {
        if (!activo) return;
        if (r.ok) setEstado({ kind: "vista", data: r.data });
        else setEstado({ kind: "error", mensaje: r.error.message });
      })
      .catch(() => {
        // A transport-level rejection must still land in the typed error state;
        // the message names no provider internals (19-directivas §9).
        if (activo) setEstado({ kind: "error", mensaje: "No se pudo cargar la factura" });
      });
    return () => {
      activo = false;
    };
  }, [facturaId]);

  return (
    <>
      {/* Print isolation: only the document prints (factura-print.md T2). */}
      <style>{`
        @media print {
          body * { visibility: hidden; }
          .factura-print-doc, .factura-print-doc * { visibility: visible; }
          .factura-print-doc { position: absolute; inset: 0; margin: 0; background: #ffffff !important; color: #18181b !important; }
          /* Browsers do not print background colors: force light-on-white so a
             dark-OS user still gets a legible document (JD rounds 1-2). The
             blanket descendant reset beats every color utility on children (the screen
             uses only light F0 tokens, but paper output must never depend on a theme); the
             banner rule AFTER it restores its red identity (later rule wins). */
          .factura-print-doc * { color: #18181b !important; border-color: #d4d4d8 !important; }
          .factura-print-doc [role="alert"] { color: #b91c1c !important; background: transparent !important; border-color: #b91c1c !important; }
          .no-print { display: none !important; }
        }
        @page { margin: 12mm; }
      `}</style>

      {estado.kind === "cargando" ? <p className="text-sm text-ink-muted">Cargando factura…</p> : null}

      {estado.kind === "error" ? (
        <div className="flex flex-col gap-3">
          <p
            role="alert"
            className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger"
          >
            {estado.mensaje}
          </p>
          <Link href="/venta" className="text-xs text-link hover:underline">
            Volver a Venta
          </Link>
        </div>
      ) : null}

      {estado.kind === "vista" ? <FacturaDocumento data={estado.data} /> : null}
    </>
  );
}

function BannerEstadoFiscal({ estado }: { readonly estado: FacturaParaImpresionDto["estado"] }) {
  if (estado === "VIGENTE") return null;
  if (estado === "CANCELADA") {
    return (
      <p
        role="alert"
        data-testid="factura-banner-estado"
        className="rounded-md border-2 border-danger px-4 py-3 text-center text-sm font-bold uppercase text-danger"
      >
        Documento cancelado — sin efecto fiscal; no se reporta en el 606/607
      </p>
    );
  }
  // ANULADA is the only remaining state; the type makes a new one a compile error.
  const _exhaustivo: "ANULADA" = estado;
  void _exhaustivo;
  return (
    <p
      role="alert"
      data-testid="factura-banner-estado"
      className="rounded-md border-2 border-danger bg-danger/10 px-4 py-3 text-center text-sm font-bold uppercase text-danger"
    >
      Documento anulado — con efecto fiscal; reportado en el 608
    </p>
  );
}

function FacturaDocumento({ data }: { readonly data: FacturaParaImpresionDto }) {
  const denominacion = DENOMINACION_POR_TIPO[data.tipoNcf] ?? "Factura";
  const esB01 = data.tipoNcf === "B01";
  const saldo = data.saldo;
  const formaPago =
    saldo === null
      ? "—"
      : esCero(saldo.saldoPendiente)
        ? "Contado — pagada"
        : "Crédito — saldo pendiente";

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <div className="no-print flex items-center justify-between">
        <Link
          href="/venta"
          className="rounded border border-line px-2 py-1 text-xs font-medium text-ink"
        >
          Volver a Venta
        </Link>
        <button
          type="button"
          onClick={() => {
            // `print` is absent in a non-browser test host; never throw the UI.
            if (typeof window !== "undefined") window.print();
          }}
          aria-label="Imprimir factura"
          data-testid="factura-boton-imprimir"
          className="rounded bg-accent px-3 py-1.5 text-xs font-semibold text-accent-fg"
        >
          Imprimir
        </button>
      </div>

      <article data-testid="factura-print" className="factura-print-doc rounded-lg border border-line bg-surface p-6 text-ink">
        <BannerEstadoFiscal estado={data.estado} />
        <header className="flex items-start justify-between gap-4 border-b border-dashed border-line pb-3">
          <div className="flex flex-col gap-0.5 text-sm">
            <span className="text-base font-bold" data-testid="factura-empresa-nombre">
              {data.empresa.nombreComercial}
            </span>
            {data.empresa.razonSocial !== data.empresa.nombreComercial ? (
              <span>{data.empresa.razonSocial}</span>
            ) : null}
            <span data-testid="factura-empresa-rnc">RNC: {data.empresa.rnc}</span>
            <span>{data.empresa.direccionFiscal}</span>
            <span>Tel: {data.empresa.telefono}</span>
            <span>Sucursal: {data.sucursal.nombre} — {data.sucursal.direccion}</span>
          </div>
          <div className="flex flex-col items-end gap-0.5 text-sm">
            <span className="font-bold uppercase" data-testid="factura-denominacion">
              {denominacion}
            </span>
            <span className="font-mono text-lg font-bold tracking-wide" data-testid="factura-ncf">
              NCF: {data.ncf}
            </span>
            {data.ncfVigenciaFin !== null ? (
              <span data-testid="factura-ncf-vigencia">
                Válido hasta: {data.ncfVigenciaFin}
              </span>
            ) : null}
            <span>No. interno: {data.correlativoInterno}</span>
            <span>Fecha emisión: {formatoFecha(data.fechaEmision)}</span>
          </div>
        </header>

        <section className="flex flex-col gap-0.5 py-3 text-sm">
          <span>
            <strong>Cliente:</strong>{" "}
            <span data-testid="factura-cliente-nombre">{data.cliente.nombre}</span>
          </span>
          {data.cliente.identificacionFiscal !== null ? (
            <span>
              <strong>RNC/Cédula:</strong> {data.cliente.identificacionFiscal}
              {esB01 ? "" : " (opcional en Factura de Consumo)"}
            </span>
          ) : null}
          <span>
            <strong>Atendió:</strong> {data.usuarioNombre}
          </span>
        </section>

        <table className="w-full text-sm">
          <caption className="sr-only">Detalle de la venta</caption>
          <thead>
            <tr className="border-b border-line text-left">
              <th scope="col" className="py-1 pr-2 font-semibold">Descripción</th>
              <th scope="col" className="py-1 pr-2 text-right font-semibold">Cant.</th>
              <th scope="col" className="py-1 pr-2 text-right font-semibold">Precio</th>
              <th scope="col" className="py-1 pr-2 text-right font-semibold">Desc.</th>
              <th scope="col" className="py-1 pr-2 text-right font-semibold">ITBIS</th>
              <th scope="col" className="py-1 text-right font-semibold">Subtotal</th>
            </tr>
          </thead>
          <tbody>
            {data.lineas.map((l, i) => (
              <tr key={`${l.productoNombre}-${i}`} className="border-b border-line">
                <td className="py-1 pr-2">{l.productoNombre}</td>
                <td className="py-1 pr-2 text-right">{new Decimal(l.cantidad).toString()}</td>
                <td className="py-1 pr-2 text-right">{formatearMonto(l.precioUnitario)}</td>
                <td className="py-1 pr-2 text-right">{esCero(l.descuentoLinea) ? "—" : formatearMonto(l.descuentoLinea)}</td>
                <td className="py-1 pr-2 text-right">{formatearMonto(l.itbisLinea)}</td>
                <td className="py-1 text-right">{formatearMonto(l.subtotalLinea)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <section className="mt-3 flex flex-col items-end gap-0.5 text-sm">
          <div className="flex w-64 justify-between">
            <span>Subtotal gravado</span>
            <span data-testid="factura-subtotal-gravado">{formatearMonto(data.subtotalGravado)}</span>
          </div>
          {!esCero(data.subtotalExento) ? (
            <div className="flex w-64 justify-between">
              <span>Subtotal exento</span>
              <span data-testid="factura-subtotal-exento">{formatearMonto(data.subtotalExento)}</span>
            </div>
          ) : null}
          {!esCero(data.descuento) ? (
            <div className="flex w-64 justify-between">
              <span>Descuento</span>
              <span data-testid="factura-descuento">−{formatearMonto(data.descuento)}</span>
            </div>
          ) : null}
          {data.desgloseItbis.map((r) => (
            <div key={r.tasa} className="flex w-64 justify-between" data-testid={`factura-itbis-${r.tasa.replace(".", "_")}`}>
              <span>ITBIS {new Decimal(r.tasa).toString()}%</span>
              <span>{formatearMonto(r.itbis)}</span>
            </div>
          ))}
          <div className="flex w-64 justify-between border-t border-line pt-1 text-base font-bold">
            <span>TOTAL</span>
            <span data-testid="factura-total">{formatearMonto(data.total)}</span>
          </div>
          <div className="flex w-64 justify-between">
            <span>Forma de pago</span>
            <span data-testid="factura-forma-pago">{formaPago}</span>
          </div>
          {saldo !== null && !esCero(saldo.saldoPendiente) ? (
            <div className="flex w-64 justify-between">
              <span>Saldo pendiente</span>
              <span data-testid="factura-saldo-pendiente">{formatearMonto(saldo.saldoPendiente)}</span>
            </div>
          ) : null}
        </section>

        <footer className="mt-4 border-t border-dashed border-line pt-2 text-center text-xs text-ink-muted">
          Comprobante sujeto a la normativa fiscal de la DGII (Decreto 254-06). Reimpresión de un
          documento ya emitido; no genera un nuevo NCF.
        </footer>
      </article>
    </div>
  );
}
