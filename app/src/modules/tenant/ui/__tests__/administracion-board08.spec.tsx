/**
 * @jest-environment jsdom
 *
 * Board 08 — Administración alignment (odd/tasks/uiux-board-08-admin.md).
 * S1 tabs, S2 Empresas read-only, S3 Roles read-only, S4 Roles column,
 * S5 branch search, S7 F0 token guard, S8 tab semantics.
 */

import "@testing-library/jest-dom";
import { readFileSync } from "node:fs";
import path from "node:path";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import {
  AdministracionScreen,
  type RolesInicial,
  type SucursalesInicial,
  type UsuariosInicial,
} from "../AdministracionScreen";
import {
  TAB_ADMINISTRACION_DEFAULT,
  TABS_ADMINISTRACION,
  tabDesdeParam,
  type TabAdministracion,
} from "../administracion-tabs";

const push = jest.fn(async () => undefined);
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

jest.mock("@/modules/tenant/http/actions.usuarios", () => ({
  cambiarRolesUsuarioAction: jest.fn(),
  cambiarEstadoUsuarioAction: jest.fn(),
  moverUsuarioDeSucursalAction: jest.fn(),
}));

jest.mock("@/modules/tenant/http/actions.sucursal", () => ({
  crearSucursalAction: jest.fn(),
  editarSucursalAction: jest.fn(),
  activarSucursalAction: jest.fn(),
  desactivarSucursalAction: jest.fn(),
}));

jest.mock("@/modules/tenant/http/actions.administracion", () => ({
  listarUsuariosAction: jest.fn(),
  listarSucursalesDeEmpresaAction: jest.fn(),
  listarSucursalesAdministracionAction: jest.fn(),
  consultarConfiguracionAction: jest.fn(),
  obtenerPermisosAdministracionAction: jest.fn(),
}));

jest.mock("@/modules/tenant/http/actions.configuracion", () => ({
  editarTasasItbisAction: jest.fn(),
}));

const SUCURSALES: SucursalesInicial = {
  ok: true,
  data: [
    { id: 1, nombre: "Sucursal Central", direccion: "Calle Primera 1", telefono: "809-555-0001", activa: true, version: 1 },
    { id: 2, nombre: "Sucursal Norte", direccion: "Avenida Máximo Gómez 20", telefono: "809-555-0002", activa: true, version: 1 },
    { id: 3, nombre: "Sucursal Cerrada", direccion: "Calle Vieja 3", telefono: "809-555-0003", activa: false, version: 1 },
  ],
};

const ROLES: RolesInicial = {
  ok: true,
  data: [
    { id: 1, nombre: "Administrador" },
    { id: 2, nombre: "Operador" },
  ],
};

function montar(
  props: Partial<{
    tab: TabAdministracion;
    sucursales: SucursalesInicial | null;
    usuarios: UsuariosInicial | null;
    roles: RolesInicial | null;
    puedeGestionar: boolean;
  }> = {},
) {
  return render(
    <AdministracionScreen
      tab={props.tab ?? "empresas"}
      filtrosIniciales={{ busqueda: "", activo: "" }}
      usuarios={props.usuarios ?? null}
      sucursales={props.sucursales === undefined ? SUCURSALES : props.sucursales}
      configuracion={null}
      roles={props.roles === undefined ? null : props.roles}
      empresaNombre="Empresa Demo"
      puedeGestionar={props.puedeGestionar ?? true}
      sesionUsuarioId={1}
      sesionSucursalId={1}
    />,
  );
}

beforeEach(() => {
  push.mockClear();
});
afterEach(cleanup);

describe("Board 08 — tabs (S1, S8)", () => {
  it("lists Empresas, Sucursales, Usuarios, Roles, Configuración in board order, default Empresas", () => {
    expect(TABS_ADMINISTRACION.map((t) => t.etiqueta)).toEqual([
      "Empresas",
      "Sucursales",
      "Usuarios",
      "Roles",
      "Configuración",
    ]);
    expect(TAB_ADMINISTRACION_DEFAULT).toBe("empresas");
    expect(tabDesdeParam("bogus")).toBe("empresas");
    expect(tabDesdeParam("")).toBe("empresas");
    expect(tabDesdeParam("usuarios")).toBe("usuarios");
  });

  it("renders the tabs in that order with tablist/tab semantics and one selected tab", () => {
    montar();

    const tabs = within(screen.getByRole("tablist", { name: "Secciones de Administración" })).getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual([
      "Empresas",
      "Sucursales",
      "Usuarios",
      "Roles",
      "Configuración",
    ]);
    expect(tabs.map((t) => t.getAttribute("aria-selected"))).toEqual(["true", "false", "false", "false", "false"]);
  });

  it("links each tab to its panel: id + aria-controls, panel labelled by the selected tab (S8)", () => {
    montar({ tab: "roles", roles: ROLES });

    const tabs = screen.getAllByRole("tab");
    for (const t of tabs) {
      expect(t.id).toMatch(/^tab-/);
      expect(t.getAttribute("aria-controls")).toBe(t.id.replace("tab-", "panel-"));
    }
    const panel = screen.getByRole("tabpanel");
    expect(panel).toHaveAttribute("id", "panel-roles");
    expect(panel).toHaveAttribute("aria-labelledby", "tab-roles");
    expect(screen.getByRole("tab", { name: "Roles" })).toHaveAttribute("aria-controls", panel.id);
  });

  it("keeps min-h-11 touch targets on every tab", () => {
    montar();
    for (const t of screen.getAllByRole("tab")) expect(t.className).toContain("min-h-11");
  });

  it("navigates by URL when another tab is clicked", () => {
    montar();
    fireEvent.click(screen.getByRole("tab", { name: "Roles" }));
    expect(push).toHaveBeenCalledWith("/administracion?tab=roles");
  });
});

describe("Board 08 — Empresas tab (S2)", () => {
  it("shows the company name, its ACTIVE branches and Activo", () => {
    montar();

    const fila = screen.getByTestId("empresa-fila");
    expect(within(fila).getByText("Empresa Demo")).toBeInTheDocument();
    expect(fila).toHaveTextContent("Sucursal Central, Sucursal Norte");
    expect(fila).not.toHaveTextContent("Sucursal Cerrada");
    expect(within(fila).getByText("Activo")).toBeInTheDocument();
  });

  it("is read-only: no Editar, Eliminar, Desactivar, Nueva empresa controls (even for the Administrador)", () => {
    montar({ puedeGestionar: true });

    expect(screen.queryByRole("button", { name: /Editar/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Eliminar/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Desactivar/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Nueva empresa/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/Nueva empresa/)).not.toBeInTheDocument();
    // The five tabs carry role=tab, so no element has role=button at all.
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("shows an alert when the read failed", () => {
    montar({ sucursales: { ok: false, message: "No se pudieron cargar." } });
    expect(screen.getByRole("alert")).toHaveTextContent("No se pudieron cargar.");
  });
});

describe("Board 08 — Roles tab (S3)", () => {
  it("renders the role catalog and no write controls", () => {
    montar({ tab: "roles", roles: ROLES });

    expect(screen.getByTestId("rol-fila-1")).toHaveTextContent("Administrador");
    expect(screen.getByTestId("rol-fila-2")).toHaveTextContent("Operador");
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("shows an alert when the catalog failed to load", () => {
    montar({ tab: "roles", roles: { ok: false, message: "No autorizado." } });
    expect(screen.getByRole("alert")).toHaveTextContent("No autorizado.");
  });
});

describe("Board 08 — Usuarios Roles column (S4)", () => {
  it("names the column Roles and joins every role with ' · '", () => {
    const usuarios: UsuariosInicial = {
      ok: true,
      data: {
        items: [
          {
            id: 10,
            nombreUsuario: "aperez",
            nombre: "Ana Pérez",
            activo: true,
            version: 1,
            sucursalNombre: "Sucursal Central",
            sucursalId: 1,
            esDeOtraSucursal: false,
            empresaNombre: "Empresa Demo",
            roles: ["Operador", "Despachador"],
            rolIds: [2, 3],
          },
        ],
        total: 1,
        page: 1,
        pageSize: 25,
        rolesCatalogo: [
          { id: 2, nombre: "Operador" },
          { id: 3, nombre: "Despachador" },
        ],
      },
    };
    montar({ tab: "usuarios", usuarios, puedeGestionar: false });

    expect(screen.getByRole("columnheader", { name: "Roles" })).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Rol" })).not.toBeInTheDocument();
    expect(within(screen.getByTestId("usuario-fila-10")).getByText("Operador · Despachador")).toBeInTheDocument();
  });
});

describe("Board 08 — Sucursales search (S5)", () => {
  function filas(): string[] {
    return screen.queryAllByTestId(/^sucursal-fila-/).map((f) => f.getAttribute("data-testid") ?? "");
  }

  it("shows every branch until something is typed", () => {
    montar({ tab: "sucursales" });
    expect(screen.getByPlaceholderText("Buscar sucursal...")).toBeInTheDocument();
    expect(filas()).toEqual(["sucursal-fila-1", "sucursal-fila-2", "sucursal-fila-3"]);
  });

  it("filters by nombre, case-insensitively", () => {
    montar({ tab: "sucursales" });
    fireEvent.change(screen.getByLabelText("Buscar sucursal"), { target: { value: "NORTE" } });
    expect(filas()).toEqual(["sucursal-fila-2"]);
  });

  it("filters by dirección, accent-insensitively", () => {
    montar({ tab: "sucursales" });
    fireEvent.change(screen.getByLabelText("Buscar sucursal"), { target: { value: "maximo gomez" } });
    expect(filas()).toEqual(["sucursal-fila-2"]);
    fireEvent.change(screen.getByLabelText("Buscar sucursal"), { target: { value: "máximo" } });
    expect(filas()).toEqual(["sucursal-fila-2"]);
  });

  it("shows an empty state when nothing matches and recovers when cleared", () => {
    montar({ tab: "sucursales" });
    fireEvent.change(screen.getByLabelText("Buscar sucursal"), { target: { value: "zzz" } });
    expect(filas()).toEqual([]);
    expect(screen.getByText("No hay sucursales que coincidan con la búsqueda.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Buscar sucursal"), { target: { value: "" } });
    expect(filas()).toHaveLength(3);
  });

  it("keeps the writer controls (Nueva sucursal, Editar, Desactivar) with the search box", () => {
    montar({ tab: "sucursales", puedeGestionar: true });
    expect(screen.getByRole("button", { name: "Nueva sucursal" })).toBeInTheDocument();
    expect(within(screen.getByTestId("sucursal-fila-2")).getByRole("button", { name: "Editar" })).toBeEnabled();
    expect(within(screen.getByTestId("sucursal-fila-2")).getByRole("button", { name: "Desactivar" })).toBeEnabled();
  });
});

describe("Board 08 — F0 token retrofit (S7)", () => {
  const RAIZ = path.join(__dirname, "..");
  const FILES = [
    "AdministracionScreen.tsx",
    "GestionUsuarioDialogs.tsx",
    "GestionSucursalDialog.tsx",
    "EditarTasasItbisCard.tsx",
    path.join(RAIZ, "../../../app/(app)/administracion/page.tsx"),
  ];
  const RAW_PALETTE =
    /(?:text|bg|border|ring|divide|from|to|placeholder|fill|stroke|shadow|outline|accent|caret|decoration)-(?:zinc|red|emerald|amber|indigo|gray|slate|neutral|stone|white|black|blue|green|sky|orange|violet|purple|yellow|rose|teal|cyan|lime|pink|fuchsia)-?[^\s"'`]*/g;
  const ARBITRARY_COLOR = /(?:text|bg|border|ring)-\[(?:#|rgb|hsl|oklch)[^\]]+\]/g;

  it("keeps zero raw-palette classes in the Administración files this board covers", () => {
    const ofensas = FILES.flatMap((archivo) => {
      const fuente = readFileSync(path.isAbsolute(archivo) ? archivo : path.join(RAIZ, archivo), "utf8");
      const coincidencias = [...(fuente.match(RAW_PALETTE) ?? []), ...(fuente.match(ARBITRARY_COLOR) ?? [])];
      return coincidencias.map((c) => `${archivo}: ${c}`);
    });
    expect(ofensas).toEqual([]);
  });

  it("keeps no dark: variants in those files", () => {
    const ofensas = FILES.filter((archivo) =>
      /\bdark:/.test(readFileSync(path.isAbsolute(archivo) ? archivo : path.join(RAIZ, archivo), "utf8")),
    );
    expect(ofensas).toEqual([]);
  });
});
