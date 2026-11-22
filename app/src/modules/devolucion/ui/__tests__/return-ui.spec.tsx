/**
 * @jest-environment jsdom
 *
 * Return-UI controls (fase-5d, tasks 2.1 + 2.2). Same boundary-mock convention
 * as venta's confirm-ui.spec.tsx: the `"use server"` actions are replaced with
 * jest.fn() so the screen is tested against the HTTP DTO contract only — never
 * a database.
 *
 * Pins: the Return control exists for CONFIRMADA rows only, its form submit is
 * single-shot (disabled on first click; a double click fires the action once),
 * the client payload is validated with the SHARED `zDevolverVentaInput` schema
 * (.VALIDATION_ERROR before any call), stable action error codes surface
 * verbatim without stack traces, and the success message carries the NC id and
 * the emitted B04 NCF.
 */

import "@testing-library/jest-dom";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PosScreen } from "@/modules/venta/ui/PosScreen";
import { ESTADO_VENTA } from "@/modules/venta/domain/venta";
import {
  listarVentasAction,
  obtenerVentaAction,
} from "@/modules/venta/http/actions";
// Board 02 (S4/S5): PosScreen now mounts Next's router — mock it like the actions.
const mockPush = jest.fn();
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, refresh: jest.fn() }),
}));

import { listarProductosAction } from "@/modules/producto/http/actions";
import { listarClientesAction } from "@/modules/cliente/http/actions";
import { devolverVentaAction } from "@/modules/devolucion/http/actions";

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
jest.mock("@/modules/devolucion/http/actions", () => ({
  devolverVentaAction: jest.fn(),
}));

const mockListar = jest.mocked(listarVentasAction);
const mockObtener = jest.mocked(obtenerVentaAction);
const mockDevolver = jest.mocked(devolverVentaAction);
const mockProductos = jest.mocked(listarProductosAction);
const mockClientes = jest.mocked(listarClientesAction);

const CONFIRMADA_7 = {
  id: 7,
  fecha: new Date().toISOString(),
  estado: ESTADO_VENTA.CONFIRMADA,
  total: "118.00",
  descuento: "0.00",
  clienteNombre: "Consumidor Final",
  usuarioNombre: "Ana",
  ncf: "B0200000101",
  facturaId: 101,
};

const DETALLE = {
  ok: true as const,
  data: {
    id: 7,
    clienteId: 1,
    clienteNombre: "Consumidor Final",
    fecha: new Date().toISOString(),
    estado: ESTADO_VENTA.CONFIRMADA,
    subtotal: "100.00",
    descuento: "0.00",
    descuentoTipo: "PORCENTAJE",
    descuentoAutorizadoPor: null,
    itbis: "18.00",
    total: "118.00",
    lineas: [
      {
        productoId: 11,
        productoNombre: "Arroz",
        cantidad: "2",
        precioUnitario: "50.00",
        tasaItbis: "18",
        descuentoLinea: "0.00",
        descuentoTipo: "PORCENTAJE",
        itbisLinea: "18.00",
        subtotalLinea: "100.00",
      },
    ],
  },
};

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function renderPos(): Promise<void> {
  mockListar.mockResolvedValue({
    ok: true as const,
    data: { items: [CONFIRMADA_7], total: 1, page: 1, limit: 25 },
  });
  // The form's mount effect reads the sale immediately on open.
  mockObtener.mockResolvedValue(DETALLE);
  mockClientes.mockResolvedValue({
    ok: true as const,
    data: { items: [], total: 0, page: 1 },
  });
  mockProductos.mockResolvedValue({
    ok: true as const,
    data: { items: [], total: 0, page: 1 },
  });
  // Board 02 remediation (JD-A): the return button is gated by puedeDevolver;
  // these tests exercise the authorized-role path.
  render(<PosScreen esAdmin={false} puedeDevolver />);
  await settle();
  // Board 02 (S6): the drafts list is collapsed by default; expand to reach rows.
  fireEvent.click(await screen.findByRole("button", { name: /My drafts/ }));
}

describe("Return-UI (fase-5d tasks 2.1–2.2)", () => {
  beforeEach(() => {
    mockObtener.mockReset();
    mockDevolver.mockReset();
  });

  afterEach(cleanup);

  it("opens the return form for a CONFIRMADA row and submits once with the shared schema shape", async () => {
    await renderPos();
    fireEvent.click(await screen.findByRole("button", { name: "Devolver venta 7" }));

    mockObtener.mockResolvedValue(DETALLE);
    await screen.findByRole("heading", { name: /Devolver venta #7/ });

    // Controllable pending promise: the submit button disables on FIRST click.
    let resolver:
      | ((v: {
          ok: true;
          data: {
            id: number;
            ncf: string;
            facturaId: number;
            estado: string;
            monto: string;
            itbis: string;
            lineas: number;
          };
        }) => void)
      | null = null;
    mockDevolver.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolver = resolve;
        }),
    );

    const motivo = screen.getByLabelText("Motivo de la devolución");
    fireEvent.change(motivo, { target: { value: "Producto dañado en traslado" } });
    fireEvent.change(screen.getByLabelText("Cantidad a devolver de Arroz"), {
      target: { value: "1" },
    });

    const submit = screen.getByRole("button", { name: "Emitir nota de crédito" });
    fireEvent.click(submit);
    expect(submit).toBeDisabled();
    // Same-cycle double click must NOT fire a second consume (single-shot).
    fireEvent.click(submit);
    await waitFor(() =>
      expect(mockDevolver).toHaveBeenCalledTimes(1),
    );
    expect(mockDevolver).toHaveBeenCalledWith({
      ventaId: 7,
      motivo: "Producto dañado en traslado",
      lineas: [{ productoId: 11, cantidad: "1", tipoReposicion: "VENDIBLE" }],
    });

    resolver!({
      ok: true,
      data: {
        id: 22,
        ncf: "B0400000201",
        facturaId: 77,
        estado: "VIGENTE",
        monto: "50.00",
        itbis: "9.00",
        lineas: 1,
      },
    });
    await settle();
    const status = await screen.findByRole("status");
    await waitFor(() =>
      expect(status.textContent).toContain("NC #22"),
    );
    expect(status.textContent).toContain("B0400000201");
  });

  it("surfaces the stable action error code verbatim without stack traces", async () => {
    await renderPos();
    fireEvent.click(await screen.findByRole("button", { name: "Devolver venta 7" }));
    mockObtener.mockResolvedValue(DETALLE);
    await screen.findByRole("heading", { name: /Devolver venta #7/ });

    mockDevolver.mockResolvedValue({
      ok: false as const,
      error: {
        code: "CANTIDAD_EXCEDE_ORIGINAL",
        message: "La cantidad a devolver excede la cantidad original vendida",
      },
    });
    fireEvent.change(screen.getByLabelText("Motivo de la devolución"), {
      target: { value: "Devolución" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Emitir nota de crédito" }));

    const status = await screen.findByRole("status");
    expect(status.textContent).toContain("[CANTIDAD_EXCEDE_ORIGINAL]");
    expect(status.textContent).toContain("excede");
    // No stack traces or Prisma internals on the surface.
    expect(status.textContent).not.toMatch(/at .*\.ts|Prisma|Error:/);
  });

  it("rejects an invalid payload client-side with VALIDATION_ERROR before calling the action", async () => {
    await renderPos();
    const opener = await screen.findByRole("button", { name: "Devolver venta 7" });
    fireEvent.click(opener);
    mockObtener.mockResolvedValue(DETALLE);
    await screen.findByRole("heading", { name: /Devolver venta #7/ });

    // Empty motivo fails the shared zDevolverVentaInput (min 1).
    fireEvent.click(screen.getByRole("button", { name: "Emitir nota de crédito" }));
    await waitFor(() =>
      expect(screen.getByText(/Complete el motivo/)).toBeInTheDocument(),
    );
    expect(mockDevolver).not.toHaveBeenCalled();
  });

  it("offers the frozen restock selector with exactly VENDIBLE and DANADO", async () => {
    await renderPos();
    fireEvent.click(await screen.findByRole("button", { name: "Devolver venta 7" }));
    mockObtener.mockResolvedValue(DETALLE);
    await screen.findByRole("heading", { name: /Devolver venta #7/ });

    const select = screen.getByLabelText("Tipo de reposición de Arroz");
    expect(select).toBeInTheDocument();
    expect((select as unknown as HTMLSelectElement).textContent).toContain("VENDIBLE");
    expect((select as unknown as HTMLSelectElement).textContent).toContain("DANADO");
  });

  it("shows an error instead of loading forever when reading the sale rejects", async () => {
    await renderPos();
    mockObtener.mockRejectedValue(new Error("network down"));
    fireEvent.click(await screen.findByRole("button", { name: "Devolver venta 7" }));

    const status = await screen.findByRole("status");
    expect(status.textContent).toContain("No se pudo completar la operación");
    expect(status.textContent).not.toContain("network down");
    expect(screen.queryByText(/Cargando las líneas/)).toBeNull();
  });

  it("re-enables the submit button and shows an error when the return action rejects", async () => {
    await renderPos();
    fireEvent.click(await screen.findByRole("button", { name: "Devolver venta 7" }));
    await screen.findByRole("heading", { name: /Devolver venta #7/ });

    mockDevolver.mockRejectedValue(new Error("boom"));
    fireEvent.change(screen.getByLabelText("Motivo de la devolución"), {
      target: { value: "Devolucion" },
    });
    const submit = screen.getByRole("button", { name: "Emitir nota de crédito" });
    fireEvent.click(submit);

    const status = await screen.findByRole("status");
    expect(status.textContent).toContain("No se pudo confirmar si la nota de crédito fue emitida");
    expect(status.textContent).not.toContain("boom");
    await waitFor(() => expect(submit).toBeEnabled());
  });

  it("keeps the close button disabled while the credit note is being issued", async () => {
    await renderPos();
    fireEvent.click(await screen.findByRole("button", { name: "Devolver venta 7" }));
    await screen.findByRole("heading", { name: /Devolver venta #7/ });

    mockDevolver.mockImplementation(() => new Promise(() => {}));
    fireEvent.change(screen.getByLabelText("Motivo de la devolución"), {
      target: { value: "Devolucion" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Emitir nota de crédito" }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Cerrar formulario de devolución" })).toBeDisabled(),
    );
  });

  it("keeps the form mounted when the opener is clicked while the credit note is being issued", async () => {
    await renderPos();
    const opener = await screen.findByRole("button", { name: "Devolver venta 7" });
    fireEvent.click(opener);
    await screen.findByRole("heading", { name: /Devolver venta #7/ });

    mockDevolver.mockImplementation(() => new Promise(() => {}));
    fireEvent.change(screen.getByLabelText("Motivo de la devolución"), {
      target: { value: "Devolucion" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Emitir nota de crédito" }));

    await waitFor(() => expect(opener).toBeDisabled());
    fireEvent.click(opener);
    expect(screen.getByRole("heading", { name: /Devolver venta #7/ })).toBeInTheDocument();
  });

  // Board 02 remediation (JD-A, MEDIUM): a role ROLES_DEVOLUCION denies
  // (e.g. Despachador) never sees the return affordance — no dead button.
  it("hides the Return control when puedeDevolver is false", async () => {
    // Positive control first: the CONFIRMADA row IS rendered (non-vacuous).
    mockListar.mockResolvedValue({
      ok: true as const,
      data: { items: [CONFIRMADA_7], total: 1, page: 1, limit: 25 },
    });
    render(<PosScreen esAdmin={false} />);
    await settle();
    fireEvent.click(await screen.findByRole("button", { name: /My drafts/ }));
    expect(await screen.findByTestId("venta-fila-7")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Devolver venta 7" })).toBeNull();
  });
});
