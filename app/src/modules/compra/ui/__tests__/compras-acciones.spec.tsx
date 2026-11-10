/**
 * @jest-environment jsdom
 *
 * Compras row controls (odd/tasks/compras.md, T3: S2, S5).
 *
 * The action modules are mocked at the HTTP boundary. S5 pins which row actions
 * each frozen state offers (Editar/Confirmar = BORRADOR, Recibir = PENDIENTE,
 * Cancelar = BORRADOR|PENDIENTE, RECIBIDA has NO cancel path), that Confirmar
 * shows the retentions the server returned, and that Cancelar requires a
 * motivo. S2: a typed receive refusal is surfaced, never swallowed.
 */

import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { ComprasScreen, type ComprasInicial } from "../ComprasScreen";
import type { CompraFila, FiltrosCompras } from "../compras-filtros";
import {
  cancelarCompraAction,
  confirmarCompraAction,
  listarComprasAction,
  obtenerCompraAction,
  recibirCompraAction,
} from "@/modules/compra/http/actions";
import { listarProveedoresAction } from "@/modules/proveedor/http/actions";
import { consultarProductosAction } from "@/modules/producto/http/actions";

jest.mock("@/modules/compra/http/actions", () => ({
  crearCompraAction: jest.fn(),
  actualizarCompraAction: jest.fn(),
  confirmarCompraAction: jest.fn(),
  cancelarCompraAction: jest.fn(),
  recibirCompraAction: jest.fn(),
  listarComprasAction: jest.fn(),
  obtenerCompraAction: jest.fn(),
  obtenerPermisosCompraAction: jest.fn(),
}));

jest.mock("@/modules/proveedor/http/actions", () => ({
  listarProveedoresAction: jest.fn(),
}));

jest.mock("@/modules/producto/http/actions", () => ({
  consultarProductosAction: jest.fn(),
}));

const mockListar = jest.mocked(listarComprasAction);
const mockObtener = jest.mocked(obtenerCompraAction);
const mockConfirmar = jest.mocked(confirmarCompraAction);
const mockCancelar = jest.mocked(cancelarCompraAction);
const mockRecibir = jest.mocked(recibirCompraAction);
const mockProveedores = jest.mocked(listarProveedoresAction);
const mockProductos = jest.mocked(consultarProductosAction);

const FILTROS: FiltrosCompras = { proveedorBusqueda: "", estado: "", tipoCompra: "" };

const BORRADOR: CompraFila = {
  id: 7,
  correlativoInterno: "CMP-000007",
  tipoCompra: "MERCANCIA",
  estado: "BORRADOR",
  ncf: null,
  total: "236.00",
  fecha: "2026-11-10T14:00:00.000Z",
  proveedorNombre: "Distribuidora Norte",
};

const PENDIENTE: CompraFila = {
  id: 8,
  correlativoInterno: "CMP-000008",
  tipoCompra: "SERVICIO_TECNICO",
  estado: "PENDIENTE",
  ncf: null,
  total: "118.00",
  fecha: "2026-11-09T14:00:00.000Z",
  proveedorNombre: "Suplidor Sur",
};

const RECIBIDA: CompraFila = {
  id: 9,
  correlativoInterno: "CMP-000009",
  tipoCompra: "MERCANCIA",
  estado: "RECIBIDA",
  ncf: "B0100000003",
  total: "50.00",
  fecha: "2026-11-08T14:00:00.000Z",
  proveedorNombre: "Distribuidora Norte",
};

function salida(items: readonly CompraFila[] = [BORRADOR, PENDIENTE, RECIBIDA]) {
  return { items: [...items], total: items.length, page: 1 };
}

function montar({ puedeGestionar = true }: { puedeGestionar?: boolean } = {}) {
  const inicial: ComprasInicial = { ok: true, data: salida() };
  return render(
    <ComprasScreen
      inicial={inicial}
      filtrosIniciales={FILTROS}
      puedeGestionar={puedeGestionar}
      sucursalNombre="Sucursal Central"
    />,
  );
}

beforeEach(() => {
  mockListar.mockResolvedValue({ ok: true, data: salida() });
  mockProveedores.mockResolvedValue({
    ok: true,
    data: {
      items: [
        {
          id: 3,
          nombre: "Distribuidora Norte",
          contacto: "Ana",
          telefono: "8090000000",
          rnc: "138000001",
          tipoProveedor: "FORMAL",
          tipoPersona: "JURIDICA",
          activo: true,
        },
      ],
      total: 1,
      page: 1,
    },
  });
  mockProductos.mockResolvedValue({
    ok: true,
    data: { items: [], total: 0, page: 1, limit: 10, categorias: [] },
  });
});

afterEach(cleanup);

describe("ComprasScreen — row actions per state (S5)", () => {
  it("offers Editar / Confirmar / Cancelar on a BORRADOR row only", () => {
    montar();

    expect(screen.getByRole("button", { name: "Editar CMP-000007" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirmar CMP-000007" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancelar CMP-000007" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Recibir CMP-000007" })).toBeNull();
  });

  it("offers Recibir / Cancelar on a PENDIENTE row only", () => {
    montar();

    expect(screen.getByRole("button", { name: "Recibir CMP-000008" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancelar CMP-000008" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Confirmar CMP-000008" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Editar CMP-000008" })).toBeNull();
  });

  it("RECIBIDA has no cancel path: no Cancelar, Editar, Confirmar or Recibir", () => {
    montar();

    const fila = within(screen.getByTestId("compra-fila-9"));
    expect(fila.queryByRole("button", { name: "Cancelar CMP-000009" })).toBeNull();
    expect(fila.queryByRole("button", { name: "Editar CMP-000009" })).toBeNull();
    expect(fila.queryByRole("button", { name: "Confirmar CMP-000009" })).toBeNull();
    expect(fila.queryByRole("button", { name: "Recibir CMP-000009" })).toBeNull();
  });

  it("gives a view-only caller no manage row controls", () => {
    montar({ puedeGestionar: false });

    expect(screen.queryByRole("button", { name: "Editar CMP-000007" })).toBeNull();
    expect(screen.queryByRole("button", { name: "+ Nueva compra" })).toBeNull();
  });
});

describe("ComprasScreen — confirm and receive from a row (S2, S5)", () => {
  it("confirms a BORRADOR row and shows the returned retentions", async () => {
    mockConfirmar.mockResolvedValue({
      ok: true,
      data: {
        id: 7,
        estado: "PENDIENTE",
        correlativoInterno: "CMP-000007",
        total: "236.00",
        retencionIsr: "20.92",
        retencionItbis: "36.00",
      },
    });

    montar();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Confirmar CMP-000007" }));
    });

    expect(mockConfirmar).toHaveBeenCalledWith({ id: 7 });
    const aviso = screen.getByRole("status");
    expect(aviso).toHaveTextContent("Retención ISR RD$ 20.92");
    expect(aviso).toHaveTextContent("Retención ITBIS RD$ 36.00");
    expect(mockListar).toHaveBeenCalledWith({ page: 1, limit: 25 });
  });

  it("receives a PENDIENTE row and surfaces a typed refusal", async () => {
    mockRecibir.mockResolvedValueOnce({
      ok: true,
      data: { id: 8, estado: "RECIBIDA", movimientosAplicados: 1 },
    });
    montar();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Recibir CMP-000008" }));
    });
    expect(mockRecibir).toHaveBeenCalledWith({ id: 8 });
    expect(screen.getByRole("status")).toHaveTextContent("Compra CMP-000008 recibida");

    mockRecibir.mockResolvedValueOnce({
      ok: false,
      error: { code: "LINEA_INVALIDA", message: "No se pudo aplicar el movimiento" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Recibir CMP-000008" }));
    });
    expect(screen.getByRole("alert")).toHaveTextContent("No se pudo aplicar el movimiento");
  });
});

describe("ComprasScreen — cancel with a mandatory motivo (S5)", () => {
  it("requires the motivo before cancelling and sends it to the action", async () => {
    mockCancelar.mockResolvedValue({ ok: true, data: { id: 7, estado: "CANCELADA" } });
    montar();

    fireEvent.click(screen.getByRole("button", { name: "Cancelar CMP-000007" }));

    const dialogo = screen.getByRole("dialog");
    expect(dialogo).toHaveTextContent("CMP-000007");
    const confirmar = within(dialogo).getByRole("button", { name: "Cancelar compra" });
    expect(confirmar).toBeDisabled();
    expect(mockCancelar).not.toHaveBeenCalled();

    fireEvent.change(within(dialogo).getByLabelText("Motivo de cancelación"), {
      target: { value: "  Proveedor no entregó  " },
    });
    await act(async () => {
      fireEvent.click(confirmar);
    });

    expect(mockCancelar).toHaveBeenCalledWith({ id: 7, motivo: "Proveedor no entregó" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(mockListar).toHaveBeenCalledWith({ page: 1, limit: 25 });
  });

  it("keeps the dialog open with the typed server refusal", async () => {
    mockCancelar.mockResolvedValue({
      ok: false,
      error: { code: "TRANSICION_INVALIDA", message: "La compra ya fue recibida" },
    });
    montar();

    fireEvent.click(screen.getByRole("button", { name: "Cancelar CMP-000008" }));
    const dialogo = screen.getByRole("dialog");
    fireEvent.change(within(dialogo).getByLabelText("Motivo de cancelación"), {
      target: { value: "Duplicada" },
    });
    await act(async () => {
      fireEvent.click(within(dialogo).getByRole("button", { name: "Cancelar compra" }));
    });

    expect(screen.getByRole("dialog")).toHaveTextContent("La compra ya fue recibida");
  });
});

describe("ComprasScreen — create and edit dialogs (S1, S5)", () => {
  it("+ Nueva compra opens the form with the tenant sucursal", async () => {
    montar();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "+ Nueva compra" }));
    });
    // Let the dialog's supplier read settle before asserting (act-wrapped).
    await act(async () => {
      await screen.findByRole("option", { name: /Distribuidora Norte/ });
    });

    const dialogo = screen.getByRole("dialog");
    expect(dialogo).toHaveTextContent("Nueva compra");
    expect(within(dialogo).getByTestId("compra-sucursal")).toHaveTextContent(
      "Sucursal Central",
    );
  });

  it("Editar reads the draft through obtenerCompraAction and prefills the form", async () => {
    mockObtener.mockResolvedValueOnce({
      ok: true,
      data: {
        id: 7,
        correlativoInterno: "CMP-000007",
        tipoCompra: "MERCANCIA",
        estado: "BORRADOR",
        ncf: null,
        tipoNcf: null,
        fecha: "2026-11-10T14:00:00.000Z",
        subtotal: "200.00",
        subtotalGravado: "200.00",
        subtotalExento: "0.00",
        itbis: "36.00",
        retencionIsr: "0.00",
        retencionItbis: "0.00",
        total: "236.00",
        proveedor: { id: 3, nombre: "Distribuidora Norte" },
        lineas: [
          {
            productoId: 11,
            productoNombre: "Arroz Selecto",
            cantidad: "2.000",
            costoUnitario: "100.00",
            tasaItbis: "18",
            itbisLinea: "36.00",
            subtotalLinea: "200.00",
          },
        ],
      },
    });
    montar();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Editar CMP-000007" }));
    });

    expect(mockObtener).toHaveBeenCalledWith({ id: 7 });
    // Let the dialog's own supplier read settle (act-wrapped).
    await act(async () => {
      await screen.findByRole("option", { name: /Distribuidora Norte/ });
    });
    const dialogo = screen.getByRole("dialog");
    expect(dialogo).toHaveTextContent("Editar compra");
    expect(within(dialogo).getByLabelText("Cantidad línea 1")).toHaveValue("2.000");
    expect(within(dialogo).getByTestId("compra-linea-1-producto")).toHaveTextContent(
      "Arroz Selecto",
    );
  });
});
