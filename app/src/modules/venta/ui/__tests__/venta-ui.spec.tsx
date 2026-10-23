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
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { PosScreen } from "../PosScreen";
import { ESTADO_VENTA } from "../../domain/venta";
import { CONSUMIDOR_FINAL_LABEL } from "../carro";
import {
  cancelarVentaAction,
  confirmarVentaAction,
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
  confirmarVentaAction: jest.fn(),
  listarVentasAction: jest.fn(),
  obtenerVentaAction: jest.fn(),
}));
jest.mock("@/modules/producto/http/actions", () => ({
  listarProductosAction: jest.fn(),
}));
// DraftList now mounts the fase-5d return control, which imports the real
// devolucion server-action module (and its Supabase env reader) at module
// scope — mock it like the venta actions so the screen stays DB-free.
jest.mock("@/modules/devolucion/http/actions", () => ({
  devolverVentaAction: jest.fn(),
}));
jest.mock("@/modules/cliente/http/actions", () => ({
  listarClientesAction: jest.fn(),
  crearClienteAction: jest.fn(),
}));

const mockCrear = jest.mocked(crearVentaAction);
const mockConfirmarVenta = jest.mocked(confirmarVentaAction);
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
    // The cart line's ITBIS cell and the Totales footer both render "RD$ 1.80".
    expect((await screen.findAllByText("RD$ 1.80")).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("RD$ 11.80")).toBeInTheDocument();
    // Descuento and Exento are both zero for a single taxable line.
    expect(screen.getAllByText("RD$ 0.00").length).toBeGreaterThanOrEqual(2);

    // bump quantity: 10.00 × 2 → base 20.00, ITBIS 3.60, total 23.60
    fireEvent.change(screen.getByLabelText("Quantity for Arroz"), { target: { value: "2" } });
    await waitFor(() => expect(screen.getByText("RD$ 23.60")).toBeInTheDocument());
    // Cart-line ITBIS cell AND Totales footer both render "RD$ 3.60".
    expect((await screen.findAllByText("RD$ 3.60")).length).toBeGreaterThanOrEqual(2);
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
    // Anchor on the select itself: the indicator badge copy ("Cash (Consumidor
    // Final)") legitimately shares the CF text now that the strip exists.
    expect(
      within(screen.getByLabelText("Client selection")).getByText(/Consumidor Final/),
    ).toBeInTheDocument();

    await buscarYAgregar();
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(mockCrear).toHaveBeenCalledTimes(1));

    const payload = mockCrear.mock.calls[0][0] as {
      clienteId: number | null;
      lineas: { productoId: number }[];
    };
    // The resolver seam owns the CF: the UI submits `null`, never a client id.
    expect(payload.clienteId).toBeNull();
    expect(payload.lineas).toEqual([
      {
        productoId: 7,
        cantidad: "1",
        precioUnitario: "10.00",
        descuento: { descuentoTipo: "PORCENTAJE", descuentoValor: "0.00" },
      },
    ]);
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
            ncf: null,
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

  it("renders the confirm control for drafts but NO payment control, and wires 'my drafts' cancel", async () => {
    mockListar.mockResolvedValue({
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
            ncf: null,
          },
        ],
        total: 1,
        page: 1,
        limit: 25,
      },
    });
    mockCancelar.mockResolvedValue({ ok: true, data: { id: 3, estado: ESTADO_VENTA.CANCELADA } });
    await renderPos(false);

    // R-V14 (5c slice): the confirm affordance now EXISTS for BORRADOR rows,
    // while the payment boundary (Fase 6) still must hold.
    expect(await screen.findByRole("button", { name: "Confirm draft 3" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /cobrar|payment/i })).toBeNull();

    const cancel = await screen.findByRole("button", { name: "Cancel draft 3" });
    fireEvent.click(cancel);
    await waitFor(() => expect(mockCancelar).toHaveBeenCalledWith({ id: 3 }));
    // Flush the post-cancel list refresh so its state update stays inside act().
    await settle();
  });
});

// F2 slice B task 2.10 (D6, R-V19 scenarios 1–3): the credit mode is DERIVED,
// never toggled. Profile fixtures use tipoCliente "CREDITO" clients so the flag
// and the derivation readings agree (design Verification note 4).
describe("PosScreen credit-mode derivation (R-V19)", () => {
  const CLIENTE_CREDITO: import("@/modules/cliente/http/shared").ClienteDto = {
    id: 5,
    nombre: "Comercios Clara, SRL",
    telefono: "809-555-0101",
    direccion: "Av. 27",
    identificacionFiscal: "131045677",
    tipoCliente: "CREDITO",
    esConsumidorFinal: false,
    creditoHabilitado: true,
    limiteCredito: "20000.00",
    plazoCreditoDias: 15,
    activo: true,
    version: 1,
  };

  beforeEach(() => {
    mockListar.mockResolvedValue({ ok: true as const, data: { items: [], total: 0, page: 1, limit: 25 } });
    mockProductos.mockResolvedValue({ ok: true as const, data: { items: [PRODUCTO_18], total: 1, page: 1 } });
  });

  afterEach(cleanup);

  it("shows the three profile facts on selecting a derived-credit client", async () => {
    mockClientes.mockResolvedValue({
      ok: true as const,
      data: { items: [CLIENTE_CREDITO], total: 1, page: 1 },
    });
    await renderPos(false);
    fireEvent.change(screen.getByLabelText("Client selection"), { target: { value: "5" } });

    expect(screen.getByText("CREDITO")).toBeInTheDocument();
    expect(screen.getByText("Limite: RD$ 20,000.00")).toBeInTheDocument();
    expect(screen.getByText("Plazo: 15 días")).toBeInTheDocument();
  });

  it("derives the indicator: CF default, crédito for a CREDITO client, cash for MINORISTA", async () => {
    mockClientes.mockResolvedValue({
      ok: true as const,
      data: {
        items: [
          CLIENTE_CREDITO,
          { ...CLIENTE_CREDITO, id: 6, nombre: "Bar Doña Tatica", tipoCliente: "MINORISTA", creditoHabilitado: false, limiteCredito: "0.00", plazoCreditoDias: 30 },
        ],
        total: 2,
        page: 1,
      },
    });
    await renderPos(false);
    expect(screen.getByText("Cash (Consumidor Final)")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Client selection"), { target: { value: "5" } });
    expect(screen.getByText("Crédito · 15 días")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Client selection"), { target: { value: "6" } });
    expect(screen.getByText("Cash")).toBeInTheDocument();
  });

  it("renders NO contado/crédito toggle control anywhere", async () => {
    mockClientes.mockResolvedValue({
      ok: true as const,
      data: { items: [CLIENTE_CREDITO], total: 1, page: 1 },
    });
    await renderPos(false);
    expect(screen.queryByRole("switch")).toBeNull();
    expect(screen.queryByRole("button", { name: /forma|credit mode|toggle/i })).toBeNull();
  });

  it("shows the derived due date from the post-confirm CREDITO verdict (2026-03-01 + 15 → 2026-03-16)", async () => {
    mockListar.mockResolvedValue({
      ok: true as const,
      data: {
        items: [
          {
            id: 3,
            fecha: new Date().toISOString(),
            estado: ESTADO_VENTA.BORRADOR,
            total: "118.00",
            descuento: "0.00",
            clienteNombre: "Comercios Clara, SRL",
            usuarioNombre: "Ana",
            ncf: null,
          },
        ],
        total: 1,
        page: 1,
        limit: 25,
      },
    });
    await renderPos(false);
    mockConfirmarVenta.mockResolvedValue({
      ok: true as const,
      data: {
        id: 3,
        estado: ESTADO_VENTA.CONFIRMADA,
        facturaId: 77,
        ncf: "B0200000101",
        tipoNcf: "B02",
        correlativoInterno: "FAC-000001",
        total: "118.00",
        credito: { forma: "CREDITO", plazoCreditoDias: 15, fechaEmision: "2026-03-01T15:00:00.000Z" },
        ncfWarning: null,
      },
    });
    fireEvent.click(await screen.findByRole("button", { name: "Confirm draft 3" }));

    const strip = await screen.findByText(/Due date:/);
    expect(strip.textContent).toContain("2026-03-16");
  });
});

// F2 slice C task 3.5 (D2/R-V21): admin-gated per-line discount inputs, the
// zero-shape default rides the guardar payload, and over-cap rejects surface
// ONLY through the server's stable codes via the existing banner.
describe("PosScreen per-line discount (R-V21)", () => {
  beforeEach(() => {
    mockListar.mockResolvedValue({ ok: true as const, data: { items: [], total: 0, page: 1, limit: 25 } });
    mockClientes.mockResolvedValue({ ok: true as const, data: { items: [], total: 0, page: 1 } });
    mockProductos.mockResolvedValue({ ok: true as const, data: { items: [PRODUCTO_18], total: 1, page: 1 } });
    mockCrear.mockResolvedValue(exitoCrear(11));
  });

  afterEach(cleanup);

  it("renders NO per-line discount input for a non-admin session", async () => {
    await renderPos(false);
    await buscarYAgregar();
    expect(screen.queryByLabelText("Discount type for Arroz")).toBeNull();
    expect(screen.queryByLabelText("Discount value for Arroz")).toBeNull();
  });

  it("renders the per-line discount select+input for an admin session", async () => {
    await renderPos(true);
    await buscarYAgregar();
    const tipo = screen.getByLabelText("Discount type for Arroz");
    const valor = screen.getByLabelText("Discount value for Arroz");
    expect(tipo).toHaveValue("PORCENTAJE"); // zero-shape default
    expect(valor).toHaveValue("0.00");
    // Editing routes into the pure model.
    fireEvent.change(tipo, { target: { value: "MONTO" } });
    fireEvent.change(valor, { target: { value: "1.50" } });
    await waitFor(() =>
      expect(valor).toHaveValue("1.50"),
    );
  });

  it("sends the per-line descuento in the guardar payload (zero shape for a fresh line)", async () => {
    await renderPos(true);
    await buscarYAgregar();
    fireEvent.change(screen.getByLabelText("Discount value for Arroz"), { target: { value: "2.00" } });
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(mockCrear).toHaveBeenCalledTimes(1));
    const payload = mockCrear.mock.calls[0][0] as {
      lineas: { productoId: number; descuento: { descuentoTipo: string; descuentoValor: string } }[];
    };
    expect(payload.lineas).toEqual([
      { productoId: 7, cantidad: "1", precioUnitario: "10.00", descuento: { descuentoTipo: "PORCENTAJE", descuentoValor: "2.00" } },
    ]);
    // A fresh untouched line keeps the zero shape (zero-discount scenario).
    await buscarYAgregar();
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(mockCrear).toHaveBeenCalledTimes(2));
    const payload2 = mockCrear.mock.calls[1][0] as typeof payload;
    expect(payload2.lineas[0].descuento).toEqual({ descuentoTipo: "PORCENTAJE", descuentoValor: "0.00" });
  });

  it("surfaces an over-cap reject through the server's stable code via the banner", async () => {
    mockCrear.mockResolvedValue({
      ok: false as const,
      error: { code: "DESCUENTO_EXCEDE_MAXIMO", message: "El descuento excede el máximo autorizado" },
    });
    await renderPos(true);
    await buscarYAgregar();
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    const status = await screen.findByRole("status");
    expect(status.textContent).toContain("[DESCUENTO_EXCEDE_MAXIMO]");
    expect(status.textContent).toContain("excede el máximo autorizado");
  });
});
