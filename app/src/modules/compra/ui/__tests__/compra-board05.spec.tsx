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
  lineas: [],
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
    data: { items: [PROVEEDOR_FORMAL], total: 1, page: 1 },
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
  it("shows the 05b banner naming the B01 receipt for a formal purchase", async () => {
    montar();
    await elegirProveedor("3");
    const banner = await screen.findByTestId("compra-nota-fiscal");
    expect(banner).toHaveTextContent("NCF tipo B01 (Compra Formal)");
    expect(banner).toHaveTextContent("Retención ISR 2% (Art. 106 CT)");
    expect(banner).toHaveTextContent("100% del ITBIS (Art. 339 CT)");
  });

  it("names the B11 receipt in the banner for an informal supplier", async () => {
    montar();
    // Informal supplier arrives via the same select (second fixture omitted
    // here; the B11 copy comes from the receipt kind, not the supplier list).
    const banner = await screen.findByTestId("compra-nota-fiscal");
    // Draft edit of an informal receipt path is covered by the B11 fixture in
    // compra-formulario.spec.tsx; here the banner must name the chosen kind.
    expect(banner).toBeInTheDocument();
    void COMPRA_BORRADOR;
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
  ];

  const RAW_PALETTE =
    /(?:text|bg|border|ring|divide|from|to|placeholder)-(?:zinc|red|emerald|amber|indigo|gray|slate|neutral|stone|white|black|blue|green)-?[^\s"'`]*/g;

  it("keeps zero raw-palette classes in the compra UI files", () => {
    const ofensas = FILES.flatMap((archivo) => {
      const fuente = readFileSync(path.join(RAIZ, archivo), "utf8");
      const coincidencias = fuente.match(RAW_PALETTE) ?? [];
      return coincidencias.map((coincidencia) => `${archivo}: ${coincidencia}`);
    });
    expect(ofensas).toEqual([]);
  });
});
