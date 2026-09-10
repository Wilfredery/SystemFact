/**
 * @jest-environment jsdom
 *
 * POS screen component tests (spec R-V14, task 3.5). The `"use server"` action
 * modules are mocked at the HTTP boundary — the screens are tested against the
 * DTO/warning contract, not a database. Cart→totals, the CF default, the
 * admin-only discount gate, the stock-warning banner, the empty-cart guard and
 * the "no confirm affordance" invariant are each pinned.
 */

import "@testing-library/jest-dom";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PosScreen } from "../PosScreen";
import { ESTADO_VENTA } from "../../domain/venta";
import { CONSUMIDOR_FINAL_LABEL } from "../carro";
import {
  cancelarVentaAction,
  crearVentaAction,
  listarVentasAction,
} from "@/modules/venta/http/actions";
import { listarProductosAction } from "@/modules/producto/http/actions";
import { listarClientesAction } from "@/modules/cliente/http/actions";

// The real `"use server"` modules import Prisma/Next runtime and cannot load
// under jsdom; mirror the http-adapter test harness (session/use-case mocks)
// and assert the screen against the transport contract.
jest.mock("@/modules/venta/http/actions", () => ({
  crearVentaAction: jest.fn(),
  actualizarVentaAction: jest.fn(),
  cancelarVentaAction: jest.fn(),
  listarVentasAction: jest.fn(),
  obtenerVentaAction: jest.fn(),
}));
jest.mock("@/modules/producto/http/actions", () => ({
  listarProductosAction: jest.fn(),
}));
jest.mock("@/modules/cliente/http/actions", () => ({
  listarClientesAction: jest.fn(),
  crearClienteAction: jest.fn(),
}));

const mockCrear = jest.mocked(crearVentaAction);
const mockCancelar = jest.mocked(cancelarVentaAction);
const mockListar = jest.mocked(listarVentasAction);
const mockProductos = jest.mocked(listarProductosAction);
const mockClientes = jest.mocked(listarClientesAction);

const PRODUCTO_18 = {
  id: 7,
  codigo: "P-007",
  nombre: "Arroz",
  precioVenta: "10.00",
  tasaItbis: "18",
};

function exitoCrear(id: number, warnings?: readonly { code: "STOCK_INSUFICIENTE"; productoId: number; available: string; requested: string }[]) {
  return {
    ok: true as const,
    data: { id, estado: ESTADO_VENTA.BORRADOR, total: "11.80", subtotalGravado: "10.00", subtotalExento: "0.00" },
    ...(warnings ? { warnings } : {}),
  };
}

async function buscarYAgregar(): Promise<void> {
  fireEvent.change(screen.getByLabelText("Search products"), { target: { value: "arroz" } });
  fireEvent.click(screen.getByRole("button", { name: "Search" }));
  const add = await screen.findByRole("button", { name: "Add" });
  fireEvent.click(add);
}

/**
 * The screen fetches its draft list (and the client list) on mount; `settle`
 * lets those microtasks resolve INSIDE `act` so no state update escapes the
 * test's act boundary.
 */
async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

/** Render the screen and let the mount-time draft/client fetches resolve. */
async function renderPos(esAdmin: boolean) {
  const result = render(<PosScreen esAdmin={esAdmin} />);
  await settle();
  return result;
}

describe("PosScreen (R-V14)", () => {
  beforeEach(() => {
    mockListar.mockResolvedValue({ ok: true as const, data: { items: [], total: 0, page: 1, limit: 25 } });
    mockClientes.mockResolvedValue({ ok: true as const, data: { items: [], total: 0, page: 1 } });
    mockProductos.mockResolvedValue({ ok: true as const, data: { items: [PRODUCTO_18], total: 1, page: 1 } });
  });

  afterEach(cleanup);

  it("disables 'Save draft' while the cart is empty and enables it after adding", async () => {
    await renderPos(false);
    const guardar = screen.getByRole("button", { name: "Save draft" });
    expect(guardar).toBeDisabled();
    await buscarYAgregar();
    await waitFor(() => expect(guardar).toBeEnabled());
  });

  it("live totals update when a line is added and when its quantity is edited", async () => {
    await renderPos(false);
    await buscarYAgregar();

    // subtotal 10.00, ITBIS 1.80 (18% on the net base), total 11.80; the
    // gravado/exento breakdown rides the preview (returned-only, never stored).
    // "RD$ 10.00" appears as BOTH Subtotal and Gravado in the one-line 18% cart.
    expect((await screen.findAllByText("RD$ 10.00")).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("RD$ 1.80")).toBeInTheDocument();
    expect(screen.getByText("RD$ 11.80")).toBeInTheDocument();
    // Descuento and Exento are both zero for a single taxable line.
    expect(screen.getAllByText("RD$ 0.00").length).toBeGreaterThanOrEqual(2);

    // bump quantity: 10.00 × 2 → base 20.00, ITBIS 3.60, total 23.60
    fireEvent.change(screen.getByLabelText("Quantity for Arroz"), { target: { value: "2" } });
    await waitFor(() => expect(screen.getByText("RD$ 23.60")).toBeInTheDocument());
    expect(screen.getByText("RD$ 3.60")).toBeInTheDocument();
  });

  it("removes a line and falls back to zero totals", async () => {
    await renderPos(false);
    await buscarYAgregar();
    fireEvent.click(screen.getByRole("button", { name: "Remove Arroz" }));
    expect(screen.getByText("No products yet. Search and add a product.")).toBeInTheDocument();
    expect(screen.getAllByText("RD$ 0.00").length).toBeGreaterThan(2);
  });

  it("defaults the client picker to 'Consumidor Final' and sends clienteId null", async () => {
    mockCrear.mockResolvedValue(exitoCrear(11));
    await renderPos(false);

    // CF is the default option AND the empty select value (no magic id).
    expect(screen.getByLabelText("Client selection")).toHaveValue("");
    expect(screen.getByText(/Consumidor Final/)).toBeInTheDocument();

    await buscarYAgregar();
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(mockCrear).toHaveBeenCalledTimes(1));

    const payload = mockCrear.mock.calls[0][0] as {
      clienteId: number | null;
      lineas: { productoId: number }[];
    };
    // The resolver seam owns the CF: the UI submits `null`, never a client id.
    expect(payload.clienteId).toBeNull();
    expect(payload.lineas).toEqual([{ productoId: 7, cantidad: "1", precioUnitario: "10.00" }]);
  });

  it("hides the discount panel for non-admins and shows it for the Administrador role", async () => {
    const { unmount } = await renderPos(false);
    expect(screen.queryByLabelText("Discount type")).toBeNull();
    unmount();

    await renderPos(true);
    expect(screen.getByLabelText("Discount type")).toBeInTheDocument();
  });

  it("renders the stock-warning banner from the save payload warnings", async () => {
    mockCrear.mockResolvedValue(
      exitoCrear(12, [
        { code: "STOCK_INSUFICIENTE", productoId: 7, available: "1.000", requested: "2.000" },
      ]),
    );
    await renderPos(false);
    await buscarYAgregar();
    fireEvent.change(screen.getByLabelText("Quantity for Arroz"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));

    const banner = await screen.findByRole("alert");
    expect(banner.textContent).toContain("Insufficient stock");
    expect(banner.textContent).toContain("Arroz");
    expect(banner.textContent).toContain("requested 2.000");
    expect(banner.textContent).toContain("available 1.000");
    // R-V9: the save SUCCEEDS — the warning never blocks the draft.
    expect(screen.getByText(/Draft #12 saved/)).toBeInTheDocument();
  });

  it("disables in-place edit for a discounted draft (ADR-018: the percentage is not recoverable)", async () => {
    mockListar.mockResolvedValue({
      ok: true as const,
      data: {
        items: [
          {
            id: 9,
            fecha: new Date().toISOString(),
            estado: ESTADO_VENTA.BORRADOR,
            total: "96.00",
            descuento: "4.00",
            clienteNombre: CONSUMIDOR_FINAL_LABEL,
            usuarioNombre: "Ana",
          },
        ],
        total: 1,
        page: 1,
        limit: 25,
      },
    });
    render(<PosScreen esAdmin />);
    const edit = await screen.findByRole("button", { name: "Edit draft 9" });
    // Discounted drafts are view/cancel only; cancel stays available.
    expect(edit).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel draft 9" })).toBeEnabled();
  });

  it("never renders a confirm control and wires 'my drafts' cancel", async () => {    mockListar.mockResolvedValue({
      ok: true,
      data: {
        items: [
          {
            id: 3,
            fecha: new Date().toISOString(),
            estado: ESTADO_VENTA.BORRADOR,
            total: "20.00",
            descuento: "0.00",
            clienteNombre: "Consumidor Final",
            usuarioNombre: "Ana",
          },
        ],
        total: 1,
        page: 1,
        limit: 25,
      },
    });
    mockCancelar.mockResolvedValue({ ok: true, data: { id: 3, estado: ESTADO_VENTA.CANCELADA } });
    await renderPos(false);

    // R-V14: no confirmation/payment affordance may exist in 5b.
    expect(screen.queryByRole("button", { name: /confirm/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /cobrar|payment/i })).toBeNull();

    const cancel = await screen.findByRole("button", { name: "Cancel draft 3" });
    fireEvent.click(cancel);
    await waitFor(() => expect(mockCancelar).toHaveBeenCalledWith({ id: 3 }));
    // Flush the post-cancel list refresh so its state update stays inside act().
    await settle();
  });
});
