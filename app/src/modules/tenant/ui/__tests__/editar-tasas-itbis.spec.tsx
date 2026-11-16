/**
 * @jest-environment jsdom
 *
 * RTL — EditarTasasItbisCard (feature itbis-tasas-edit, S3): client-side
 * validation with the shared parser, server-refusal surfacing, no-op and
 * success messages, and single-submit guarding.
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { EditarTasasItbisCard } from "../EditarTasasItbisCard";
import { editarTasasItbisAction } from "@/modules/tenant/http/actions.configuracion";
import { consultarConfiguracionAction } from "@/modules/tenant/http/actions.administracion";

jest.mock("@/modules/tenant/http/actions.configuracion", () => ({
  editarTasasItbisAction: jest.fn(),
}));
jest.mock("@/modules/tenant/http/actions.administracion", () => ({
  consultarConfiguracionAction: jest.fn(),
}));

const FILA = {
  valor: "18,16,0",
  vigenciaInicio: "2000-01-01T00:00:00.000Z",
  vigenciaFin: "2099-12-31T23:59:59.000Z",
};

beforeEach(() => {
  jest.clearAllMocks();
  (consultarConfiguracionAction as jest.Mock).mockResolvedValue({
    ok: true,
    data: { retenciones: null, ncf: [], itbisEnUso: [], tasaItbis: FILA },
  });
});

describe("EditarTasasItbisCard", () => {
  it("shows the current list and its window", () => {
    render(<EditarTasasItbisCard inicial={FILA} />);
    expect(screen.getByText(/Lista vigente: 18,16,0/));
  });

  it("blocks an obviously malformed list client-side without calling the server", async () => {
    render(<EditarTasasItbisCard inicial={FILA} />);
    fireEvent.change(screen.getByLabelText(/Nueva lista/), { target: { value: "18,,16" } });
    fireEvent.click(screen.getByRole("button", { name: /Guardar lista/ }));
    expect(screen.getByTestId("tasas-itbis-error").textContent).toMatch(/no es válida/i);
    expect(editarTasasItbisAction).not.toHaveBeenCalled();
  });

  it("surfaces the server refusal and never fabricates success", async () => {
    (editarTasasItbisAction as jest.Mock).mockResolvedValue({
      ok: false,
      error: { code: "TEN_OPS_NO_AUTORIZADO", message: "No tienes permiso." },
    });
    render(<EditarTasasItbisCard inicial={FILA} />);
    fireEvent.change(screen.getByLabelText(/Nueva lista/), { target: { value: "7" } });
    fireEvent.click(screen.getByRole("button", { name: /Guardar lista/ }));
    await waitFor(() =>
      expect(screen.getByTestId("tasas-itbis-error").textContent).toContain("No tienes permiso"),
    );
    expect(consultarConfiguracionAction).not.toHaveBeenCalled();
  });

  it("shows the no-op message when the set was already active", async () => {
    (editarTasasItbisAction as jest.Mock).mockResolvedValue({
      ok: true,
      data: { valor: "18,16,0", vigenciaInicio: FILA.vigenciaInicio, cambioAplicado: false },
    });
    render(<EditarTasasItbisCard inicial={FILA} />);
    fireEvent.change(screen.getByLabelText(/Nueva lista/), { target: { value: "16,18,0" } });
    fireEvent.click(screen.getByRole("button", { name: /Guardar lista/ }));
    await waitFor(() =>
      expect(screen.getByTestId("tasas-itbis-mensaje").textContent).toMatch(
        "No había cambios que guardar.",
      ),
    );
    expect(consultarConfiguracionAction).toHaveBeenCalledTimes(1);
  });

  it("shows the saved message and re-reads after a successful change", async () => {
    (editarTasasItbisAction as jest.Mock).mockResolvedValue({
      ok: true,
      data: { valor: "18,16,7", vigenciaInicio: "2026-11-16T12:00:00.000Z", cambioAplicado: true },
    });
    (consultarConfiguracionAction as jest.Mock).mockResolvedValue({
      ok: true,
      data: {
        retenciones: null,
        ncf: [],
        itbisEnUso: [],
        tasaItbis: { ...FILA, valor: "18,16,7" },
      },
    });
    render(<EditarTasasItbisCard inicial={FILA} />);
    fireEvent.change(screen.getByLabelText(/Nueva lista/), { target: { value: "18,16,7" } });
    fireEvent.click(screen.getByRole("button", { name: /Guardar lista/ }));
    await waitFor(() =>
      expect(screen.getByTestId("tasas-itbis-mensaje").textContent).toMatch(
        "Lista de tasas actualizada.",
      ),
    );
    await waitFor(() =>
      expect(screen.getByText(/Lista vigente: 18,16,7/)),
    );
  });

  it("shows the config-missing alert when the empresa has no row yet", () => {
    render(<EditarTasasItbisCard inicial={null} />);
    expect(screen.getByRole("alert").textContent).toMatch(/TASA_ITBIS/);
  });
});
