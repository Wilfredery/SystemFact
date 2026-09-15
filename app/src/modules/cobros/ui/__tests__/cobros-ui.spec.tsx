/**
 * @jest-environment jsdom
 *
 * Cobros UI (fase-6 PR-4, R-C7 / R-C4 / R-C1-C2 boundary). Same boundary-mock
 * convention as `devolucion/ui/__tests__/return-ui.spec.tsx` and venta's
 * `confirm-ui.spec.tsx`: the `"use server"` actions are replaced with jest.fn() so
 * the screens render against the HTTP DTO contract only — never a database.
 *
 * Pins:
 *   • the board partitions Pendiente / Parcial / En Mora and hides settled rows,
 *     consuming ONLY `consultarSaldoCxcAction` (R-B1/R-C7);
 *   • the payment form's submit is DISABLED ON THE FIRST CLICK (R-C7 non-droppable
 *     line): a rapid double-click fires `registrarCobroAction` exactly once;
 *   • a stable catalog error code surfaces verbatim, no stack traces;
 *   • the estado de cuenta renders each VIGENTE invoice's derived totals/state for
 *     the customer and excludes other customers (R-C7);
 *   • the reprint shows a NON-FISCAL receipt (R-C4) and maps a missing number to
 *     `PAGO_NO_ENCONTRADO`.
 */

import "@testing-library/jest-dom";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { CxcBoardScreen } from "@/modules/cobros/ui/CxcBoardScreen";
import { EstadoDeCuentaScreen } from "@/modules/cobros/ui/EstadoDeCuentaScreen";
import { ReciboReprintScreen } from "@/modules/cobros/ui/ReciboReprintScreen";
import {
  consultarSaldoCxcAction,
  registrarCobroAction,
  consultarReciboAction,
} from "@/modules/cobros/http/actions";
import type { SaldoCxCVista } from "@/modules/cobros/application/consultar-saldo-cxc";

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
  registrarCobroAction: jest.fn(),
  consultarReciboAction: jest.fn(),
}));

const mockSaldo = jest.mocked(consultarSaldoCxcAction);
const mockCobro = jest.mocked(registrarCobroAction);
const mockRecibo = jest.mocked(consultarReciboAction);

function fila(over: Partial<SaldoCxCVista> & { facturaId: number }): SaldoCxCVista {
  return {
    clienteId: 10,
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

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  mockSaldo.mockReset();
  mockCobro.mockReset();
  mockRecibo.mockReset();
});
afterEach(cleanup);

describe("CxC board (R-C7 buckets, canonical query only)", () => {
  it("partitions Pendiente / Parcial / En Mora and hides a settled invoice", async () => {
    mockSaldo.mockResolvedValue({
      ok: true,
      data: [
        fila({ facturaId: 1 }),
        fila({ facturaId: 2, estadoPago: "PARCIAL", cobrosAplicados: "400.00", saldoPendiente: "600.00" }),
        fila({ facturaId: 3, enMora: true }),
        fila({ facturaId: 4, estadoPago: "PAGADA", cobrosAplicados: "1000.00", saldoPendiente: "0.00" }),
      ],
    });
    render(<CxcBoardScreen />);
    await settle();

    expect(mockSaldo).toHaveBeenCalledTimes(1);
    expect(mockSaldo).toHaveBeenCalledWith({});
    expect(screen.getByTestId("cxc-fila-1")).toBeInTheDocument();
    expect(screen.getByTestId("cxc-fila-2")).toBeInTheDocument();
    expect(screen.getByTestId("cxc-fila-3")).toBeInTheDocument();
    // The fully settled invoice is not collectable → never on the board.
    expect(screen.queryByTestId("cxc-fila-4")).toBeNull();
    // The mora row is labelled En Mora.
    expect(screen.getByTestId("cxc-fila-3").textContent).toContain("En mora");
  });
});

describe("Payment form first-click disable (R-C7 non-droppable line)", () => {
  it("disables submit on the FIRST click and a rapid double-click calls the action once", async () => {
    mockSaldo.mockResolvedValue({ ok: true, data: [fila({ facturaId: 1 })] });
    render(<CxcBoardScreen />);
    await settle();

    // Open the inline payment form on the pending row.
    fireEvent.click(screen.getByRole("button", { name: "Cobrar factura 1" }));
    const submit = await screen.findByRole("button", { name: "Confirmar cobro factura 1" });

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

    fireEvent.click(submit);
    expect(submit).toBeDisabled();
    // Same-cycle second click must NOT fire a second collection (single-shot).
    fireEvent.click(submit);
    expect(mockCobro).toHaveBeenCalledTimes(1);
    expect(mockCobro).toHaveBeenCalledWith({ facturaId: 1, monto: "1000.00" });

    resolver!({
      ok: true,
      data: { pagoId: 500, correlativoRecibo: 42, total: "1000.00", saldoPendiente: "0.00" },
    });
    await settle();
    const status = await screen.findByRole("status");
    expect(status.textContent).toContain("Cobro registrado");
    // The success links to the (non-fiscal) reprint page.
    expect(
      screen.getByRole("link", { name: "Reimprimir recibo 42" }),
    ).toBeInTheDocument();
  });

  it("surfaces the stable over-payment code without stack traces and re-enables", async () => {
    mockSaldo.mockResolvedValue({ ok: true, data: [fila({ facturaId: 1 })] });
    render(<CxcBoardScreen />);
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Cobrar factura 1" }));

    mockCobro.mockResolvedValue({
      ok: false,
      error: { code: "COBRO_EXCEDE_SALDO", message: "El cobro supera el saldo pendiente de la factura" },
    });
    const submit = screen.getByRole("button", { name: "Confirmar cobro factura 1" });
    fireEvent.click(submit);

    const status = await screen.findByRole("status");
    expect(status.textContent).toContain("[COBRO_EXCEDE_SALDO]");
    expect(status.textContent).toContain("supera el saldo");
    expect(status.textContent).not.toMatch(/at .*\.ts|Prisma|Error:/);
    // Back to enabled: the server revalidated, nothing persisted.
    expect(
      await screen.findByRole("button", { name: "Confirmar cobro factura 1" }),
    ).toBeEnabled();
  });
});

describe("Estado de cuenta (R-C7 derived facts, mixed-state customer)", () => {
  it("renders each VIGENTE invoice's derived totals and excludes other customers", async () => {
    mockSaldo.mockResolvedValue({
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

    // Statement shows the whole account: pending, partial AND the settled invoice.
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
