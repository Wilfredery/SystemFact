/**
 * @jest-environment jsdom
 *
 * Board 09 slice B — names in the table and select filters
 * (odd/tasks/uiux-board-09-auditoria-b.md S1, S3, S4, S6, S7a).
 */

import "@testing-library/jest-dom";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { AuditTable } from "@/modules/auditoria/ui/AuditTable";
import { AuditFilters } from "@/modules/auditoria/ui/AuditFilters";
import type {
  AuditoriaOpciones,
  AuditoriaPagina,
  AuditoriaRegistro,
} from "@/modules/auditoria/domain/auditoria";

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

function fila(over: Partial<AuditoriaRegistro> & { id: number }): AuditoriaRegistro {
  return {
    empresaId: 1,
    sucursalId: 2,
    usuarioId: 10,
    fechaHora: new Date("2026-09-15T12:00:00.000Z"),
    accion: "CREAR",
    entidad: "Producto",
    idEntidad: "77",
    valorAnterior: null,
    valorNuevo: null,
    motivo: null,
    usuario: null,
    sucursal: null,
    ...over,
  };
}

function pagina(filas: AuditoriaRegistro[]): AuditoriaPagina {
  return { filas, total: filas.length, page: 1, pageSize: 25, totalPages: 1 };
}

const OPC: AuditoriaOpciones = {
  usuarios: [
    { id: 5, nombreUsuario: "AB-ana", nombre: "Ana Pérez", activo: true },
    { id: 6, nombreUsuario: "AB-luis", nombre: "Luis Gil", activo: false },
  ],
  sucursales: [
    { id: 3, nombre: "Norte", activa: true },
    { id: 4, nombre: "Sur", activa: false },
  ],
};

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => push.mockReset());
afterEach(cleanup);

describe("S1 — names in the table", () => {
  it("shows nombreUsuario with the full nombre in the cell title, and the branch nombre", () => {
    render(
      <AuditTable
        filtro={{}}
        pagina={pagina([
          fila({
            id: 1,
            usuario: { nombreUsuario: "AB-ana", nombre: "Ana Pérez", activo: true },
            sucursal: { nombre: "Norte", activa: true },
          }),
        ])}
      />,
    );
    const celdas = within(screen.getByTestId("auditoria-fila-1")).getAllByRole("cell");
    expect(celdas[1]!.textContent).toBe("AB-ana");
    expect(celdas[1]!.querySelector("[title]")).toHaveAttribute("title", "Ana Pérez");
    expect(celdas[4]!.textContent).toBe("Norte");
  });

  it("falls back to #id when a name cannot be resolved, never blank", () => {
    render(
      <AuditTable
        filtro={{}}
        pagina={pagina([fila({ id: 1, usuarioId: 10, sucursalId: 2 })])}
      />,
    );
    const celdas = within(screen.getByTestId("auditoria-fila-1")).getAllByRole("cell");
    expect(celdas[1]!.textContent).toBe("#10");
    expect(celdas[4]!.textContent).toBe("#2");
  });

  it("keeps Empresa for a row without branch", () => {
    render(<AuditTable filtro={{}} pagina={pagina([fila({ id: 1, sucursalId: null })])} />);
    const celdas = within(screen.getByTestId("auditoria-fila-1")).getAllByRole("cell");
    expect(celdas[4]!.textContent).toBe("Empresa");
  });
});

describe("S3/S4 — select filters", () => {
  it("renders Usuario and Sucursal as labelled selects with Todos/Todas first and min-h-11", () => {
    render(<AuditFilters filtroInicial={{}} opciones={OPC} />);
    const usuario = screen.getByLabelText("Usuario");
    const sucursal = screen.getByLabelText("Sucursal");
    expect(usuario.tagName).toBe("SELECT");
    expect(sucursal.tagName).toBe("SELECT");
    expect(usuario.className).toContain("min-h-11");
    expect(sucursal.className).toContain("min-h-11");
    expect(within(usuario).getAllByRole("option")[0]).toHaveTextContent("Todos");
    expect(within(sucursal).getAllByRole("option")[0]).toHaveTextContent("Todas");
  });

  it("labels users as '<nombreUsuario> — <nombre>' and marks inactive users and branches", () => {
    render(<AuditFilters filtroInicial={{}} opciones={OPC} />);
    const usuarios = within(screen.getByLabelText("Usuario"))
      .getAllByRole("option")
      .map((o) => o.textContent);
    expect(usuarios).toEqual(["Todos", "AB-ana — Ana Pérez", "AB-luis — Luis Gil (inactivo)"]);
    const sucursales = within(screen.getByLabelText("Sucursal"))
      .getAllByRole("option")
      .map((o) => o.textContent);
    expect(sucursales).toEqual(["Todas", "Norte", "Sur (inactiva)"]);
  });

  it("preselects the active filter ids", () => {
    render(<AuditFilters filtroInicial={{ usuarioId: 6, sucursalId: 4 }} opciones={OPC} />);
    expect((screen.getByLabelText("Usuario") as HTMLSelectElement).value).toBe("6");
    expect((screen.getByLabelText("Sucursal") as HTMLSelectElement).value).toBe("4");
  });

  it("renders a stale/foreign URL id as a selected '#<id>' fallback option, without crashing", () => {
    render(<AuditFilters filtroInicial={{ usuarioId: 99, sucursalId: 98 }} opciones={OPC} />);
    const usuario = screen.getByLabelText("Usuario") as HTMLSelectElement;
    const sucursal = screen.getByLabelText("Sucursal") as HTMLSelectElement;
    expect(usuario.value).toBe("99");
    expect(usuario.selectedOptions[0]).toHaveTextContent("#99");
    expect(sucursal.value).toBe("98");
    expect(sucursal.selectedOptions[0]).toHaveTextContent("#98");
  });

  it("adds no fallback option when the id is in the list", () => {
    render(<AuditFilters filtroInicial={{ usuarioId: 5 }} opciones={OPC} />);
    expect(within(screen.getByLabelText("Usuario")).getAllByRole("option")).toHaveLength(3);
  });

  it("keeps the URL contract: usuarioId / sucursalId params, other filters preserved, no page", async () => {
    render(<AuditFilters filtroInicial={{ accion: "CREAR", texto: "x", page: 3 }} opciones={OPC} />);
    fireEvent.change(screen.getByLabelText("Usuario"), { target: { value: "5" } });
    fireEvent.change(screen.getByLabelText("Sucursal"), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "Aplicar filtros" }));
    await settle();
    const href = push.mock.calls[0]![0] as string;
    expect(href).toContain("usuarioId=5");
    expect(href).toContain("sucursalId=3");
    expect(href).toContain("accion=CREAR");
    expect(href).toContain("texto=x");
    expect(href).not.toContain("page=");
  });

  it("choosing Todos drops the param", async () => {
    render(<AuditFilters filtroInicial={{ usuarioId: 5 }} opciones={OPC} />);
    fireEvent.change(screen.getByLabelText("Usuario"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Aplicar filtros" }));
    await settle();
    expect(push.mock.calls[0]![0]).toBe("/auditoria");
  });

  it("pagination links keep usuarioId and sucursalId", () => {
    render(
      <AuditTable
        filtro={{ usuarioId: 5, sucursalId: 3, page: 2 }}
        pagina={{ filas: [], total: 60, page: 2, pageSize: 25, totalPages: 3 }}
      />,
    );
    const href = screen.getByRole("link", { name: "Página siguiente" }).getAttribute("href")!;
    expect(href).toContain("usuarioId=5");
    expect(href).toContain("sucursalId=3");
    expect(href).toContain("page=3");
  });
});
