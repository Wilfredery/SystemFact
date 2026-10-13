/**
 * @jest-environment jsdom
 *
 * Board 02 unit tests (SEL-RENDER-02/SEL-EMPTY-04/SEL-PLAN-03) + the
 * primitives/tokens-only review hook (SEL-RENDER-02-C) over the whole
 * selector surface sources.
 */

import "@testing-library/jest-dom";
import { readFileSync } from "node:fs";
import path from "node:path";
import { render, screen } from "@testing-library/react";
import { SelectorEmpresaSucursal } from "./board";
import type { SucursalResumen } from "@/modules/tenant/infrastructure/repo-sucursal";

// The board mounts the client form, which imports the real server-action
// module (and its Supabase env reader) at module scope — mock it like the
// venta/devolucion screens do so the board stays DB- and env-free.
jest.mock("@/modules/tenant/http/actions.sucursal", () => ({
  cambiarSucursalActivaAction: jest.fn(),
}));
// The client form reads useRouter for the post-switch navigation.
jest.mock("next/navigation", () => ({
  useRouter: jest.fn().mockReturnValue({ push: jest.fn() }),
}));

const sucursales: SucursalResumen[] = [
  { id: 10, nombre: "B1 Matriz" },
  { id: 20, nombre: "B2 Zona Este" },
];

function renderBoard(
  overrides: Partial<Parameters<typeof SelectorEmpresaSucursal>[0]> = {},
) {
  return render(
    <SelectorEmpresaSucursal
      empresaNombre="Colmado XYZ"
      sucursales={sucursales}
      sucursalActualId={10}
      plan="free"
      {...overrides}
    />,
  );
}

describe("SelectorEmpresaSucursal (board 02)", () => {
  it("SEL-RENDER-02-A: the empresa is rendered ONCE as static inert content", () => {
    renderBoard();

    const nodes = screen.getAllByText("Colmado XYZ");
    expect(nodes).toHaveLength(1);
    // It is never selectable: no option/interactive node carries the name...
    // the single node is the static heading.
    expect(
      nodes[0]!.closest("[role='option'], [role='combobox'], button"),
    ).toBeNull();
    expect(screen.queryByRole("combobox", { name: /colmado/i })).toBeNull();
  });

  it("SEL-RENDER-02-B: the option set is served from the S1 result", () => {
    renderBoard();

    // The select trigger + confirm exist for a non-empty set; the CURRENT
    // branch marker is embedded in the option label built client-side.
    expect(screen.getByTestId("selector-branch-select")).toBeInTheDocument();
    expect(screen.getByTestId("selector-confirm")).toBeInTheDocument();
  });

  it("SEL-PLAN-03-A: the plan badge comes from the reserved seam prop", () => {
    renderBoard({ plan: "free" });

    // The badge text equals the plan value passed from the seam.
    expect(screen.getByTestId("selector-plan-badge")).toHaveTextContent("free");
  });

  it("SEL-EMPTY-04-A: an empty list renders the empty state and NO confirm", () => {
    renderBoard({ sucursales: [] });

    expect(screen.getByTestId("selector-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("selector-confirm")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("selector-branch-select"),
    ).not.toBeInTheDocument();
  });
});

describe("SEL-RENDER-02-C — primitives/tokens-only review hook", () => {
  const sources = [
    readFileSync(path.join(__dirname, "board.tsx"), "utf8"),
    readFileSync(path.join(__dirname, "usuario-sucursal-form.tsx"), "utf8"),
    readFileSync(path.join(__dirname, "page.tsx"), "utf8"),
    readFileSync(
      path.join(__dirname, "../../../shared/ui/app-shell/shell.tsx"),
      "utf8",
    ),
  ];

  it("no raw palette classes, no hex literals, no dark: variants", () => {
    for (const source of sources) {
      expect(source).not.toMatch(/zinc-|indigo-|slate-/);
      expect(source).not.toMatch(/#[0-9a-fA-F]{3,6}\b/);
      expect(source).not.toMatch(/dark:/);
    }
  });

  it("every control is an F0 primitive import (no raw button/input down the surface)", () => {
    const board = sources[0]!;
    // The board composes only Card/Badge primitives + its own h2/p heading.
    expect(board).toMatch(/from "@\/components\/ui\/card"/);
    expect(board).toMatch(/from "@\/components\/ui\/badge"/);
    // The form composes the F0 Button/Select primitives.
    expect(sources[1]).toMatch(/from "@\/components\/ui\/button"/);
    expect(sources[1]).toMatch(/from "@\/components\/ui\/select"/);
  });
});
