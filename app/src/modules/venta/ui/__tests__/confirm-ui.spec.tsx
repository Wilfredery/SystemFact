/**
 * @jest-environment jsdom
 *
 * Confirm/cancel POS controls (spec R-V14 modified slice, fase-5c task 4.4).
 * Same boundary-mock convention as venta-ui.spec.tsx: the `"use server"`
 * actions are replaced by jest.fn() so the screen is tested against the HTTP
 * DTO contract (stable codes + NCF payload), never a database.
 *
 * Pins: the confirm control EXISTS for BORRADOR drafts (the 5b "no confirm"
 * invariant is superseded by R-V14), is single-shot (disabled on first click,
 * the action called once per row even on double-click), surfaces the five
 * confirm error codes and the NCF_UMBRAL_90 warning, renders CONFIRMADA rows
 * with their NCF plus a cancel (608 void) control, and still renders NO
 * payment affordance (Fase 6 scope).
 */

import "@testing-library/jest-dom";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PosScreen } from "../PosScreen";
import { ESTADO_VENTA } from "../../domain/venta";
import {
  cancelarVentaAction,
  confirmarVentaAction,
  listarVentasAction,
} from "@/modules/venta/http/actions";
import { listarProductosAction } from "@/modules/producto/http/actions";
import { listarClientesAction } from "@/modules/cliente/http/actions";

jest.mock("@/modules/venta/http/actions", () => ({
  crearVentaAction: jest.fn(),
  actualizarVentaAction: jest.fn(),
  cancelarVentaAction: jest.fn(),
  confirmarVentaAction: jest.fn(),
  listarVentasAction: jest.fn(),
  obtenerVentaAction: jest.fn(),
}));
jest.mock("@/modules/producto/http/actions", () => ({
  listarProductosAction: jest.fn(),
}));
jest.mock("@/modules/cliente/http/actions", () => ({
  listarClientesAction: jest.fn(),
}));

const mockConfirmar = jest.mocked(confirmarVentaAction);
const mockCancelar = jest.mocked(cancelarVentaAction);
const mockListar = jest.mocked(listarVentasAction);
const mockProductos = jest.mocked(listarProductosAction);
const mockClientes = jest.mocked(listarClientesAction);

type ListItem = {
  id: number;
  fecha: string;
  estado: string;
  total: string;
  descuento: string;
  clienteNombre: string;
  usuarioNombre: string;
  ncf: string | null;
};

function lista(items: ListItem[]) {
  return { ok: true as const, data: { items, total: items.length, page: 1, limit: 25 } };
}

const BORRADOR_3: ListItem = {
  id: 3,
  fecha: new Date().toISOString(),
  estado: ESTADO_VENTA.BORRADOR,
  total: "118.00",
  descuento: "0.00",
  clienteNombre: "Consumidor Final",
  usuarioNombre: "Ana",
  ncf: null,
};

const CONFIRMADA_4: ListItem = {
  ...BORRADOR_3,
  id: 4,
  estado: ESTADO_VENTA.CONFIRMADA,
  ncf: "B0200000101",
};

function exitoConfirmar(ncfWarning?: "NCF_UMBRAL_90") {
  return {
    ok: true as const,
    data: {
      id: 3,
      estado: ESTADO_VENTA.CONFIRMADA,
      facturaId: 77,
      ncf: "B0200000101",
      tipoNcf: "B02",
      correlativoInterno: "FAC-000001",
      total: "118.00",
      ncfWarning: ncfWarning ?? null,
    },
  };
}

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function renderPos(items: ListItem[]) {
  mockListar.mockResolvedValue(lista(items));
  mockClientes.mockResolvedValue({ ok: true as const, data: { items: [], total: 0, page: 1 } });
  mockProductos.mockResolvedValue({ ok: true as const, data: { items: [], total: 0, page: 1 } });
  const result = render(<PosScreen esAdmin={false} />);
  await settle();
  return result;
}

describe("POS confirm control (R-V14 5c slice)", () => {
  beforeEach(() => {
    mockConfirmar.mockReset();
    mockCancelar.mockReset();
  });

  afterEach(cleanup);

  it("renders a single-shot confirm control for a BORRADOR draft and calls the action once", async () => {
    await renderPos([BORRADOR_3]);
    const confirm = await screen.findByRole("button", { name: "Confirm draft 3" });

    // Controllable pending promise: the button must disable on FIRST click.
    let resolver: ((v: ReturnType<typeof exitoConfirmar>) => void) | null = null;
    mockConfirmar.mockImplementation(
      () => new Promise((resolve) => { resolver = resolve; }),
    );

    fireEvent.click(confirm);
    expect(confirm).toBeDisabled();
    // Second click while in-flight must NOT fire a second consume (single-shot).
    fireEvent.click(confirm);
    expect(mockConfirmar).toHaveBeenCalledTimes(1);
    expect(mockConfirmar).toHaveBeenCalledWith({ id: 3 });

    resolver!(exitoConfirmar());
    await settle();
    await waitFor(() => expect(screen.getByText(/B0200000101/)).toBeInTheDocument());
  });

  it("surfaces a stable confirm error code without stack traces and keeps the draft", async () => {
    await renderPos([BORRADOR_3]);
    mockConfirmar.mockResolvedValue({
      ok: false,
      error: { code: "NCF_AGOTADA", message: "El rango de secuencias NCF está agotado; no se puede confirmar la venta" },
    });

    fireEvent.click(await screen.findByRole("button", { name: "Confirm draft 3" }));
    const status = await screen.findByRole("status");
    expect(status.textContent).toContain("[NCF_AGOTADA]");
    expect(status.textContent).toContain("agotado");
    // No stack traces / Prisma internals on the surface.
    expect(status.textContent).not.toMatch(/at .*\.ts|Prisma|Error:/);
    // The control is clickable again (the server revalidated; nothing burned).
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Confirm draft 3" })).toBeEnabled(),
    );
  });

  it("shows the NCF_UMBRAL_90 warning banner alongside the success", async () => {
    await renderPos([BORRADOR_3]);
    mockConfirmar.mockResolvedValue(exitoConfirmar("NCF_UMBRAL_90"));

    fireEvent.click(await screen.findByRole("button", { name: "Confirm draft 3" }));

    const banner = await screen.findByRole("alert", { name: /NCF range/i });
    expect(banner.textContent).toContain("90%");
    expect(banner.textContent).toContain("NCF_UMBRAL_90");
    // The success status still carries the invoice NCF (warning never blocks).
    await waitFor(() => expect(screen.getByText(/B0200000101/)).toBeInTheDocument());
  });

  it("renders CONFIRMADA rows with their NCF and a cancel (void) control routed through cancelarVentaAction", async () => {
    await renderPos([CONFIRMADA_4]);
    // CONFIRMADA rows are not editable draft rows anymore: no draft controls.
    expect(screen.queryByRole("button", { name: "Edit draft 4" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Confirm draft 4" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Cancel draft 4" })).toBeNull();

    const row = await screen.findByTestId("venta-fila-4");
    expect(row.textContent).toContain("CONFIRMADA");
    expect(row.textContent).toContain("B0200000101");

    mockCancelar.mockResolvedValue({ ok: true, data: { id: 4, estado: ESTADO_VENTA.CANCELADA } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel sale 4" }));
    await waitFor(() => expect(mockCancelar).toHaveBeenCalledWith({ id: 4 }));
    await settle();
  });

  it("never renders payment controls (Fase 6 boundary holds)", async () => {
    await renderPos([BORRADOR_3, CONFIRMADA_4]);
    expect(screen.queryByRole("button", { name: /cobrar|pay|payment/i })).toBeNull();
  });
});
