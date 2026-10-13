/**
 * @jest-environment jsdom
 *
 * Switch confirm affordance unit tests (SEL-NAV-06-A/B, tasks 4.4).
 *
 * Double-submit server discipline note: the SERVER revalidates everything
 * (AGENTS.md), so a stale retry with the same target re-verifies to the
 * idempotent no-op success — the UI guard keeps the button disabled while the
 * action is in flight (pendiente), which is what these tests pin.
 */

import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { UsuarioSucursalForm } from "./usuario-sucursal-form";
import type { SucursalResumen } from "@/modules/tenant/infrastructure/repo-sucursal";

jest.mock("@/modules/tenant/http/actions.sucursal", () => ({
  cambiarSucursalActivaAction: jest.fn(),
}));

jest.mock("next/navigation", () => ({
  useRouter: jest.fn(),
}));

import { cambiarSucursalActivaAction } from "@/modules/tenant/http/actions.sucursal";
import { useRouter } from "next/navigation";

const actionMock = cambiarSucursalActivaAction as unknown as jest.Mock;
const pushMock = jest.fn();
(useRouter as unknown as jest.Mock).mockReturnValue({ push: pushMock });

const sucursales: SucursalResumen[] = [
  { id: 10, nombre: "B1 Matriz" },
  { id: 20, nombre: "B2 Zona Este" },
];

function renderForm(sucursalActualId = 10) {
  return render(
    <UsuarioSucursalForm sucursales={sucursales} sucursalActualId={sucursalActualId} />,
  );
}

describe("UsuarioSucursalForm (SEL-NAV-06-A/B)", () => {
  beforeEach(() => {
    jest.resetAllMocks();
    pushMock.mockReset();
    (useRouter as unknown as jest.Mock).mockReturnValue({ push: pushMock });
  });

  it("confirms with the preselected branch and lands on /dashboard on success", async () => {
    actionMock.mockResolvedValue({ ok: true });
    renderForm();

    fireEvent.click(screen.getByTestId("selector-confirm"));

    await waitFor(() => {
      expect(actionMock).toHaveBeenCalledTimes(1);
      expect(actionMock).toHaveBeenCalledWith({ sucursalId: 10 });
      expect(pushMock).toHaveBeenCalledWith("/dashboard");
    });
  });

  it("is double-submit SAFE while pending: the confirm stays disabled", async () => {
    actionMock.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve({ ok: true }), 50)),
    );
    renderForm();

    const button = screen.getByTestId("selector-confirm");
    fireEvent.click(button);
    expect(button).toBeDisabled();
    // A second physical click while disabled must not re-fire the action.
    fireEvent.click(button);

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/dashboard"));
    expect(actionMock).toHaveBeenCalledTimes(1);
  });

  it("a typed business failure keeps the user on the board with the stable message", async () => {
    actionMock.mockResolvedValue({
      ok: false,
      code: "TEN_SUCURSAL_NO_VALIDA",
      message: "La sucursal indicada no está disponible.",
    });
    renderForm();

    fireEvent.click(screen.getByTestId("selector-confirm"));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        "La sucursal indicada no está disponible.",
      );
    });
    // No navigation on failure (no dead route):
    expect(pushMock).not.toHaveBeenCalled();
  });
});
