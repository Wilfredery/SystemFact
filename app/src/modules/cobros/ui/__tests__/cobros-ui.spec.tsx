/**
 * @jest-environment jsdom
 *
 * Cobros UI (fase-6 PR-4, R-C7 / R-C4 / R-C1-C2 boundary; R-C9 server page).
 * Same boundary-mock convention as `devolucion/ui/__tests__/return-ui.spec.tsx`
 * and venta's `confirm-ui.spec.tsx`: the `"use server"` actions are replaced
 * with jest.fn() so the screens render against the HTTP DTO contract only —
 * never a database.
 *
 * Pins:
 *   • the board renders the SERVER page's classified buckets (R-C9: paged
 *     metadata `{filas, total, page, pageSize, totalPages}`), navigates by
 *     page number honoring `totalPages`, and hides a settled row via the pure
 *     client classifier — consuming ONLY `consultarSaldoCxcAction` (R-B1/R-C9);
 *   • the statement reads the WHOLE account through the dedicated
 *     `consultarEstadoDeCuentaAction` (R-C7, the board's outstanding-filtered
 *     page would lose the settled rows);
 *   • the payment form's submit is DISABLED ON THE FIRST CLICK (R-C7 non-droppable
 *     line): a rapid double-click fires `registrarCobroAction` exactly once;
 *   • a stable catalog error code surfaces verbatim, no stack traces;
 *   • the reprint shows a NON-FISCAL receipt (R-C4) and maps a missing number to
 *     `PAGO_NO_ENCONTRADO`.
 */

import "@testing-library/jest-dom";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { CxcBoardScreen } from "@/modules/cobros/ui/CxcBoardScreen";
import { EstadoDeCuentaScreen } from "@/modules/cobros/ui/EstadoDeCuentaScreen";
import { ReciboReprintScreen } from "@/modules/cobros/ui/ReciboReprintScreen";
import { DetalleFacturaScreen } from "@/modules/cobros/ui/DetalleFacturaScreen";
import {
  consultarEstadoDeCuentaAction,
  consultarSaldoCxcAction,
  obtenerDetalleCxcAction,
  registrarCobroAction,
  consultarReciboAction,
} from "@/modules/cobros/http/actions";
import type {
  ProximaAVencer,
  ResumenTableroCxc,
  SaldoCxCVistaPagina,
  SaldoCxCVistaTablero,
} from "@/modules/cobros/application/consultar-saldo-cxc";
import type { DetalleCxcVista } from "@/modules/cobros/application/consultar-detalle-cxc";

// next/link renders a plain anchor in the test host (no App Router context).
jest.mock("next/link", () => ({
  __esModule: true,
  default: ({
    href,
    children,
    ...rest
  }: {
    readonly href?: string;
    readonly children?: ReactNode;
  }) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const React = require("react");
    return React.createElement("a", { href: href ?? "#", ...rest }, children);
  },
}));
// The reprint-by-number entry navigates via the client router.
jest.mock("next/navigation", () => ({
  __esModule: true,
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), refresh: jest.fn() }),
}));

jest.mock("@/modules/cobros/http/actions", () => ({
  consultarSaldoCxcAction: jest.fn(),
  consultarEstadoDeCuentaAction: jest.fn(),
  obtenerDetalleCxcAction: jest.fn(),
  registrarCobroAction: jest.fn(),
  consultarReciboAction: jest.fn(),
}));

const mockSaldo = jest.mocked(consultarSaldoCxcAction);
const mockEstado = jest.mocked(consultarEstadoDeCuentaAction);
const mockDetalle = jest.mocked(obtenerDetalleCxcAction);
const mockCobro = jest.mocked(registrarCobroAction);
const mockRecibo = jest.mocked(consultarReciboAction);

function fila(
  over: Partial<SaldoCxCVistaTablero> & { facturaId: number },
): SaldoCxCVistaTablero {
  return {
    clienteId: 10,
    clienteNombre: "Ferretería del Valle",
    dias: 12,
    total: "1000.00",
    cobrosAplicados: "0.00",
    saldoPendiente: "1000.00",
    estadoPago: "PENDIENTE",
    enMora: false,
    vencimiento: "2026-01-31",
    creditoHabilitado: true,
    limiteCredito: "5000.00",
    ...over,
  };
}

/** The KPI strip's global figures (S11) — never page-scoped. */
const RESUMEN: ResumenTableroCxc = {
  totalPendiente: "1600.00",
  facturasPendientes: 3,
  enMora: 1,
  saldoEnMora: "1000.00",
};

/** One "Próximas a vencer" entry (S12). */
function proxima(over: Partial<ProximaAVencer> & { facturaId: number }): ProximaAVencer {
  return {
    clienteId: 10,
    clienteNombre: "Ferretería del Valle",
    saldoPendiente: "600.00",
    vencimiento: "2026-02-10",
    diasHastaVencimiento: -3,
    proximidad: "PROXIMA",
    ...over,
  };
}

/** Wrap one page's rows into the typed server metadata payload (R-C9/D4). */
function servida(
  filas: readonly SaldoCxCVistaTablero[],
  over: Partial<Omit<SaldoCxCVistaPagina, "filas">> = {},
): SaldoCxCVistaPagina {
  return {
    filas,
    total: filas.length,
    page: 1,
    pageSize: 25,
    totalPages: 1,
    resumen: RESUMEN,
    proximas: [],
    ...over,
  };
}

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  mockSaldo.mockReset();
  mockEstado.mockReset();
  mockDetalle.mockReset();
  mockCobro.mockReset();
  mockRecibo.mockReset();
});
afterEach(cleanup);

describe("CxC board (R-C9 server page, buckets classified per page)", () => {
  it("renders the server page's buckets and hides a settled row via the pure classifier", async () => {
    mockSaldo.mockResolvedValue({
      ok: true,
      data: servida([
        fila({ facturaId: 1 }),
        fila({ facturaId: 2, estadoPago: "PARCIAL", cobrosAplicados: "400.00", saldoPendiente: "600.00" }),
        fila({ facturaId: 3, enMora: true }),
        // The SQL wrapper already excludes settled rows (R-C9); the client-side
        // classifier stays the pure-parity defense — this row never lists.
        fila({ facturaId: 4, estadoPago: "PAGADA", cobrosAplicados: "1000.00", saldoPendiente: "0.00" }),
      ]),
    });
    render(<CxcBoardScreen />);
    await settle();

    expect(mockSaldo).toHaveBeenCalledTimes(1);
    expect(mockSaldo).toHaveBeenCalledWith({ page: 1 });
    expect(screen.getByTestId("cxc-fila-1")).toBeInTheDocument();
    expect(screen.getByTestId("cxc-fila-2")).toBeInTheDocument();
    expect(screen.getByTestId("cxc-fila-3")).toBeInTheDocument();
    // The fully settled invoice is not collectable → never on the board.
    expect(screen.queryByTestId("cxc-fila-4")).toBeNull();
    // The mora row is labelled En Mora.
    expect(screen.getByTestId("cxc-fila-3").textContent).toContain("En mora");
  });

  it("shows the client NAME and the SD días outstanding on each row (S10)", async () => {
    mockSaldo.mockResolvedValue({
      ok: true,
      data: servida([
        fila({ facturaId: 1, clienteNombre: "Colmado Ana", dias: 0 }),
        fila({ facturaId: 2, clienteNombre: "Ferretería del Valle", dias: 31 }),
      ]),
    });
    render(<CxcBoardScreen />);
    await settle();

    const primera = screen.getByTestId("cxc-fila-1").textContent ?? "";
    expect(primera).toContain("Colmado Ana");
    expect(primera).toContain("Hoy");

    const segunda = screen.getByTestId("cxc-fila-2").textContent ?? "";
    expect(segunda).toContain("Ferretería del Valle");
    expect(segunda).toContain("31 días");
  });

  it("renders the global KPI strip from the server summary (S11)", async () => {
    mockSaldo.mockResolvedValue({ ok: true, data: servida([fila({ facturaId: 1 })]) });
    render(<CxcBoardScreen />);
    await settle();

    const total = screen.getByTestId("cxc-kpi-total-pendiente").textContent ?? "";
    expect(total).toMatch(/1,600\.00/);
    expect(screen.getByTestId("cxc-kpi-facturas-pendientes").textContent).toBe("3");
    const mora = screen.getByTestId("cxc-kpi-en-mora").textContent ?? "";
    expect(mora).toContain("1");
    expect(mora).toMatch(/1,000\.00/);
    // The wireframe's ">30 días" wording is dropped (S11).
    expect(document.body.textContent).not.toMatch(/>\s*30\s*días/);
  });

  it("searches server-side by client or invoice and re-queries page 1 (S12)", async () => {
    mockSaldo.mockResolvedValue({ ok: true, data: servida([fila({ facturaId: 1 })]) });
    render(<CxcBoardScreen />);
    await settle();

    const buscador = screen.getByLabelText("Buscar cliente o factura");
    fireEvent.change(buscador, { target: { value: "  Ferretería  " } });
    fireEvent.submit(buscador);

    await settle();
    // The raw text rides the transport; the SERVER normalizes it (S12).
    expect(mockSaldo).toHaveBeenLastCalledWith({ page: 1, busqueda: "Ferretería" });

    // Clearing the search returns to the unfiltered board.
    fireEvent.click(screen.getByRole("button", { name: "Limpiar búsqueda" }));
    await settle();
    expect(mockSaldo).toHaveBeenLastCalledWith({ page: 1 });
  });

  it("lists the nearest due invoices with Próxima / Vence hoy / Vencida badges (S12)", async () => {
    mockSaldo.mockResolvedValue({
      ok: true,
      data: servida([fila({ facturaId: 1 })], {
        proximas: [
          proxima({ facturaId: 21, clienteNombre: "Colmado Ana" }),
          proxima({ facturaId: 22, diasHastaVencimiento: 0, proximidad: "VENCE_HOY" }),
          proxima({ facturaId: 23, diasHastaVencimiento: 9, proximidad: "VENCIDA" }),
        ],
      }),
    });
    render(<CxcBoardScreen />);
    await settle();

    const panel = screen.getByRole("complementary", { name: "Próximas a vencer" });
    expect(panel.textContent).toContain("Colmado Ana");
    expect(screen.getByTestId("cxc-proxima-21").textContent).toContain("Próxima");
    expect(screen.getByTestId("cxc-proxima-22").textContent).toContain("Vence hoy");
    expect(screen.getByTestId("cxc-proxima-23").textContent).toContain("Vencida");
    // No Estado dropdown was introduced (S12 rejects it).
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("navigates server pages honoring totalPages (Anterior disabled on page 1)", async () => {
    mockSaldo.mockResolvedValue({
      ok: true,
      data: servida([fila({ facturaId: 1 })], { total: 70, page: 1, totalPages: 3 }),
    });
    render(<CxcBoardScreen />);
    await settle();

    expect(mockSaldo).toHaveBeenCalledWith({ page: 1 });
    expect(screen.getByText("Página 1 de 3")).toBeInTheDocument();
    const anterior = screen.getByRole("button", { name: "Página anterior" });
    expect(anterior).toBeDisabled();
    const siguiente = screen.getByRole("button", { name: "Página siguiente" });
    expect(siguiente).toBeEnabled();

    mockSaldo.mockResolvedValue({
      ok: true,
      data: servida([fila({ facturaId: 46 })], { total: 70, page: 2, totalPages: 3 }),
    });
    fireEvent.click(siguiente);
    await settle();

    expect(mockSaldo).toHaveBeenCalledWith({ page: 2 });
    expect(screen.getByText("Página 2 de 3")).toBeInTheDocument();
    expect(screen.getByTestId("cxc-fila-46")).toBeInTheDocument();
    expect(screen.queryByTestId("cxc-fila-1")).toBeNull();
    expect(screen.getByRole("button", { name: "Página anterior" })).toBeEnabled();
  });
});

/** Today's `America/Santo_Domingo` calendar day — the default Fecha del pago (S14). */
function hoySD(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Santo_Domingo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/** Open the shared confirmation modal from the board's inline Cobrar affordance. */
async function abrirModalTablero(facturaId: number): Promise<HTMLElement> {
  fireEvent.click(screen.getByRole("button", { name: `Cobrar factura ${facturaId}` }));
  return screen.findByRole("dialog");
}

describe("Payment confirmation modal (S15 — 03-Modal-Confirmar-Pago)", () => {
  it("opens from the board's Cobrar affordance with the wireframe content", async () => {
    mockSaldo.mockResolvedValue({ ok: true, data: servida([fila({ facturaId: 1 })]) });
    render(<CxcBoardScreen />);
    await settle();

    const dialog = await abrirModalTablero(1);

    // 03-Modal-Confirmar-Pago: Monto del pago + Saldo pendiente + Método + confirm.
    expect(dialog.textContent).toContain("Confirmar Pago");
    const monto = within(dialog).getByLabelText("Monto del pago factura 1");
    expect(monto).toHaveValue("1000.00");
    expect(monto).toHaveAttribute("inputmode", "decimal");
    expect(within(dialog).getByTestId("cobro-saldo-pendiente-1").textContent).toMatch(
      /1,000\.00/,
    );
    // Método stays FROZEN to EFECTIVO (V1): a display, never a selector.
    expect(within(dialog).getByTestId("cobro-metodo-pago-1").textContent).toBe("EFECTIVO");
    expect(within(dialog).queryByRole("combobox")).toBeNull();
    expect(within(dialog).queryByRole("listbox")).toBeNull();
    // S14 fields: an editable SD payment date (default today) and a reference.
    expect(within(dialog).getByLabelText("Fecha del pago factura 1")).toHaveValue(hoySD());
    expect(within(dialog).getByLabelText("Referencia factura 1")).toHaveValue("");
    // Nothing is confirmed server-side just by opening the modal.
    expect(mockCobro).not.toHaveBeenCalled();
  });

  it("feeds the monto input from the shared NumericKeypad (touch-first entry)", async () => {
    mockSaldo.mockResolvedValue({ ok: true, data: servida([fila({ facturaId: 1 })]) });
    render(<CxcBoardScreen />);
    await settle();
    const dialog = await abrirModalTablero(1);

    const monto = within(dialog).getByLabelText("Monto del pago factura 1");
    // Focusing the money input retargets the keypad onto it (PosScreen pattern).
    fireEvent.focus(monto);
    fireEvent.click(within(dialog).getByRole("button", { name: "CLR" }));
    expect(monto).toHaveValue("");
    for (const tecla of ["5", "0", "0"]) {
      fireEvent.click(within(dialog).getByRole("button", { name: tecla }));
    }
    expect(monto).toHaveValue("500");
    // The SHARED decimal parser still floors money at 2 decimals.
    fireEvent.click(within(dialog).getByRole("button", { name: "." }));
    for (const tecla of ["2", "5", "9"]) {
      fireEvent.click(within(dialog).getByRole("button", { name: tecla }));
    }
    expect(monto).toHaveValue("500.25");
    // Backspace drops the last digit, never below empty.
    fireEvent.click(within(dialog).getByRole("button", { name: "BSP" }));
    expect(monto).toHaveValue("500.2");
  });

  it("offers Exact (saldo pendiente) plus RD$100/200/500/1000/2000/5000", async () => {
    mockSaldo.mockResolvedValue({ ok: true, data: servida([fila({ facturaId: 1 })]) });
    render(<CxcBoardScreen />);
    await settle();
    const dialog = await abrirModalTablero(1);

    const monto = within(dialog).getByLabelText("Monto del pago factura 1");
    for (const valor of [100, 200, 500, 1000, 2000, 5000]) {
      expect(
        within(dialog).getByRole("button", { name: `Quick amount ${valor}` }),
      ).toBeInTheDocument();
    }
    // A full abono is one tap: the exact amount IS the derived pending balance.
    fireEvent.click(within(dialog).getByRole("button", { name: "Quick amount exact total" }));
    expect(monto).toHaveValue("1000.00");
    fireEvent.click(within(dialog).getByRole("button", { name: "Quick amount 500" }));
    expect(monto).toHaveValue("500");
  });

  it("confirms exactly once on the first click and sends the editable date + reference", async () => {
    mockSaldo.mockResolvedValue({ ok: true, data: servida([fila({ facturaId: 1 })]) });
    render(<CxcBoardScreen />);
    await settle();
    const dialog = await abrirModalTablero(1);

    fireEvent.change(within(dialog).getByLabelText("Fecha del pago factura 1"), {
      target: { value: "2026-08-10" },
    });
    fireEvent.change(within(dialog).getByLabelText("Referencia factura 1"), {
      target: { value: "  REF-9  " },
    });

    // Controllable pending promise so `enviando` stays true across the double click.
    let resolver:
      | ((v: { ok: true; data: { pagoId: number; correlativoRecibo: number; total: string; saldoPendiente: string } }) => void)
      | null = null;
    mockCobro.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolver = resolve;
        }),
    );

    const submit = within(dialog).getByRole("button", { name: "Confirmar pago factura 1" });
    fireEvent.click(submit);
    expect(submit).toBeDisabled();
    // Same-cycle second click must NOT fire a second collection (single-shot).
    fireEvent.click(submit);
    expect(mockCobro).toHaveBeenCalledTimes(1);
    expect(mockCobro).toHaveBeenCalledWith({
      facturaId: 1,
      monto: "1000.00",
      fechaCobro: "2026-08-10",
      referencia: "REF-9",
    });

    resolver!({
      ok: true,
      data: { pagoId: 500, correlativoRecibo: 42, total: "1000.00", saldoPendiente: "0.00" },
    });
    await settle();
    const status = await screen.findByRole("status");
    expect(status.textContent).toContain("Pago registrado");
    // Success feedback links to the (non-fiscal) reprint page.
    expect(screen.getByRole("link", { name: "Reimprimir recibo 42" })).toHaveAttribute(
      "href",
      "/cobros/recibo/42",
    );
    // The board reloaded through the canonical read (nothing summed client-side).
    expect(mockSaldo).toHaveBeenCalledTimes(2);
  });

  it("omits a blank reference from the payload", async () => {
    mockSaldo.mockResolvedValue({ ok: true, data: servida([fila({ facturaId: 1 })]) });
    render(<CxcBoardScreen />);
    await settle();
    const dialog = await abrirModalTablero(1);

    mockCobro.mockResolvedValue({
      ok: true,
      data: { pagoId: 500, correlativoRecibo: 42, total: "1000.00", saldoPendiente: "0.00" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirmar pago factura 1" }));
    await settle();

    expect(mockCobro).toHaveBeenCalledTimes(1);
    const payload = mockCobro.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload.fechaCobro).toBe(hoySD());
    expect(payload.referencia).toBeUndefined();
  });

  it("surfaces the stable over-payment code without stack traces and re-enables", async () => {
    mockSaldo.mockResolvedValue({ ok: true, data: servida([fila({ facturaId: 1 })]) });
    render(<CxcBoardScreen />);
    await settle();
    const dialog = await abrirModalTablero(1);

    mockCobro.mockResolvedValue({
      ok: false,
      error: { code: "COBRO_EXCEDE_SALDO", message: "El cobro supera el saldo pendiente de la factura" },
    });
    const submit = within(dialog).getByRole("button", { name: "Confirmar pago factura 1" });
    fireEvent.click(submit);

    const status = await screen.findByRole("status");
    expect(status.textContent).toContain("[COBRO_EXCEDE_SALDO]");
    expect(status.textContent).toContain("supera el saldo");
    expect(status.textContent).not.toMatch(/at .*\.ts|Prisma|Error:/);
    // Back to enabled: the server revalidated, nothing persisted.
    expect(
      within(dialog).getByRole("button", { name: "Confirmar pago factura 1" }),
    ).toBeEnabled();
  });

  it("surfaces the fecha-band catalog code when the server rejects the date", async () => {
    mockSaldo.mockResolvedValue({ ok: true, data: servida([fila({ facturaId: 1 })]) });
    render(<CxcBoardScreen />);
    await settle();
    const dialog = await abrirModalTablero(1);

    mockCobro.mockResolvedValue({
      ok: false,
      error: { code: "FECHA_COBRO_FUTURA", message: "La fecha del pago no puede ser futura" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirmar pago factura 1" }));

    const status = await screen.findByRole("status");
    expect(status.textContent).toContain("[FECHA_COBRO_FUTURA]");
    expect(status.textContent).toContain("no puede ser futura");
  });
});

describe("Estado de cuenta (R-C7 derived facts, mixed-state customer)", () => {
  it("renders each VIGENTE invoice's derived totals and excludes other customers", async () => {
    mockEstado.mockResolvedValue({
      ok: true,
      data: [
        fila({ facturaId: 1 }),
        fila({ facturaId: 2, estadoPago: "PARCIAL", cobrosAplicados: "400.00", saldoPendiente: "600.00" }),
        fila({ facturaId: 3, estadoPago: "PAGADA", cobrosAplicados: "1000.00", saldoPendiente: "0.00" }),
        fila({ facturaId: 9, clienteId: 99 }), // other customer → excluded
      ],
    });
    render(<EstadoDeCuentaScreen clienteId={10} />);
    await settle();

    // The statement rides the DEDICATED full read (whole account: pending,
    // partial AND the settled invoice).
    expect(mockEstado).toHaveBeenCalledTimes(1);
    expect(mockEstado).toHaveBeenCalledWith({});
    expect(screen.getByTestId("estado-cuenta-fila-1")).toBeInTheDocument();
    expect(screen.getByTestId("estado-cuenta-fila-2")).toBeInTheDocument();
    expect(screen.getByTestId("estado-cuenta-fila-3")).toBeInTheDocument();
    expect(screen.queryByTestId("estado-cuenta-fila-9")).toBeNull();

    const parcial = screen.getByTestId("estado-cuenta-fila-2").textContent ?? "";
    expect(parcial).toContain("Parcial");
    expect(parcial).toMatch(/400\.00/); // cobros aplicados
    expect(parcial).toMatch(/600\.00/); // pendiente

    const pagada = screen.getByTestId("estado-cuenta-fila-3").textContent ?? "";
    expect(pagada).toContain("Pagada");

    // Total pendiente = 1000.00 + 600.00 + 0.00 = 1600.00 (Decimal, no float drift).
    const total = screen.getByTestId("estado-cuenta-pendiente-total").textContent ?? "";
    expect(total).toMatch(/1,600\.00/);
  });
});

describe("Receipt reprint (R-C4 non-fiscal)", () => {
  it("renders a non-fiscal receipt with the correlativo and amount", async () => {
    mockRecibo.mockResolvedValue({
      ok: true,
      data: {
        correlativoRecibo: 42,
        tipo: "COBRO",
        estado: "APLICADO",
        monto: "1500.00",
        metodoPago: "EFECTIVO",
        fecha: "2026-02-01T10:00:00.000Z",
        autorizadoPor: null,
        facturaId: 77,
        facturaNcf: "B0100000077",
        clienteNombre: "Ferretería del Valle",
        usuarioNombre: "Ana",
        empresaNombre: "Abarrotes SS",
      },
    });
    render(<ReciboReprintScreen correlativo={42} />);
    await settle();

    expect(mockRecibo).toHaveBeenCalledWith({ correlativoRecibo: 42 });
    expect(screen.getByTestId("recibo-correlativo").textContent).toBe("42");
    expect(screen.getByTestId("recibo-monto").textContent).toMatch(/1,500\.00/);
    // Explicit non-fiscal banner (R-C4).
    expect(screen.getByTestId("recibo-reprint").textContent).toContain("no fiscal");
  });

  it("maps a missing/foreign number to the PAGO_NO_ENCONTRADO catalog code", async () => {
    mockRecibo.mockResolvedValue({
      ok: false,
      error: { code: "PAGO_NO_ENCONTRADO", message: "El pago no existe en la empresa" },
    });
    render(<ReciboReprintScreen correlativo={999} />);
    await settle();

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("[PAGO_NO_ENCONTRADO]");
    expect(alert.textContent).not.toMatch(/Prisma|Error:|at /);
  });
});

/** One per-invoice detail payload (S13) — the HTTP DTO the screen renders. */
function detalle(over: Partial<DetalleCxcVista> = {}): DetalleCxcVista {
  return {
    facturaId: 12,
    ncf: "B0200001218",
    correlativoInterno: "FAC-001218",
    fechaEmision: "2026-07-01T16:00:00.000Z",
    vencimiento: "2026-07-31",
    clienteId: 3,
    clienteNombre: "Ana Martínez",
    clienteRnc: "123-45678-9",
    tipoCliente: "CREDITO",
    total: "82500.00",
    abonado: "0.00",
    saldo: "82500.00",
    diasVencida: 36,
    enMora: true,
    historial: [],
    ...over,
  };
}

describe("Detalle de factura (S13 per-invoice detail)", () => {
  it("renders the invoice header, the derived mora badge and the días vencida", async () => {
    mockDetalle.mockResolvedValue({ ok: true, data: detalle() });
    render(<DetalleFacturaScreen facturaId={12} />);
    await settle();

    // It reads ONLY the per-invoice detail action, tenant-scoped by the payload.
    expect(mockDetalle).toHaveBeenCalledTimes(1);
    expect(mockDetalle).toHaveBeenCalledWith({ facturaId: 12 });

    const cabecera = screen.getByTestId("detalle-factura-cabecera").textContent ?? "";
    expect(cabecera).toContain("FAC-001218");
    expect(cabecera).toContain("B0200001218");
    expect(cabecera).toContain("Ana Martínez");
    expect(cabecera).toContain("123-45678-9");
    expect(cabecera).toContain("Crédito");
    expect(cabecera).toMatch(/82,500\.00/); // Total
    expect(cabecera).toContain("En Mora");
    expect(cabecera).toContain("36 días vencida");

    // The header itself stays read-only: no payment entry outside the modal.
    expect(screen.queryByLabelText(/Fecha del pago/i)).toBeNull();
    expect(screen.queryByLabelText(/Referencia/i)).toBeNull();
  });

  it("shows a CONTADO client as Contado and hides the mora badge when not overdue", async () => {
    mockDetalle.mockResolvedValue({
      ok: true,
      data: detalle({ tipoCliente: "MINORISTA", enMora: false, diasVencida: -21 }),
    });
    render(<DetalleFacturaScreen facturaId={12} />);
    await settle();

    const cabecera = screen.getByTestId("detalle-factura-cabecera").textContent ?? "";
    expect(cabecera).toContain("Contado");
    expect(cabecera).not.toContain("En Mora");
    expect(cabecera).not.toContain("días vencida");
  });

  it("lists the payment history newest-first and shows the empty state", async () => {
    mockDetalle.mockResolvedValue({
      ok: true,
      data: detalle({
        abonado: "1500.00",
        saldo: "81000.00",
        historial: [
          {
            correlativoRecibo: 43,
            fecha: "2026-08-03T10:00:00.000Z",
            tipo: "COBRO",
            estado: "APLICADO",
            monto: "500.00",
            metodoPago: "EFECTIVO",
            referencia: null,
            usuarioNombre: "Ana",
          },
          {
            correlativoRecibo: 42,
            fecha: "2026-08-02T14:00:00.000Z",
            tipo: "REEMBOLSO",
            estado: "REGISTRADO",
            monto: "100.00",
            metodoPago: "EFECTIVO",
            referencia: "REF-9",
            usuarioNombre: "Luis",
          },
        ],
      }),
    });
    const { unmount } = render(<DetalleFacturaScreen facturaId={12} />);
    await settle();

    const filaAlta = screen.getByTestId("detalle-pago-43").textContent ?? "";
    expect(filaAlta).toMatch(/500\.00/);
    expect(filaAlta).toContain("Cobro");
    expect(filaAlta).toContain("Ana");
    expect(filaAlta).toContain("43");
    // The SD calendar day of the UTC instant (2026-08-03T10:00Z → 06:00 SD, same day).
    expect(filaAlta).toContain("03/08/2026");
    const filaBaja = screen.getByTestId("detalle-pago-42").textContent ?? "";
    expect(filaBaja).toContain("Reembolso");
    expect(filaBaja).toContain("REF-9");

    unmount();
    mockDetalle.mockResolvedValue({ ok: true, data: detalle() });
    render(<DetalleFacturaScreen facturaId={12} />);
    await settle();
    expect(screen.getByText("Sin pagos registrados")).toBeInTheDocument();
  });

  it("opens the shared confirmation modal from the Registrar Pago panel and confirms ONE payment", async () => {
    mockDetalle.mockResolvedValue({ ok: true, data: detalle() });
    render(<DetalleFacturaScreen facturaId={12} />);
    await settle();

    // S15: the panel's confirm is an explicit modal (F0 dialog), not an inline form.
    expect(screen.getByTestId("detalle-saldo-pendiente").textContent).toMatch(
      /82,500\.00/,
    );
    fireEvent.click(screen.getByRole("button", { name: "Registrar Pago" }));
    const dialog = await screen.findByRole("dialog");

    const monto = within(dialog).getByLabelText("Monto del pago factura 12");
    // Prefilled with the derived pending balance.
    expect(monto).toHaveValue("82500.00");
    expect(monto).toHaveAttribute("inputmode", "decimal");
    expect(within(dialog).getByTestId("cobro-saldo-pendiente-12").textContent).toMatch(
      /82,500\.00/,
    );
    expect(within(dialog).getByLabelText("Fecha del pago factura 12")).toHaveValue(hoySD());
    expect(within(dialog).getByLabelText("Referencia factura 12")).toHaveValue("");

    let resolver:
      | ((v: {
          ok: true;
          data: { pagoId: number; correlativoRecibo: number; total: string; saldoPendiente: string };
        }) => void)
      | null = null;
    mockCobro.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolver = resolve;
        }),
    );

    const submit = within(dialog).getByRole("button", { name: "Confirmar pago factura 12" });
    fireEvent.click(submit);
    expect(submit).toBeDisabled();
    fireEvent.click(submit);
    expect(mockCobro).toHaveBeenCalledTimes(1);
    expect(mockCobro).toHaveBeenCalledWith({
      facturaId: 12,
      monto: "82500.00",
      fechaCobro: hoySD(),
    });

    // The reload serves the updated derived saldo (never a client-side sum).
    mockDetalle.mockResolvedValue({
      ok: true,
      data: detalle({ abonado: "82500.00", saldo: "0.00", enMora: false, diasVencida: 36 }),
    });
    resolver!({
      ok: true,
      data: { pagoId: 500, correlativoRecibo: 42, total: "82500.00", saldoPendiente: "0.00" },
    });
    await settle();

    expect(mockDetalle).toHaveBeenCalledTimes(2);
    const status = await screen.findByRole("status");
    expect(status.textContent).toContain("Pago registrado");
    expect(status.textContent).toMatch(/0\.00/);
    expect(screen.getByRole("link", { name: "Reimprimir recibo 42" })).toHaveAttribute(
      "href",
      "/cobros/recibo/42",
    );
  });

  it("surfaces the stable over-payment code without stack traces and re-enables", async () => {
    mockDetalle.mockResolvedValue({ ok: true, data: detalle() });
    render(<DetalleFacturaScreen facturaId={12} />);
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Registrar Pago" }));
    const dialog = await screen.findByRole("dialog");

    mockCobro.mockResolvedValue({
      ok: false,
      error: {
        code: "COBRO_EXCEDE_SALDO",
        message: "El cobro supera el saldo pendiente de la factura; ajuste el monto",
      },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirmar pago factura 12" }));

    const status = await screen.findByRole("status");
    expect(status.textContent).toContain("[COBRO_EXCEDE_SALDO]");
    expect(status.textContent).toContain("supera el saldo");
    expect(status.textContent).not.toMatch(/at .*\.ts|Prisma|Error:/);
    expect(
      within(dialog).getByRole("button", { name: "Confirmar pago factura 12" }),
    ).toBeEnabled();
  });

  it("offers Volver back to the collections board", async () => {
    mockDetalle.mockResolvedValue({ ok: true, data: detalle() });
    render(<DetalleFacturaScreen facturaId={12} />);
    await settle();

    expect(screen.getByRole("link", { name: "Volver" })).toHaveAttribute(
      "href",
      "/cobros/cxc-board",
    );
  });

  it("surfaces the catalog error when the invoice is missing or not VIGENTE", async () => {
    mockDetalle.mockResolvedValue({
      ok: false,
      error: {
        code: "FACTURA_COBRO_NO_VIGENTE",
        message: "La factura no está vigente; no se puede registrar un cobro",
      },
    });
    render(<DetalleFacturaScreen facturaId={99} />);
    await settle();

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("[FACTURA_COBRO_NO_VIGENTE]");
    expect(alert.textContent).not.toMatch(/Prisma|Error:|at /);
  });

  it("navigates a board row to the detail route while the Cobrar modal still works", async () => {
    mockSaldo.mockResolvedValue({ ok: true, data: servida([fila({ facturaId: 1 })]) });
    render(<CxcBoardScreen />);
    await settle();
    // Additive navigation: the detail link sits next to the Cobrar affordance.
    expect(
      screen.getByRole("link", { name: "Ver detalle factura 1" }),
    ).toHaveAttribute("href", "/cobros/factura/1");
    const dialog = await abrirModalTablero(1);
    expect(within(dialog).getByLabelText("Monto del pago factura 1")).toHaveValue(
      "1000.00",
    );
  });
});
