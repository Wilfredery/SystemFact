/**
 * @jest-environment jsdom
 *
 * Auditoria UI (Slice D, task 4.3; AC-2 / AC-3 / AC-5). Same boundary-mock convention as
 * `cobros/ui/__tests__/cobros-ui.spec.tsx`: the components render against the read DTO
 * contract only — never a database. `next/link` is stubbed to a plain anchor (no App
 * Router context in the test host) and `next/navigation` to a `router.push` spy so the
 * filter form's navigation can be asserted without a live router.
 *
 * Pins:
 *   • the table renders the newest-first rows AS-IS and shows the active-filter total
 *     (AC-2), and formats the stored UTC instant in Santo-Domingo wall-clock (AGENTS dates)
 *     — proven by a UTC-midnight instant rendering the PRIOR SD day;
 *   • the consultation is READ-ONLY: the table exposes ZERO mutation controls (no button,
 *     form or handler) — navigation is the only affordance (AC-5);
 *   • pagination links preserve the active filters and only change `page` (page 1 drops it);
 *   • the filter form dispatches the combined facets onto the URL (AND-combinable, AC-3),
 *     drops a blank/bad locator id, and disables submit while a transition is pending.
 */

import "@testing-library/jest-dom";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { AuditTable } from "@/modules/auditoria/ui/AuditTable";
import { AuditFilters } from "@/modules/auditoria/ui/AuditFilters";
import type {
  AccionAuditoria,
  AuditoriaPagina,
  AuditoriaRegistro,
} from "@/modules/auditoria/domain/auditoria";

// next/link renders a plain anchor in the test host (no App Router context).
jest.mock("next/link", () => ({
  __esModule: true,
  default: ({
    href,
    children,
    ...rest
  }: {
    readonly href?: string;
    readonly children?: ReactNode;
  }) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const React = require("react");
    return React.createElement("a", { href: href ?? "#", ...rest }, children);
  },
}));

const push = jest.fn();
jest.mock("next/navigation", () => ({
  __esModule: true,
  useRouter: () => ({ push, replace: jest.fn(), refresh: jest.fn() }),
}));

function fila(
  over: Partial<AuditoriaRegistro> & { id: number },
): AuditoriaRegistro {
  return {
    empresaId: 1,
    sucursalId: 2,
    usuarioId: 10,
    fechaHora: new Date("2026-09-15T12:00:00.000Z"),
    accion: "CREAR" as AccionAuditoria,
    entidad: "Producto",
    idEntidad: "77",
    valorAnterior: null,
    valorNuevo: null,
    motivo: null,
    ...over,
  };
}

function pagina(over: Partial<AuditoriaPagina> = {}): AuditoriaPagina {
  return {
    filas: [],
    total: 0,
    page: 1,
    pageSize: 25,
    totalPages: 0,
    ...over,
  };
}

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => push.mockReset());
afterEach(cleanup);

describe("AuditTable (AC-2 newest-first + total, AC-5 read-only)", () => {
  it("renders the rows in the given order, shows the active-filter total, and exposes NO mutation control", () => {
    render(
      <AuditTable
        filtro={{}}
        pagina={pagina({
          filas: [fila({ id: 1 }), fila({ id: 2, accion: "PAGAR", usuarioId: 20 })],
          total: 2,
          page: 1,
          totalPages: 1,
        })}
      />,
    );

    expect(screen.getByTestId("auditoria-total")).toHaveTextContent("2");
    expect(screen.getByTestId("auditoria-fila-1")).toBeInTheDocument();
    expect(screen.getByTestId("auditoria-fila-2")).toBeInTheDocument();
    // The action surfaces as its Spanish label, the user as its id.
    expect(screen.getByTestId("auditoria-fila-1").textContent).toContain("Crear");
    expect(screen.getByTestId("auditoria-fila-2").textContent).toContain("Pagar");
    expect(screen.getByTestId("auditoria-fila-2").textContent).toContain("#20");

    // READ-ONLY (AC-5): the table is a server projection — NO buttons, NO form, NO
    // inputs at all. Navigation, when present, is only via links.
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(document.querySelector("form")).toBeNull();
    expect(screen.queryAllByRole("textbox")).toHaveLength(0);
  });

  it("renders the stored UTC instant in Santo-Domingo wall-clock (a UTC-midnight row shows the PRIOR SD day)", () => {
    // 2026-09-15T02:00:00Z = 2026-09-14 22:00 SD (UTC-4): the calendar DAY shifts back.
    render(
      <AuditTable
        filtro={{}}
        pagina={pagina({
          filas: [fila({ id: 5, fechaHora: new Date("2026-09-15T02:00:00.000Z") })],
          total: 1,
          page: 1,
          totalPages: 1,
        })}
      />,
    );
    const celda = screen.getByTestId("auditoria-fila-5").textContent ?? "";
    expect(celda).toContain("14/09/2026");
    expect(celda).not.toContain("15/09/2026");
  });

  it("shows the empty state while still reporting a total of 0 (no error, AC-2)", () => {
    render(<AuditTable filtro={{ texto: "nada" }} pagina={pagina({ total: 0 })} />);
    expect(screen.getByTestId("auditoria-total")).toHaveTextContent("0");
    expect(
      screen.getByText(/Sin movimientos que coincidan/i),
    ).toBeInTheDocument();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });
});

describe("AuditTable pagination (cobros-style, filters preserved)", () => {
  it("emits prev/next links that carry the active filters and only change `page`", () => {
    render(
      <AuditTable
        filtro={{ accion: "CREAR", sucursalId: 3, page: 2 }}
        pagina={pagina({ total: 60, page: 2, pageSize: 25, totalPages: 3 })}
      />,
    );
    expect(screen.getByText("Página 2 de 3")).toBeInTheDocument();
    const prev = screen.getByRole("link", { name: "Página anterior" });
    const next = screen.getByRole("link", { name: "Página siguiente" });
    // Filters are preserved; only `page` differs. Going back to page 1 DROPS the
    // param (the default), so prev carries no `page=` while next pins page 3.
    expect(prev.getAttribute("href")).toContain("accion=CREAR");
    expect(prev.getAttribute("href")).toContain("sucursalId=3");
    expect(prev.getAttribute("href")).not.toContain("page=");
    expect(next.getAttribute("href")).toContain("page=3");
  });

  it("renders no pagination controls on a single page", () => {
    render(
      <AuditTable
        filtro={{}}
        pagina={pagina({ filas: [fila({ id: 1 })], total: 1, page: 1, totalPages: 1 })}
      />,
    );
    expect(screen.queryByRole("link", { name: /página/i })).toBeNull();
  });
});

describe("AuditFilters (AC-3 combinable dispatch, submit disable while busy)", () => {
  it("dispatches the combined facets onto the URL and resets to page 1", async () => {
    render(<AuditFilters filtroInicial={{ accion: "CREAR" }} />);

    const accion = screen.getByLabelText("Acción") as HTMLSelectElement;
    expect(accion.value).toBe("CREAR"); // back-filled from the active filter
    fireEvent.change(screen.getByLabelText("Texto libre"), {
      target: { value: "arroz" },
    });
    fireEvent.change(screen.getByLabelText("Usuario"), {
      target: { value: "5" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Aplicar filtros" }));
    await settle();

    expect(push).toHaveBeenCalledTimes(1);
    const href = push.mock.calls[0][0] as string;
    expect(href).toContain("accion=CREAR");
    expect(href).toContain("texto=arroz");
    expect(href).toContain("usuarioId=5");
    // A filter change resets to the first page → no `page` param on page 1.
    expect(href).not.toContain("page=");
  });

  it("drops a blank or non-positive locator id from the dispatched query", async () => {
    render(<AuditFilters filtroInicial={{}} />);
    fireEvent.change(screen.getByLabelText("Sucursal"), {
      target: { value: "abc" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Aplicar filtros" }));
    await settle();
    const href = push.mock.calls[0][0] as string;
    expect(href).toBe("/auditoria"); // a malformed id is simply not applied
  });

  it("'Limpiar' clears the fields AND navigates to the base URL (never optimistic local-only)", async () => {
    render(<AuditFilters filtroInicial={{ usuarioId: 5 }} />);
    const usuario = screen.getByLabelText("Usuario") as HTMLInputElement;
    expect(usuario.value).toBe("5"); // back-filled from the active server filter

    fireEvent.click(screen.getByRole("button", { name: "Limpiar filtros" }));
    await settle();

    // The reset is a real navigation to the unfiltered server view — not just a local
    // clear that would leave the URL/table showing stale active filters.
    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith("/auditoria");
    expect((screen.getByLabelText("Usuario") as HTMLInputElement).value).toBe("");
  });

  it("disables submit while the navigation transition is pending (no stacked pushes)", async () => {
    // Hold the navigation promise open so `isPending` stays true and the guard is
    // observable — a synchronous mock push would resolve before the assertion.
    let soltar: () => void = () => {};
    push.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          soltar = resolve;
        }),
    );
    render(<AuditFilters filtroInicial={{}} />);
    const submit = screen.getByRole("button", { name: "Aplicar filtros" });
    expect(submit).toBeEnabled();
    fireEvent.click(submit);
    await settle();
    expect(submit).toBeDisabled();
    // Once navigation resolves the control is re-enabled (a re-query is allowed).
    await act(async () => {
      soltar();
    });
    await settle();
    expect(
      screen.getByRole("button", { name: "Aplicar filtros" }),
    ).toBeEnabled();
  });
});
