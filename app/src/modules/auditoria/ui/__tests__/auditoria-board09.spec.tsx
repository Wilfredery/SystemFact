/**
 * @jest-environment jsdom
 *
 * Board 09 — Auditoría alignment (odd/tasks/uiux-board-09-auditoria.md).
 * S1 header, S2 footer note, S3 columns, S4 filters, S5 token guard, S6 touch/a11y.
 */

import "@testing-library/jest-dom";
import { readFileSync } from "node:fs";
import path from "node:path";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { AuditTable } from "@/modules/auditoria/ui/AuditTable";
import { AuditFilters } from "@/modules/auditoria/ui/AuditFilters";
import { detalleFila, tonoAccion } from "@/modules/auditoria/ui/format";
import type {
  AccionAuditoria,
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

jest.mock("next/navigation", () => ({
  __esModule: true,
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), refresh: jest.fn() }),
}));

function fila(over: Partial<AuditoriaRegistro> & { id: number }): AuditoriaRegistro {
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
    usuario: null,
    sucursal: null,
    ...over,
  };
}

const OPC: AuditoriaOpciones = {
  usuarios: [{ id: 5, nombreUsuario: "AB-ana", nombre: "Ana Pérez", activo: true }],
  sucursales: [{ id: 3, nombre: "Norte", activa: true }],
};

function pagina(over: Partial<AuditoriaPagina> = {}): AuditoriaPagina {
  return { filas: [], total: 0, page: 1, pageSize: 25, totalPages: 0, ...over };
}

afterEach(cleanup);

describe("Board 09 S3 — columns and Detalle", () => {
  it("renders the six headers in wireframe order, each with scope=col", () => {
    render(
      <AuditTable
        filtro={{}}
        pagina={pagina({ filas: [fila({ id: 1 })], total: 1, totalPages: 1 })}
      />,
    );
    const ths = screen.getAllByRole("columnheader");
    expect(ths.map((t) => t.textContent)).toEqual([
      "Fecha-Hora",
      "Usuario",
      "Acción",
      "Entidad",
      "Sucursal",
      "Detalle",
    ]);
    for (const th of ths) expect(th).toHaveAttribute("scope", "col");
  });

  it("shows the entity in its own column and keeps #usuarioId / #sucursalId", () => {
    render(
      <AuditTable
        filtro={{}}
        pagina={pagina({
          filas: [fila({ id: 1, entidad: "Producto", usuarioId: 10, sucursalId: 2 })],
          total: 1,
          totalPages: 1,
        })}
      />,
    );
    const celdas = within(screen.getByTestId("auditoria-fila-1")).getAllByRole("cell");
    expect(celdas).toHaveLength(6);
    expect(celdas[1].textContent).toBe("#10");
    expect(celdas[2].textContent).toBe("Crear");
    expect(celdas[3].textContent).toBe("Producto");
    expect(celdas[4].textContent).toBe("#2");
    expect(celdas[5].textContent).toBe("#77");
  });

  it("detalleFila no longer repeats the entity", () => {
    expect(detalleFila({ idEntidad: "77", motivo: null })).toBe("#77");
    expect(detalleFila({ idEntidad: "77", motivo: "ajuste" })).toBe(
      "#77 — ajuste",
    );
  });

  it("never renders the JSON payloads", () => {
    render(
      <AuditTable
        filtro={{}}
        pagina={pagina({
          filas: [fila({ id: 1, valorAnterior: '{"secreto":"AAA"}', valorNuevo: '{"secreto":"BBB"}' })],
          total: 1,
          totalPages: 1,
        })}
      />,
    );
    expect(document.body.textContent).not.toContain("AAA");
    expect(document.body.textContent).not.toContain("BBB");
  });
});

describe("Board 09 S2 — footer note", () => {
  it("shows the append-only note under the table", () => {
    render(
      <AuditTable
        filtro={{}}
        pagina={pagina({ filas: [fila({ id: 1 })], total: 1, totalPages: 1 })}
      />,
    );
    expect(
      screen.getByText("Registro de auditoría — Solo lectura · Inmutable (append-only)"),
    ).toBeInTheDocument();
  });
});

describe("Board 09 S4/S6 — filters", () => {
  it("uses the new free-text placeholder", () => {
    render(<AuditFilters filtroInicial={{}} opciones={OPC} />);
    expect(screen.getByLabelText("Texto libre")).toHaveAttribute(
      "placeholder",
      "Buscar en auditoría (texto libre)...",
    );
  });

  it("primary / outline recipes with min-h-11 on every control", () => {
    render(<AuditFilters filtroInicial={{}} opciones={OPC} />);
    const aplicar = screen.getByRole("button", { name: "Aplicar filtros" });
    expect(aplicar.className).toContain("bg-accent");
    expect(aplicar.className).toContain("text-accent-fg");
    const limpiar = screen.getByRole("button", { name: "Limpiar filtros" });
    expect(limpiar.className).toContain("border-line");
    expect(limpiar.className).not.toContain("bg-accent");
    for (const el of [
      aplicar,
      limpiar,
      screen.getByLabelText("Acción"),
      screen.getByLabelText("Usuario"),
      screen.getByLabelText("Sucursal"),
      screen.getByLabelText("Desde"),
      screen.getByLabelText("Hasta"),
      screen.getByLabelText("Texto libre"),
    ]) {
      expect(el.className).toContain("min-h-11");
    }
  });

  it("accessible names equal the visible labels (no overriding aria-label)", () => {
    render(<AuditFilters filtroInicial={{}} opciones={OPC} />);
    expect(screen.getByLabelText("Desde")).toHaveAccessibleName("Desde");
    expect(screen.getByLabelText("Hasta")).toHaveAccessibleName("Hasta");
    expect(screen.queryByLabelText("Fecha desde")).toBeNull();
    expect(screen.queryByLabelText("Fecha hasta")).toBeNull();
    for (const el of document.querySelectorAll("input, select")) {
      expect(el.getAttribute("aria-label")).toBeNull();
    }
  });
});

describe("Board 09 S6 — pagination touch targets", () => {
  it("links and disabled spans have min-h-11", () => {
    render(
      <AuditTable
        filtro={{}}
        pagina={pagina({ filas: [fila({ id: 1 })], total: 60, page: 2, totalPages: 3 })}
      />,
    );
    expect(screen.getByRole("link", { name: "Página anterior" }).className).toContain("min-h-11");
    expect(screen.getByRole("link", { name: "Página siguiente" }).className).toContain("min-h-11");
  });
});

describe("Board 09 S5 — tokens", () => {
  it("tonoAccion maps to F0 tokens", () => {
    expect(tonoAccion("ANULAR")).toContain("text-danger");
    expect(tonoAccion("CREAR")).toContain("text-success-fg");
    expect(tonoAccion("AJUSTAR")).toContain("text-warn");
  });

  const RAIZ = path.join(__dirname, "..");
  const FILES = [
    "AuditFilters.tsx",
    "AuditTable.tsx",
    "format.ts",
    path.join(RAIZ, "../../../app/(app)/auditoria/page.tsx"),
  ];
  const RAW_PALETTE =
    /(?:text|bg|border|ring|divide|from|to|placeholder|fill|stroke|shadow|outline|accent|caret|decoration)-(?:zinc|red|emerald|amber|indigo|gray|slate|neutral|stone|white|black|blue|green|sky|orange|violet|purple|yellow|rose|teal|cyan|lime|pink|fuchsia)-?[^\s"'`]*/g;
  const ARBITRARY_COLOR = /(?:text|bg|border|ring)-\[(?:#|rgb|hsl|oklch)[^\]]+\]/g;
  const leer = (a: string): string =>
    readFileSync(path.isAbsolute(a) ? a : path.join(RAIZ, a), "utf8");

  it("keeps zero raw-palette classes in the Auditoría files", () => {
    const ofensas = FILES.flatMap((a) => {
      const f = leer(a);
      return [...(f.match(RAW_PALETTE) ?? []), ...(f.match(ARBITRARY_COLOR) ?? [])].map(
        (c) => `${a}: ${c}`,
      );
    });
    expect(ofensas).toEqual([]);
  });

  it("keeps no dark: variants in those files", () => {
    expect(FILES.filter((a) => /\bdark:/.test(leer(a)))).toEqual([]);
  });
});
