/**
 * @jest-environment jsdom
 *
 * Purchase create/edit dialog tests (odd/tasks/compras.md, T3: S1, S2, S5, S6).
 * The `"use server"` action modules are mocked at the HTTP boundary, so the
 * dialog is tested against the actions' result contract, never a database.
 *
 * S1: supplier, fecha, tipo (+ its NCF kind as text), read-only sucursal, lines
 * and the fiscal breakdown. S2: "Recibir mercancía al confirmar compra" runs
 * confirm → receive and surfaces a typed receive failure without rolling back.
 * S5: draft edit and confirm show the retentions the server returned. S6:
 * decimal strings leave the dialog exactly as typed; display math is exact.
 */

import "@testing-library/jest-dom";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CompraFormulario } from "../CompraFormulario";
import type { CompraDetalleEditable } from "../compra-form-utils";
import {
  actualizarCompraAction,
  confirmarCompraAction,
  crearCompraAction,
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

const mockCrear = jest.mocked(crearCompraAction);
const mockActualizar = jest.mocked(actualizarCompraAction);
const mockConfirmar = jest.mocked(confirmarCompraAction);
const mockRecibir = jest.mocked(recibirCompraAction);
const mockProveedores = jest.mocked(listarProveedoresAction);
const mockProductos = jest.mocked(consultarProductosAction);

const PROVEEDOR_FORMAL = {
  id: 3,
  nombre: "Distribuidora Norte",
  contacto: "Ana",
  telefono: "8090000000",
  rnc: "138000001",
  tipoProveedor: "FORMAL",
  tipoPersona: "JURIDICA",
  activo: true,
};

const PROVEEDOR_INFORMAL = {
  id: 4,
  nombre: "Suplidor Sur",
  contacto: "Luis",
  telefono: "8091111111",
  rnc: null,
  tipoProveedor: "INFORMAL",
  tipoPersona: "FISICA",
  activo: true,
};

const PRODUCTO = {
  id: 11,
  codigo: "A001",
  nombre: "Arroz Selecto",
  descripcion: null,
  categoriaId: 1,
  categoria: "Granos",
  unidadMedida: "Libra",
  precioVenta: "10.00",
  tasaItbis: "18" as const,
  itbisVigenteDesde: "2026-01-01T00:00:00.000Z",
  itbisVigenteHasta: null,
  itbisAplicaRetencionITBIS: true,
  activo: true,
  version: 1,
};

const COMPRA_BORRADOR: CompraDetalleEditable = {
  id: 7,
  correlativoInterno: "CMP-000007",
  estado: "BORRADOR",
  tipoCompra: "MERCANCIA",
  fecha: "2026-11-10T14:00:00.000Z",
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
};

function montar({
  compra = null,
  onGuardado = jest.fn(),
  onActualizado = jest.fn(),
  onCancelar = jest.fn(),
}: {
  compra?: CompraDetalleEditable | null;
  onGuardado?: jest.Mock;
  onActualizado?: jest.Mock;
  onCancelar?: jest.Mock;
} = {}) {
  return render(
    <CompraFormulario
      compra={compra}
      sucursalNombre="Sucursal Central"
      onGuardado={onGuardado}
      onActualizado={onActualizado}
      onCancelar={onCancelar}
    />,
  );
}

/** Picks a supplier from the select once the read action has answered. */
async function elegirProveedor(nombre: string, id: string) {
  await screen.findByRole("option", { name: new RegExp(nombre) });
  fireEvent.change(screen.getByLabelText("Proveedor"), { target: { value: id } });
}

/** Types in the line's product search, runs the debounce, clicks the result. */
async function elegirProducto(etiqueta: string, texto: string, opcion: string) {
  jest.useFakeTimers();
  fireEvent.change(screen.getByLabelText(etiqueta), { target: { value: texto } });
  await act(async () => {
    jest.advanceTimersByTime(300);
  });
  jest.useRealTimers();
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: opcion }));
  });
}

async function crearBorradorValido() {
  await elegirProveedor("Distribuidora Norte", "3");
  fireEvent.change(screen.getByLabelText("Fecha"), { target: { value: "2026-11-10" } });
  await elegirProducto("Producto línea 1", "arroz", "A001 — Arroz Selecto");
  fireEvent.change(screen.getByLabelText("Cantidad línea 1"), { target: { value: "2" } });
  fireEvent.change(screen.getByLabelText("Costo unitario línea 1"), {
    target: { value: "100" },
  });
}

beforeEach(() => {
  mockProveedores.mockResolvedValue({
    ok: true,
    data: { items: [PROVEEDOR_FORMAL, PROVEEDOR_INFORMAL], total: 2, page: 1 },
  });
  mockProductos.mockResolvedValue({
    ok: true,
    data: { items: [PRODUCTO], total: 1, page: 1, limit: 25, categorias: [] },
  });
  mockCrear.mockResolvedValue({
    ok: true,
    data: { id: 9, estado: "BORRADOR", correlativoInterno: "CMP-000009", total: "236.00" },
  });
  mockActualizar.mockResolvedValue({ ok: true, data: { id: 7, total: "354.00" } });
});

afterEach(cleanup);

describe("CompraFormulario — new purchase (S1)", () => {
  it("shows supplier, fecha, tipo/NCF, read-only sucursal and lines", async () => {
    montar();

    await screen.findByRole("option", { name: /Distribuidora Norte/ });
    expect(screen.getByTestId("compra-sucursal")).toHaveTextContent("Sucursal Central");
    // The wireframe's "Formal → B01" concept: mercancía is a B01 receipt.
    expect(screen.getByTestId("compra-comprobante")).toHaveTextContent("B01");
    expect(screen.getByLabelText("Fecha")).toBeInTheDocument();
    expect(screen.getByLabelText("Producto línea 1")).toBeInTheDocument();
  });

  it("S1/S6: saves the draft with the decimal strings as typed and shows the breakdown", async () => {
    const onGuardado = jest.fn();
    montar({ onGuardado });

    await crearBorradorValido();

    expect(screen.getByTestId("compra-linea-1-unidad")).toHaveTextContent("Libra");
    expect(screen.getByTestId("compra-linea-1-itbis")).toHaveTextContent("18%");
    expect(screen.getByTestId("compra-linea-1-subtotal")).toHaveTextContent("RD$ 200.00");
    expect(screen.getByTestId("compra-subtotal")).toHaveTextContent("RD$ 200.00");
    expect(screen.getByTestId("compra-itbis")).toHaveTextContent("RD$ 36.00");
    expect(screen.getByTestId("compra-total")).toHaveTextContent("RD$ 236.00");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Guardar Borrador" }));
    });

    expect(mockCrear).toHaveBeenCalledWith({
      proveedorId: 3,
      tipoCompra: "MERCANCIA",
      fecha: "2026-11-10",
      lineas: [{ productoId: 11, cantidad: "2", costoUnitario: "100" }],
    });
    expect(onGuardado).toHaveBeenCalled();
  });

  it("labels a service purchase as a B11 receipt and shows Ret. ITBIS only for an informal supplier", async () => {
    montar();
    await screen.findByRole("option", { name: /Distribuidora Norte/ });

    fireEvent.change(screen.getByLabelText("Tipo de compra"), {
      target: { value: "SERVICIO_TECNICO" },
    });
    expect(screen.getByTestId("compra-comprobante")).toHaveTextContent("B11");

    // Formal supplier: no ITBIS retention line.
    expect(screen.queryByTestId("compra-ret-itbis")).toBeNull();

    fireEvent.change(screen.getByLabelText("Proveedor"), { target: { value: "4" } });
    expect(screen.getByTestId("compra-ret-itbis")).toBeInTheDocument();
    expect(screen.getByTestId("compra-ret-isr")).toBeInTheDocument();
  });

  it("adds and removes draft lines", async () => {
    montar();
    await screen.findByRole("option", { name: /Distribuidora Norte/ });

    fireEvent.click(screen.getByRole("button", { name: "+ Agregar producto" }));
    expect(screen.getByLabelText("Producto línea 2")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Quitar línea 2" }));
    expect(screen.queryByLabelText("Producto línea 2")).toBeNull();
  });
});

describe("CompraFormulario — local validation (S1, S6)", () => {
  it("blocks the submit without a supplier and without a line, never calling the server", async () => {
    montar();
    await screen.findByRole("option", { name: /Distribuidora Norte/ });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Guardar Borrador" }));
    });
    expect(screen.getByRole("alert")).toHaveTextContent("Debe seleccionar un proveedor.");

    await elegirProveedor("Distribuidora Norte", "3");
    await elegirProducto("Producto línea 1", "arroz", "A001 — Arroz Selecto");
    fireEvent.change(screen.getByLabelText("Cantidad línea 1"), { target: { value: "0" } });
    fireEvent.change(screen.getByLabelText("Costo unitario línea 1"), {
      target: { value: "100" },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Guardar Borrador" }));
    });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "La cantidad debe ser un número mayor que cero",
    );

    fireEvent.change(screen.getByLabelText("Cantidad línea 1"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("Costo unitario línea 1"), {
      target: { value: "abc" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Guardar Borrador" }));
    });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "El costo unitario debe ser un número",
    );
    expect(mockCrear).not.toHaveBeenCalled();
  });
});

describe("CompraFormulario — confirm and receive (S2, S5)", () => {
  it("S2: confirms then receives when the checkbox is checked, and shows the retentions", async () => {
    const onGuardado = jest.fn();
    mockConfirmar.mockResolvedValue({
      ok: true,
      data: {
        id: 9,
        estado: "PENDIENTE",
        correlativoInterno: "CMP-000009",
        total: "236.00",
        retencionIsr: "20.00",
        retencionItbis: "36.00",
      },
    });
    mockRecibir.mockResolvedValue({
      ok: true,
      data: { id: 9, estado: "RECIBIDA", movimientosAplicados: 1 },
    });
    montar({ onGuardado });

    await crearBorradorValido();
    fireEvent.click(screen.getByLabelText("Recibir mercancía al confirmar compra"));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Confirmar Compra" }));
    });

    expect(mockCrear).toHaveBeenCalledTimes(1);
    expect(mockConfirmar).toHaveBeenCalledWith({ id: 9 });
    expect(mockRecibir).toHaveBeenCalledWith({ id: 9 });
    // The chain is strictly sequential: confirm settles before receive is called.
    expect(mockConfirmar.mock.invocationCallOrder[0]).toBeLessThan(
      mockRecibir.mock.invocationCallOrder[0],
    );

    const confirmada = screen.getByTestId("compra-confirmada");
    expect(confirmada).toHaveTextContent("RD$ 20.00");
    expect(confirmada).toHaveTextContent("RD$ 36.00");
    expect(onGuardado).toHaveBeenCalled();
  });

  it("S2: a typed receive failure is shown and the confirmed purchase stays visible", async () => {
    const onGuardado = jest.fn();
    const onActualizado = jest.fn();
    mockConfirmar.mockResolvedValue({
      ok: true,
      data: {
        id: 9,
        estado: "PENDIENTE",
        correlativoInterno: "CMP-000009",
        total: "236.00",
        retencionIsr: "20.00",
        retencionItbis: "0.00",
      },
    });
    mockRecibir.mockResolvedValue({
      ok: false,
      error: { code: "LINEA_INVALIDA", message: "No se pudo aplicar el movimiento de inventario" },
    });
    montar({ onGuardado, onActualizado });

    await crearBorradorValido();
    fireEvent.click(screen.getByLabelText("Recibir mercancía al confirmar compra"));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Confirmar Compra" }));
    });

    expect(screen.getByRole("alert")).toHaveTextContent(
      "No se pudo aplicar el movimiento de inventario",
    );
    // The confirm already happened: no rollback, no silent retry, dialog open.
    expect(mockConfirmar).toHaveBeenCalledTimes(1);
    expect(mockRecibir).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Confirmar Compra" })).toBeInTheDocument();
    expect(screen.getByTestId("compra-confirmada")).toBeInTheDocument();
    expect(onActualizado).toHaveBeenCalled();
    expect(onGuardado).not.toHaveBeenCalled();
  });

  it("S5: confirming without the checkbox does not receive", async () => {
    mockConfirmar.mockResolvedValue({
      ok: true,
      data: {
        id: 9,
        estado: "PENDIENTE",
        correlativoInterno: "CMP-000009",
        total: "236.00",
        retencionIsr: "0.00",
        retencionItbis: "0.00",
      },
    });
    montar();

    await crearBorradorValido();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Confirmar Compra" }));
    });

    expect(mockConfirmar).toHaveBeenCalledWith({ id: 9 });
    expect(mockRecibir).not.toHaveBeenCalled();
  });
});

describe("CompraFormulario — draft edit (S5)", () => {
  it("prefills the draft and saves it through actualizarCompraAction", async () => {
    const onGuardado = jest.fn();
    montar({ compra: COMPRA_BORRADOR, onGuardado });
    await screen.findByRole("option", { name: /Distribuidora Norte/ });

    expect(screen.getByLabelText("Fecha")).toHaveValue("2026-11-10");
    expect(screen.getByTestId("compra-linea-1-producto")).toHaveTextContent("Arroz Selecto");

    fireEvent.change(screen.getByLabelText("Cantidad línea 1"), { target: { value: "3" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Guardar Borrador" }));
    });

    expect(mockCrear).not.toHaveBeenCalled();
    expect(mockActualizar).toHaveBeenCalledWith({
      id: 7,
      lineas: [{ productoId: 11, cantidad: "3", costoUnitario: "100.00" }],
    });
    expect(onGuardado).toHaveBeenCalled();
  });

  it("edits and then confirms the same draft", async () => {
    mockConfirmar.mockResolvedValue({
      ok: true,
      data: {
        id: 7,
        estado: "PENDIENTE",
        correlativoInterno: "CMP-000007",
        total: "354.00",
        retencionIsr: "0.00",
        retencionItbis: "0.00",
      },
    });
    montar({ compra: COMPRA_BORRADOR });
    await screen.findByRole("option", { name: /Distribuidora Norte/ });

    fireEvent.change(screen.getByLabelText("Cantidad línea 1"), { target: { value: "3" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Confirmar Compra" }));
    });

    expect(mockActualizar).toHaveBeenCalledTimes(1);
    expect(mockConfirmar).toHaveBeenCalledWith({ id: 7 });
  });
});
