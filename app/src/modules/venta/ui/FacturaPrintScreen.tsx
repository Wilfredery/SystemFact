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

function formatoMoney(valor: string): string {
  return `RD$ ${new Intl.NumberFormat("es-DO", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(valor))}`;
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
             blanket descendant reset beats every dark: utility on children; the
             banner rule AFTER it restores its red identity (later rule wins). */
          .factura-print-doc * { color: #18181b !important; border-color: #d4d4d8 !important; }
          .factura-print-doc [role="alert"] { color: #b91c1c !important; background: transparent !important; border-color: #b91c1c !important; }
          .no-print { display: none !important; }
        }
        @page { margin: 12mm; }
      `}</style>

      {estado.kind === "cargando" ? <p className="text-sm text-zinc-500">Cargando factura…</p> : null}

      {estado.kind === "error" ? (
        <div className="flex flex-col gap-3">
          <p
            role="alert"
            className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-200"
          >
            {estado.mensaje}
          </p>
          <Link href="/venta" className="text-xs text-indigo-600 hover:underline dark:text-indigo-400">
            Volver a Venta
          </Link>
        </div>
      ) : null}

      {estado.kind === "vista" ? <FacturaDocumento data={estado.data} /> : null}
    </>
  );
}

function BannerEstadoFiscal({ estado }: { readonly estado: string }) {
  if (estado === "VIGENTE") return null;
  if (estado === "CANCELADA") {
    return (
      <p
        role="alert"
        data-testid="factura-banner-estado"
        className="rounded-md border-2 border-red-600 px-4 py-3 text-center text-sm font-bold uppercase text-red-700"
      >
        Documento cancelado — sin efecto fiscal; no se reporta en el 606/607
      </p>
    );
  }
  return (
    <p
      role="alert"
      data-testid="factura-banner-estado"
      className="rounded-md border-2 border-red-600 bg-red-50 px-4 py-3 text-center text-sm font-bold uppercase text-red-700"
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
      : Number(saldo.saldoPendiente) === 0
        ? "Contado — pagada"
        : "Crédito — saldo pendiente";

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <div className="no-print flex items-center justify-between">
        <Link
          href="/venta"
          className="rounded border border-zinc-300 px-2 py-1 text-xs font-medium text-zinc-700 dark:border-zinc-700 dark:text-zinc-300"
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
          className="rounded bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white"
        >
          Imprimir
        </button>
      </div>

<article data-testid="factura-print" className="factura-print-doc rounded-lg border border-zinc-200 bg-white p-6 text-zinc-900 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100">
        <BannerEstadoFiscal estado={data.estado} />
        <header className="flex items-start justify-between gap-4 border-b border-dashed border-zinc-300 pb-3 dark:border-zinc-700">
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
            <tr className="border-b border-zinc-300 text-left dark:border-zinc-700">
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
              <tr key={`${l.productoNombre}-${i}`} className="border-b border-zinc-100 dark:border-zinc-800">
                <td className="py-1 pr-2">{l.productoNombre}</td>
                <td className="py-1 pr-2 text-right">{Number(l.cantidad)}</td>
                <td className="py-1 pr-2 text-right">{formatoMoney(l.precioUnitario)}</td>
                <td className="py-1 pr-2 text-right">{Number(l.descuentoLinea) === 0 ? "—" : formatoMoney(l.descuentoLinea)}</td>
                <td className="py-1 pr-2 text-right">{formatoMoney(l.itbisLinea)}</td>
                <td className="py-1 text-right">{formatoMoney(l.subtotalLinea)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <section className="mt-3 flex flex-col items-end gap-0.5 text-sm">
          <div className="flex w-64 justify-between">
            <span>Subtotal gravado</span>
            <span data-testid="factura-subtotal-gravado">{formatoMoney(data.subtotalGravado)}</span>
          </div>
          {Number(data.subtotalExento) !== 0 ? (
            <div className="flex w-64 justify-between">
              <span>Subtotal exento</span>
              <span data-testid="factura-subtotal-exento">{formatoMoney(data.subtotalExento)}</span>
            </div>
          ) : null}
          {Number(data.descuento) !== 0 ? (
            <div className="flex w-64 justify-between">
              <span>Descuento</span>
              <span data-testid="factura-descuento">−{formatoMoney(data.descuento)}</span>
            </div>
          ) : null}
          {data.desgloseItbis.map((r) => (
            <div key={r.tasa} className="flex w-64 justify-between" data-testid={`factura-itbis-${r.tasa.replace(".", "_")}`}>
              <span>ITBIS {Number(r.tasa)}%</span>
              <span>{formatoMoney(r.itbis)}</span>
            </div>
          ))}
          <div className="flex w-64 justify-between border-t border-zinc-300 pt-1 text-base font-bold dark:border-zinc-700">
            <span>TOTAL</span>
            <span data-testid="factura-total">{formatoMoney(data.total)}</span>
          </div>
          <div className="flex w-64 justify-between">
            <span>Forma de pago</span>
            <span data-testid="factura-forma-pago">{formaPago}</span>
          </div>
          {saldo !== null && Number(saldo.saldoPendiente) !== 0 ? (
            <div className="flex w-64 justify-between">
              <span>Saldo pendiente</span>
              <span data-testid="factura-saldo-pendiente">{formatoMoney(saldo.saldoPendiente)}</span>
            </div>
          ) : null}
        </section>

        <footer className="mt-4 border-t border-dashed border-zinc-300 pt-2 text-center text-xs text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
          Comprobante sujeto a la normativa fiscal de la DGII (Decreto 254-06). Reimpresión de un
          documento ya emitido; no genera un nuevo NCF.
        </footer>
      </article>
    </div>
  );
}
