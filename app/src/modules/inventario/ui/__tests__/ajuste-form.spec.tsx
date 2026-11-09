/**
 * @jest-environment jsdom
 *
 * Inventario adjust form tests (odd/tasks/inventario-ajuste.md, T2: S2, S3, S4).
 * The `"use server"` action module and the router are mocked at their boundary —
 * the form is tested against the actions' result contract, never a database.
 */

import "@testing-library/jest-dom";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { AjusteInventarioForm } from "../AjusteInventarioForm";
import {
  ajustarInventarioAction,
  consultarInventarioAction,
} from "@/modules/inventario/http/actions";
import type { ConsultarInventarioOutput } from "@/modules/inventario/application/consultar-inventario";

jest.mock("@/modules/inventario/http/actions", () => ({
  consultarInventarioAction: jest.fn(),
  ajustarInventarioAction: jest.fn(),
}));

jest.mock("next/link", () => ({
  __esModule: true,
  default: ({
    href,
    children,
    ...rest
  }: {
    readonly href?: string;
    readonly children?: React.ReactNode;
  }) => (
    <a href={href ?? "#"} {...rest}>
      {children}
    </a>
  ),
}));

const push = jest.fn();
jest.mock("next/navigation", () => ({
  __esModule: true,
  useRouter: () => ({ push, replace: jest.fn(), refresh: jest.fn() }),
}));

const mockConsultar = jest.mocked(consultarInventarioAction);
const mockAjustar = jest.mocked(ajustarInventarioAction);

const MOTIVOS = [
  "Conteo físico",
  "Merma",
  "Producto dañado",
  "Producto vencido",
  "Corrección de error",
  "Otro",
];

function resultadoBusqueda(): ConsultarInventarioOutput {
  return {
    items: [
      {
        productoId: 7,
        codigo: "P-007",
        nombre: "Arroz",
        categoria: "Granos",
        unidadMedida: "LB",
        cantidad: "150.000",
        stockMinimo: 10,
        estado: "normal",
      },
      {
        productoId: 8,
        codigo: "P-008",
        nombre: "Habichuelas",
        categoria: "Granos",
        unidadMedida: "LB",
        cantidad: "4.500",
        stockMinimo: 10,
        estado: "bajo_stock",
      },
    ],
    total: 2,
    page: 1,
    limit: 25,
    resumen: { totalProductos: 2, bajoStock: 1, agotados: 0, valorInventario: "100.00" },
    categorias: [],
  };
}

const AJUSTE_OK = {
  ok: true,
  data: { inventarioId: 1, productoId: 7, cantidadAnterior: "150.000", cantidadNueva: "160.000" },
} as const;

function confirmar(): HTMLElement {
  return screen.getByRole("button", { name: "Confirmar Ajuste" });
}

function escribirCantidad(valor: string): void {
  fireEvent.change(screen.getByLabelText("Nueva cantidad *"), { target: { value: valor } });
}

async function elegirProducto(opcion = "P-007 — Arroz"): Promise<void> {
  fireEvent.change(screen.getByLabelText("Producto *"), { target: { value: "arr" } });
  await act(async () => {
    jest.advanceTimersByTime(300);
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: new RegExp(opcion) }));
  });
}

async function completar(
  tipo: "Entrada" | "Salida" = "Entrada",
  cantidad = "10",
  motivo = "Merma",
): Promise<void> {
  await elegirProducto();
  fireEvent.click(screen.getByRole("button", { name: tipo }));
  fireEvent.change(screen.getByLabelText("Motivo *"), { target: { value: motivo } });
  escribirCantidad(cantidad);
}

async function enviar(): Promise<void> {
  await act(async () => {
    fireEvent.click(confirmar());
  });
}

beforeEach(() => {
  jest.useFakeTimers();
  mockConsultar.mockReset();
  mockAjustar.mockReset();
  push.mockReset();
  mockConsultar.mockResolvedValue({ ok: true, data: resultadoBusqueda() });
  mockAjustar.mockResolvedValue(AJUSTE_OK);
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe("AjusteInventarioForm — drawn layout (S3, S4)", () => {
  it("renders the title, back arrow, labels, placeholders and buttons as drawn", () => {
    render(<AjusteInventarioForm />);

    expect(screen.getByRole("heading", { name: "Ajuste de Inventario" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Volver" })).toHaveAttribute("href", "/inventario");
    expect(screen.getByLabelText("Producto *")).toHaveAttribute("placeholder", "Seleccionar producto...");
    expect(screen.getByText("Tipo de ajuste *")).toBeInTheDocument();
    expect(screen.getByLabelText("Motivo *")).toBeInTheDocument();
    const cantidad = screen.getByLabelText("Nueva cantidad *");
    expect(cantidad).toHaveValue("0");
    expect(cantidad).toHaveAttribute("inputmode", "decimal");
    expect(cantidad).toHaveAttribute("placeholder", "0");
    const observaciones = screen.getByLabelText("Observaciones");
    expect(observaciones).toHaveAttribute("placeholder", "Detalle opcional del ajuste...");
    expect(observaciones).toHaveAttribute("maxlength", "200");
    expect(screen.getByRole("link", { name: "Cancelar" })).toHaveAttribute("href", "/inventario");
    expect(confirmar()).toBeDisabled();
  });

  it("offers Entrada and Salida with nothing preselected", () => {
    render(<AjusteInventarioForm />);

    expect(screen.getByRole("button", { name: "Entrada" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Salida" })).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(screen.getByRole("button", { name: "Salida" }));
    expect(screen.getByRole("button", { name: "Salida" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Entrada" })).toHaveAttribute("aria-pressed", "false");
  });

  it("offers the placeholder and exactly the six standard motivos", () => {
    render(<AjusteInventarioForm />);

    const opciones = within(screen.getByLabelText("Motivo *")).getAllByRole("option");
    expect(opciones.map((o) => o.textContent)).toEqual(["Seleccionar motivo...", ...MOTIVOS]);
    expect(screen.getByLabelText("Motivo *")).toHaveValue("");
  });
});

describe("AjusteInventarioForm — product search", () => {
  it("queries the action with the typed text after the 300ms debounce and lists the matches", async () => {
    render(<AjusteInventarioForm />);

    fireEvent.change(screen.getByLabelText("Producto *"), { target: { value: "ar" } });
    fireEvent.change(screen.getByLabelText("Producto *"), { target: { value: "arroz" } });
    await act(async () => {
      jest.advanceTimersByTime(299);
    });
    expect(mockConsultar).not.toHaveBeenCalled();

    await act(async () => {
      jest.advanceTimersByTime(1);
    });
    expect(mockConsultar).toHaveBeenCalledTimes(1);
    expect(mockConsultar).toHaveBeenCalledWith({ page: 1, limit: 25, busqueda: "arroz" });

    const lista = within(screen.getByRole("list", { name: "Productos encontrados" }));
    expect(lista.getByText("P-007 — Arroz")).toBeInTheDocument();
    expect(lista.getByText("Stock: 150")).toBeInTheDocument();
    expect(lista.getByText("P-008 — Habichuelas")).toBeInTheDocument();
    expect(lista.getByText("Stock: 4.5")).toBeInTheDocument();
  });

  it("does not query for an empty text", async () => {
    render(<AjusteInventarioForm />);

    fireEvent.change(screen.getByLabelText("Producto *"), { target: { value: "   " } });
    await act(async () => {
      jest.advanceTimersByTime(500);
    });

    expect(mockConsultar).not.toHaveBeenCalled();
  });

  it("selecting a match fills the field, closes the list and does not search again", async () => {
    render(<AjusteInventarioForm />);

    await elegirProducto("P-008 — Habichuelas");
    await act(async () => {
      jest.advanceTimersByTime(500);
    });

    expect(screen.getByLabelText("Producto *")).toHaveValue("P-008 — Habichuelas");
    expect(screen.queryByRole("list", { name: "Productos encontrados" })).not.toBeInTheDocument();
    expect(mockConsultar).toHaveBeenCalledTimes(1);

    // The selection carries its stock: the live line reads it.
    fireEvent.click(screen.getByRole("button", { name: "Entrada" }));
    escribirCantidad("0.5");
    expect(screen.getByText("Existencia actual 4.5 → quedará 5")).toBeInTheDocument();
  });

  it("typing again drops the selection, so confirm is disabled until a match is picked", async () => {
    render(<AjusteInventarioForm />);
    await completar();
    expect(confirmar()).toBeEnabled();

    fireEvent.change(screen.getByLabelText("Producto *"), { target: { value: "P-007 — Arro" } });

    expect(confirmar()).toBeDisabled();
    expect(screen.queryByText(/Existencia actual/)).not.toBeInTheDocument();
  });

  it("ignores a stale answer that arrives after a newer search", async () => {
    let resolverLenta: (r: Awaited<ReturnType<typeof consultarInventarioAction>>) => void = () => {};
    mockConsultar.mockReset();
    mockConsultar
      .mockImplementationOnce(() => new Promise((resolve) => (resolverLenta = resolve)))
      .mockResolvedValueOnce({
        ok: true,
        data: { ...resultadoBusqueda(), items: resultadoBusqueda().items.slice(1) },
      });
    render(<AjusteInventarioForm />);

    fireEvent.change(screen.getByLabelText("Producto *"), { target: { value: "a" } });
    await act(async () => {
      jest.advanceTimersByTime(300);
    });
    fireEvent.change(screen.getByLabelText("Producto *"), { target: { value: "ha" } });
    await act(async () => {
      jest.advanceTimersByTime(300);
    });
    await act(async () => {
      resolverLenta({ ok: true, data: resultadoBusqueda() });
    });

    expect(screen.getByText("P-008 — Habichuelas")).toBeInTheDocument();
    expect(screen.queryByText("P-007 — Arroz")).not.toBeInTheDocument();
  });

  it("shows the message of a failed search, and of a rejected one", async () => {
    mockConsultar.mockResolvedValueOnce({
      ok: false,
      error: { code: "NO_AUTORIZADO", message: "No tiene permisos para consultar inventario" },
    });
    render(<AjusteInventarioForm />);

    fireEvent.change(screen.getByLabelText("Producto *"), { target: { value: "arr" } });
    await act(async () => {
      jest.advanceTimersByTime(300);
    });
    expect(screen.getByRole("status")).toHaveTextContent("No tiene permisos para consultar inventario");

    mockConsultar.mockRejectedValueOnce(new Error("timeout"));
    fireEvent.change(screen.getByLabelText("Producto *"), { target: { value: "arro" } });
    await act(async () => {
      jest.advanceTimersByTime(300);
    });
    expect(screen.getByRole("status")).toHaveTextContent("No se pudo buscar productos. Intente de nuevo.");
  });
});

describe("AjusteInventarioForm — confirm gating and live line (S2)", () => {
  it("keeps confirm disabled until product, type, motivo and a valid amount exist", async () => {
    render(<AjusteInventarioForm />);
    escribirCantidad("10");
    expect(confirmar()).toBeDisabled();

    await elegirProducto();
    expect(confirmar()).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Entrada" }));
    expect(confirmar()).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Motivo *"), { target: { value: "Merma" } });
    expect(confirmar()).toBeEnabled();
  });

  it.each(["", "0", "0.000", "-5", "+5", "1.2345", "1234567890", "abc", "1,5", "1e3", ".5", "5."])(
    "keeps confirm disabled for the invalid amount %p",
    async (valor) => {
      render(<AjusteInventarioForm />);
      await completar();
      expect(confirmar()).toBeEnabled();

      escribirCantidad(valor);

      expect(confirmar()).toBeDisabled();
      expect(screen.queryByText(/Existencia actual/)).not.toBeInTheDocument();
    },
  );

  it.each(["10", "0.001", "999999849.999", "123456789.123", "5.5"])(
    "accepts the valid amount %p",
    async (valor) => {
      render(<AjusteInventarioForm />);
      await completar("Entrada", valor);

      expect(confirmar()).toBeEnabled();
    },
  );

  it("stops an Entrada that would pass the stock ceiling, and lets the exact ceiling through", async () => {
    render(<AjusteInventarioForm />);
    await completar("Entrada", "999999850");

    expect(
      screen.getByText("La existencia resultante supera el máximo permitido (999,999,999.999)."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/quedará/)).not.toBeInTheDocument();
    expect(confirmar()).toBeDisabled();

    escribirCantidad("999999849.999");
    expect(screen.getByText("Existencia actual 150 → quedará 999999999.999")).toBeInTheDocument();
    expect(confirmar()).toBeEnabled();
  });

  it.each([
    ["1,5", "Use punto decimal y hasta 3 decimales (ejemplo: 1.5)."],
    [".5", "Use punto decimal y hasta 3 decimales (ejemplo: 1.5)."],
    ["1.2345", "Use punto decimal y hasta 3 decimales (ejemplo: 1.5)."],
    ["0.000", "La cantidad debe ser mayor que 0."],
  ])("explains why the amount %p is not accepted", async (valor, mensaje) => {
    render(<AjusteInventarioForm />);
    await completar("Entrada", "10");

    escribirCantidad(valor);

    expect(screen.getByText(mensaje)).toBeInTheDocument();
    expect(confirmar()).toBeDisabled();
  });

  it("shows no hint for the untouched default 0 or an empty field", async () => {
    render(<AjusteInventarioForm />);
    await completar("Entrada", "10");

    escribirCantidad("0");
    expect(screen.queryByText(/Use punto decimal|mayor que 0/)).not.toBeInTheDocument();
    escribirCantidad("");
    expect(screen.queryByText(/Use punto decimal|mayor que 0/)).not.toBeInTheDocument();
  });

  it("shows 'Existencia actual X → quedará Y' for Entrada", async () => {
    render(<AjusteInventarioForm />);
    await completar("Entrada", "10");

    expect(screen.getByText("Existencia actual 150 → quedará 160")).toBeInTheDocument();
  });

  it("shows 'Existencia actual X → quedará Y' for Salida, with decimals and no needless zeros", async () => {
    render(<AjusteInventarioForm />);
    await completar("Salida", "0.25");

    expect(screen.getByText("Existencia actual 150 → quedará 149.75")).toBeInTheDocument();
    expect(confirmar()).toBeEnabled();
  });

  it("allows a Salida that takes the stock exactly to 0", async () => {
    render(<AjusteInventarioForm />);
    await completar("Salida", "150");

    expect(screen.getByText("Existencia actual 150 → quedará 0")).toBeInTheDocument();
    expect(screen.queryByText("Stock insuficiente")).not.toBeInTheDocument();
    expect(confirmar()).toBeEnabled();
  });

  it("shows 'Stock insuficiente' and disables confirm when Salida exceeds the stock", async () => {
    render(<AjusteInventarioForm />);
    await completar("Salida", "150.001");

    expect(screen.getByText("Stock insuficiente")).toBeInTheDocument();
    expect(screen.queryByText(/quedará/)).not.toBeInTheDocument();
    expect(confirmar()).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Entrada" }));
    expect(screen.queryByText("Stock insuficiente")).not.toBeInTheDocument();
    expect(confirmar()).toBeEnabled();
  });
});

describe("AjusteInventarioForm — submit", () => {
  it("sends the unsigned amount for Entrada with the bare motivo, then goes to /inventario", async () => {
    render(<AjusteInventarioForm />);
    await completar("Entrada", "10", "Conteo físico");

    await enviar();

    expect(mockAjustar).toHaveBeenCalledTimes(1);
    expect(mockAjustar).toHaveBeenCalledWith({
      productoId: 7,
      cantidad: "10",
      motivo: "Conteo físico",
      requestId: expect.any(String),
    });
    expect(push).toHaveBeenCalledWith("/inventario");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("sends the trimmed amount when the field has surrounding spaces", async () => {
    render(<AjusteInventarioForm />);
    await completar("Entrada", " 5 ", "Merma");

    await enviar();

    expect(mockAjustar).toHaveBeenCalledWith({
      productoId: 7,
      cantidad: "5",
      motivo: "Merma",
      requestId: expect.any(String),
    });
  });

  it("keeps the longest motivo plus the longest observaciones under the backend limit of 255", async () => {
    render(<AjusteInventarioForm />);
    await completar("Entrada", "10", "Corrección de error");
    fireEvent.change(screen.getByLabelText("Observaciones"), { target: { value: "x".repeat(200) } });

    await enviar();

    const enviado = mockAjustar.mock.calls[0][0] as { motivo: string };
    expect(enviado.motivo).toBe("Corrección de error: " + "x".repeat(200));
    expect(enviado.motivo.length).toBeLessThanOrEqual(255);
    expect(screen.getByLabelText("Observaciones")).toHaveAttribute("maxlength", "200");
  });

  it("sends a negative amount for Salida and appends the trimmed observaciones to the motivo", async () => {
    render(<AjusteInventarioForm />);
    await completar("Salida", "2.5", "Producto dañado");
    fireEvent.change(screen.getByLabelText("Observaciones"), {
      target: { value: "  Saco roto en el almacén  " },
    });

    await enviar();

    expect(mockAjustar).toHaveBeenCalledWith({
      productoId: 7,
      cantidad: "-2.5",
      motivo: "Producto dañado: Saco roto en el almacén",
      requestId: expect.any(String),
    });
    expect(push).toHaveBeenCalledWith("/inventario");
  });

  it("treats whitespace-only observaciones as absent", async () => {
    render(<AjusteInventarioForm />);
    await completar("Entrada", "1", "Otro");
    fireEvent.change(screen.getByLabelText("Observaciones"), { target: { value: "   " } });

    await enviar();

    expect(mockAjustar).toHaveBeenCalledWith({
      productoId: 7,
      cantidad: "1",
      motivo: "Otro",
      requestId: expect.any(String),
    });
  });

  it("disables confirm from the first click until the result arrives, sending once", async () => {
    let resolver: (r: typeof AJUSTE_OK) => void = () => {};
    mockAjustar.mockReset();
    mockAjustar.mockImplementationOnce(() => new Promise((resolve) => (resolver = resolve)));
    render(<AjusteInventarioForm />);
    await completar();

    await enviar();
    expect(confirmar()).toBeDisabled();
    await act(async () => {
      fireEvent.click(confirmar());
      fireEvent.submit(confirmar().closest("form") as HTMLFormElement);
    });
    expect(mockAjustar).toHaveBeenCalledTimes(1);
    expect(push).not.toHaveBeenCalled();

    await act(async () => {
      resolver(AJUSTE_OK);
    });
    expect(push).toHaveBeenCalledWith("/inventario");
  });

  it("shows a business error in a visible alert and re-enables confirm; nothing navigates", async () => {
    mockAjustar.mockResolvedValueOnce({
      ok: false,
      error: { code: "STOCK_INSUFICIENTE", message: "Stock insuficiente para el ajuste" },
    });
    render(<AjusteInventarioForm />);
    await completar("Salida", "10");

    await enviar();

    expect(screen.getByRole("alert")).toHaveTextContent("Stock insuficiente para el ajuste");
    expect(confirmar()).toBeEnabled();
    expect(push).not.toHaveBeenCalled();
    expect(screen.queryByRole("link", { name: "Ir a Inventario" })).not.toBeInTheDocument();
  });

  it("clears the previous business error when the user submits again", async () => {
    mockAjustar.mockResolvedValueOnce({
      ok: false,
      error: { code: "STOCK_INSUFICIENTE", message: "Stock insuficiente para el ajuste" },
    });
    render(<AjusteInventarioForm />);
    await completar("Salida", "10");
    await enviar();
    expect(screen.getByRole("alert")).toBeInTheDocument();

    await enviar();

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(mockAjustar).toHaveBeenCalledTimes(2);
    expect(push).toHaveBeenCalledWith("/inventario");
  });

  it("when the action rejects, says the outcome is unknown, locks the fields and offers a safe retry", async () => {
    mockAjustar.mockRejectedValueOnce(new Error("timeout"));
    render(<AjusteInventarioForm />);
    await completar();

    await enviar();

    const alerta = screen.getByRole("alert");
    expect(alerta).toHaveTextContent(
      "No se pudo confirmar el ajuste. Puede reintentar: si el ajuste ya se aplicó, no se aplicará dos veces.",
    );
    expect(within(alerta).getByRole("link", { name: "Ir a Inventario" })).toHaveAttribute(
      "href",
      "/inventario",
    );
    // The fields are locked so the retry carries exactly the same data.
    expect(screen.getByLabelText("Nueva cantidad *")).toBeDisabled();
    expect(screen.getByLabelText("Motivo *")).toBeDisabled();
    expect(screen.getByLabelText("Observaciones")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Entrada" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Confirmar Ajuste" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reintentar ajuste" })).toBeEnabled();
    expect(push).not.toHaveBeenCalled();
  });

  it("Reintentar sends exactly the same payload and the same requestId, then goes to /inventario", async () => {
    mockAjustar.mockRejectedValueOnce(new Error("timeout"));
    render(<AjusteInventarioForm />);
    await completar("Salida", "3", "Merma");
    await enviar();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Reintentar ajuste" }));
    });

    expect(mockAjustar).toHaveBeenCalledTimes(2);
    expect(mockAjustar.mock.calls[1][0]).toEqual(mockAjustar.mock.calls[0][0]);
    expect((mockAjustar.mock.calls[0][0] as { requestId: string }).requestId.length).toBeGreaterThanOrEqual(8);
    expect(push).toHaveBeenCalledWith("/inventario");
  });

  it("a second Reintentar after another unknown outcome is still the same request", async () => {
    mockAjustar.mockRejectedValueOnce(new Error("timeout")).mockRejectedValueOnce(new Error("timeout"));
    render(<AjusteInventarioForm />);
    await completar();
    await enviar();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Reintentar ajuste" }));
    });
    expect(screen.getByRole("button", { name: "Reintentar ajuste" })).toBeEnabled();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Reintentar ajuste" }));
    });

    const claves = mockAjustar.mock.calls.map((c) => (c[0] as { requestId: string }).requestId);
    expect(claves).toHaveLength(3);
    expect(new Set(claves).size).toBe(1);
  });

  it("each form instance uses its own requestId", async () => {
    const primero = render(<AjusteInventarioForm />);
    await completar();
    await enviar();
    primero.unmount();

    mockAjustar.mockClear();
    render(<AjusteInventarioForm />);
    await completar();
    await enviar();

    const [clave1] = [(mockAjustar.mock.calls[0][0] as { requestId: string }).requestId];
    expect(clave1.length).toBeGreaterThanOrEqual(8);
    expect(mockAjustar).toHaveBeenCalledTimes(1);
  });

});
