/**
 * @jest-environment jsdom
 *
 * AuthShell "Cambiar sucursal" slot (SEL-SLOT-05-A/B, design D6).
 */

import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import { AuthShell } from "./shell";

// SidebarItem is a "use client" island reading usePathname; provide the hook
// so the jsdom render stays framework-free.
jest.mock("next/navigation", () => ({
  usePathname: jest.fn().mockReturnValue("/dashboard"),
}));

function renderShell(esAdmin: boolean) {
  return render(
    <AuthShell empresaNombre="Colmado XYZ" sucursalNombre="Matriz" esAdmin={esAdmin}>
      <main>contenido</main>
    </AuthShell>,
  );
}

describe("AuthShell selector trigger (SEL-SLOT-05)", () => {
  it("SEL-SLOT-05-A: the admin gets a REAL navigable link (not aria-disabled)", () => {
    renderShell(true);

    const trigger = screen.getByTestId("cambiar-sucursal");
    expect(trigger.tagName).toBe("A");
    expect(trigger).toHaveAttribute("href", "/selector-empresa-sucursal");
    expect(trigger).toHaveAccessibleName("Cambiar sucursal");
    expect(trigger).not.toHaveAttribute("aria-disabled");
    // Touch-first hitbox floor (h-11 = 44px).
    expect(trigger.className).toContain("h-11");
  });

  it("SEL-SLOT-05-B: the non-admin shell has NO trigger node and the sidebar is unchanged", () => {
    renderShell(false);

    expect(screen.queryByTestId("cambiar-sucursal")).not.toBeInTheDocument();
    // The eight ratified modules keep their exact labels.
    expect(screen.getByText("Dashboard")).toBeInTheDocument();
    expect(screen.getByText("Venta")).toBeInTheDocument();
    expect(screen.getByText("Cobros")).toBeInTheDocument();
    expect(screen.getByText("Inventario")).toBeInTheDocument();
    expect(screen.getByText("Compras")).toBeInTheDocument();
    expect(screen.getByText("Caja")).toBeInTheDocument();
    expect(screen.getByText("Reportes")).toBeInTheDocument();
    expect(screen.getByText("Administración")).toBeInTheDocument();
    expect(screen.getByText("Auditoría")).toBeInTheDocument();
  });
});
