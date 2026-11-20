/**
 * @jest-environment jsdom
 *
 * Board 05 (Compras) UI alignment tests — odd/tasks/uiux-alignment.md S26–S29.
 *
 * S26: the form carries the nota-fiscal banner from wireframe 05b, static copy
 * naming the NCF kind of the chosen receipt (B01/B11) and the retention law
 * articles, rendered before any NCF exists (a draft has none yet).
 *
 * S28: the shared F0 NumericKeypad opens when the quantity or unit-cost field
 * takes focus (touch-first, same primitive as boards 02–04) and the typed
 * digits land in the exact string the line keeps.
 *
 * S29: no raw-palette classes remain in the compra UI files — every color
 * routes through the system.md tokens (`--ink`, `--surface`, `--line`,
 * `--warn`, `--danger`, `--success`, `--accent`).
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import "@testing-library/jest-dom";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CompraFormulario } from "../CompraFormulario";
import type { CompraDetalleEditable } from "../compra-form-utils";
import "@/modules/compra/http/actions";
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

const mockProveedores = jest.mocked(listarProveedoresAction);

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
  tasaVigente: true,
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
      cantidad: "2",
      costoUnitario: "10",
      tasaItbis: "18",
      itbisLinea: "3.60",
      subtotalLinea: "20.00",
    },
  ],
};

function montar(compra: CompraDetalleEditable | null = null) {
  return render(
    <CompraFormulario
      compra={compra}
      sucursalNombre="Sucursal Central"
      onGuardado={jest.fn()}
      onActualizado={jest.fn()}
      onCancelar={jest.fn()}
    />,
  );
}

async function elegirProveedor(id: string) {
  await screen.findByRole("option", { name: /Distribuidora Norte/ });
  fireEvent.change(screen.getByLabelText("Proveedor"), { target: { value: id } });
}

async function elegirProducto() {
  jest.useFakeTimers();
  fireEvent.change(screen.getByLabelText("Producto línea 1"), {
    target: { value: "arroz" },
  });
  await act(async () => {
    jest.advanceTimersByTime(300);
  });
  jest.useRealTimers();
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "A001 — Arroz Selecto" }));
  });
}

beforeEach(() => {
  mockProveedores.mockResolvedValue({
    ok: true,
    data: { items: [PROVEEDOR_FORMAL, PROVEEDOR_INFORMAL], total: 2, page: 1 },
  });
  jest.mocked(consultarProductosAction).mockResolvedValue({
    ok: true,
    data: {
      items: [PRODUCTO],
      total: 1,
      page: 1,
      limit: 25,
      categorias: [],
      tasasItbis: ["18", "16", "0"],
    },
  });
});

afterEach(cleanup);

describe("Board 05 — nota-fiscal banner (S26)", () => {
  it("shows the wireframe 05b static copy verbatim (JD round 2: single NCF source)", async () => {
    montar();
    const banner = await screen.findByTestId("compra-nota-fiscal");
    expect(banner).toHaveTextContent(
      "Nota fiscal: NCF tipo B01 (Compra Formal). Retención ISR 2% (Art. 106 CT). En compras informales (B11) se retiene el 100% del ITBIS (Art. 339 CT).",
    );
  });

  it("keeps the static copy for an informal supplier (JD-B-107: no dual source)", async () => {
    montar();
    await elegirProveedor("4");
    const banner = await screen.findByTestId("compra-nota-fiscal");
    expect(banner).toHaveTextContent("NCF tipo B01 (Compra Formal)");
  });

  it("is a labelled note with the warn ring (JD-A-006/007, JD-B-108 pins)", async () => {
    montar();
    const banner = await screen.findByTestId("compra-nota-fiscal");
    expect(banner).toHaveAttribute("role", "note");
    expect(banner.className).toContain("ring-1");
    expect(banner.className).toContain("ring-warn");
  });
});

describe("Board 05 — NumericKeypad entry (S28)", () => {
  it("opens the keypad when the quantity field focuses and types into it", async () => {
    montar();
    await elegirProveedor("3");
    await elegirProducto();

    fireEvent.focus(screen.getByLabelText("Cantidad línea 1"));
    const teclado = screen.getByRole("group", {
      name: "Teclado numérico cantidad línea 1",
    });
    expect(teclado).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "2" }));
      fireEvent.click(screen.getByRole("button", { name: "." }));
      fireEvent.click(screen.getByRole("button", { name: "5" }));
    });
    expect(screen.getByLabelText("Cantidad línea 1")).toHaveValue("2.5");
  });

  it('the first tap of "." on the untouched quantity yields "0." (JD-A-001)', async () => {
    montar();
    await elegirProveedor("3");
    await elegirProducto();

    fireEvent.focus(screen.getByLabelText("Cantidad línea 1"));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "." }));
    });
    expect(screen.getByLabelText("Cantidad línea 1")).toHaveValue("0.");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "5" }));
    });
    expect(screen.getByLabelText("Cantidad línea 1")).toHaveValue("0.5");
  });

  it("an edited draft's stored value is REPLACED by the first tap, never extended (JD-B-101)", async () => {
    montar(COMPRA_BORRADOR);
    await elegirProveedor("3");

    const input = screen.getByLabelText("Cantidad línea 1");
    fireEvent.focus(input);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "5" }));
    });
    expect(input).toHaveValue("5");

    const costo = screen.getByLabelText("Costo unitario línea 1");
    fireEvent.focus(costo);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "9" }));
    });
    expect(costo).toHaveValue("9");
  });

  it("later taps append after the replacement (JD-B-101)", async () => {
    montar(COMPRA_BORRADOR);
    await elegirProveedor("3");

    const input = screen.getByLabelText("Cantidad línea 1");
    fireEvent.focus(input);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "3" }));
      fireEvent.click(screen.getByRole("button", { name: "." }));
      fireEvent.click(screen.getByRole("button", { name: "5" }));
    });
    expect(input).toHaveValue("3.5");
  });

  it("closes the keypad when a non-keypad control takes focus (JD-A-008)", async () => {
    montar();
    await elegirProveedor("3");
    await elegirProducto();

    fireEvent.focus(screen.getByLabelText("Cantidad línea 1"));
    expect(
      screen.getByRole("group", { name: "Teclado numérico cantidad línea 1" }),
    ).toBeInTheDocument();

    fireEvent.focus(screen.getByLabelText("Fecha"));
    expect(
      screen.queryByRole("group", { name: "Teclado numérico cantidad línea 1" }),
    ).toBeNull();
  });

  it("tapping a digit equal to the base EXTENDS after the first tap (JD-B-106)", async () => {
    montar();
    await elegirProveedor("3");
    await elegirProducto();

    const input = screen.getByLabelText("Cantidad línea 1");
    fireEvent.focus(input);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "1" }));
      fireEvent.click(screen.getByRole("button", { name: "0" }));
    });
    expect(input).toHaveValue("10");

    const costo = screen.getByLabelText("Costo unitario línea 1");
    fireEvent.focus(costo);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "1" }));
      fireEvent.click(screen.getByRole("button", { name: "." }));
      fireEvent.click(screen.getByRole("button", { name: "5" }));
    });
    expect(costo).toHaveValue("1.5");
  });

  it("a draft whose value starts with the tapped digit still replaces once (JD-B-106)", async () => {
    const borrador: CompraDetalleEditable = {
      ...COMPRA_BORRADOR,
      lineas: [
        {
          productoId: 11,
          productoNombre: "Arroz Selecto",
          cantidad: "5",
          costoUnitario: "5",
          tasaItbis: "18",
          itbisLinea: "9.00",
          subtotalLinea: "25.00",
        },
      ],
    };
    montar(borrador);
    await elegirProveedor("3");

    const input = screen.getByLabelText("Cantidad línea 1");
    fireEvent.focus(input);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "5" }));
      fireEvent.click(screen.getByRole("button", { name: "0" }));
    });
    expect(input).toHaveValue("50");
  });

  it("keyboard typing consumes the untouched base too (JD-B-101 parity)", async () => {
    montar();
    await elegirProveedor("3");
    await elegirProducto();

    const input = screen.getByLabelText("Cantidad línea 1");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "7" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "5" }));
    });
    expect(input).toHaveValue("75");
  });

  it("opens the keypad for the unit-cost field and types into it", async () => {
    montar();
    await elegirProveedor("3");
    await elegirProducto();

    fireEvent.focus(screen.getByLabelText("Costo unitario línea 1"));
    expect(
      screen.getByRole("group", { name: "Teclado numérico costo unitario línea 1" }),
    ).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "4" }));
      fireEvent.click(screen.getByRole("button", { name: "CLR" }));
    });
    expect(screen.getByLabelText("Costo unitario línea 1")).toHaveValue("");
  });
});

describe("Board 05 — F0 token retrofit (S29)", () => {
  const RAIZ = path.join(__dirname, "..");

  const FILES = [
    "ComprasScreen.tsx",
    "CompraFormulario.tsx",
    "CxpPanel.tsx",
    "ConfirmarCancelacionCompra.tsx",
    "compra-form-utils.ts",
    // The route shell is part of the retrofit (JD-B-103).
    path.join(RAIZ, "../../../app/(app)/compras/page.tsx"),
  ];

  const RAW_PALETTE =
    /(?:text|bg|border|ring|divide|from|to|placeholder|fill|stroke|shadow|outline|accent|caret|decoration)-(?:zinc|red|emerald|amber|indigo|gray|slate|neutral|stone|white|black|blue|green|orange|violet|purple|yellow|sky|rose|teal|cyan|lime|pink|fuchsia)-?[^\s"'`]*/g;

  const ARBITRARY_HEX = /(?:text|bg|border|ring)-\[#[^\]]+\]/g;

  it("keeps zero raw-palette classes in the compra UI files", () => {
    const ofensas = FILES.flatMap((archivo) => {
      const fuente = readFileSync(path.isAbsolute(archivo) ? archivo : path.join(RAIZ, archivo), "utf8");
      const coincidencias = [...(fuente.match(RAW_PALETTE) ?? []), ...(fuente.match(ARBITRARY_HEX) ?? [])];
      return coincidencias.map((coincidencia) => `${archivo}: ${coincidencia}`);
    });
    expect(ofensas).toEqual([]);
  });
});
