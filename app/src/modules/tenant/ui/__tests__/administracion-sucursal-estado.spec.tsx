/**
 * @jest-environment jsdom
 *
 * Administración — Desactivar / Activar a branch
 * (odd/tasks/administracion-sucursales-activar.md T2: S7 read side, S8, S9 RTL).
 * The two write actions and both branch lists are mocked at the HTTP boundary.
 *
 * The Sucursales tab reads ALL branches (`listarSucursalesAdministracionAction`);
 * the "Mover de sucursal" dialog keeps the active-only read
 * (`listarSucursalesDeEmpresaAction`).
 */

import "@testing-library/jest-dom";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { AdministracionScreen, type SucursalesInicial } from "../AdministracionScreen";
import {
  listarSucursalesAdministracionAction,
  listarSucursalesDeEmpresaAction,
  listarUsuariosAction,
} from "@/modules/tenant/http/actions.administracion";
import {
  activarSucursalAction,
  desactivarSucursalAction,
} from "@/modules/tenant/http/actions.sucursal";
import { messageFor } from "@/modules/tenant/domain/errors";
import type { ListarUsuariosAdministracion, SucursalGestionDto } from "@/modules/tenant/http/shared";
import { MENSAJE_FALLO_ACCION } from "../administracion-tabs";

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(async () => undefined) }),
}));

jest.mock("@/modules/tenant/http/actions.administracion", () => ({
  listarUsuariosAction: jest.fn(),
  listarSucursalesDeEmpresaAction: jest.fn(),
  listarSucursalesAdministracionAction: jest.fn(),
  consultarConfiguracionAction: jest.fn(),
  obtenerPermisosAdministracionAction: jest.fn(),
}));

jest.mock("@/modules/tenant/http/actions.sucursal", () => ({
  crearSucursalAction: jest.fn(),
  editarSucursalAction: jest.fn(),
  desactivarSucursalAction: jest.fn(),
  activarSucursalAction: jest.fn(),
}));

jest.mock("@/modules/tenant/http/actions.usuarios", () => ({
  cambiarRolesUsuarioAction: jest.fn(),
  cambiarEstadoUsuarioAction: jest.fn(),
  moverUsuarioDeSucursalAction: jest.fn(),
}));

// The new config write action (feature itbis-tasas-edit) is mocked at the
// HTTP boundary like the other write actions; its real module graph pulls
// the server-only Prisma client that jsdom cannot load.
jest.mock("@/modules/tenant/http/actions.configuracion", () => ({
  editarTasasItbisAction: jest.fn(),
}));

const mockTodas = jest.mocked(listarSucursalesAdministracionAction);
const mockActivas = jest.mocked(listarSucursalesDeEmpresaAction);
const mockUsuarios = jest.mocked(listarUsuariosAction);
const mockDesactivar = jest.mocked(desactivarSucursalAction);
const mockActivar = jest.mocked(activarSucursalAction);

type ResultadoEstado = Awaited<ReturnType<typeof desactivarSucursalAction>>;

const CENTRAL: SucursalGestionDto = {
  id: 1,
  nombre: "Sucursal Central",
  direccion: "Calle 1",
  telefono: "809-555-0001",
  activa: true,
  version: 1,
};
const NORTE: SucursalGestionDto = {
  id: 2,
  nombre: "Sucursal Norte",
  direccion: "Calle 2",
  telefono: "809-555-0002",
  activa: true,
  version: 4,
};
const SUR_INACTIVA: SucursalGestionDto = {
  id: 3,
  nombre: "Sucursal Sur",
  direccion: "Calle 3",
  telefono: "809-555-0003",
  activa: false,
  version: 7,
};

const SESION_SUCURSAL_ID = 1;

function resultadoOk(s: SucursalGestionDto, activa: boolean, cambio = true): ResultadoEstado {
  return {
    ok: true,
    data: { sucursalId: s.id, activa, version: s.version + 1, cambio },
  };
}

function montar({
  puedeGestionar = true,
  sucursales = [CENTRAL, NORTE, SUR_INACTIVA],
}: { puedeGestionar?: boolean; sucursales?: SucursalGestionDto[] } = {}) {
  const inicial: SucursalesInicial = { ok: true, data: sucursales };
  return render(
    <AdministracionScreen
      tab="sucursales"
      filtrosIniciales={{ busqueda: "", activo: "" }}
      usuarios={null}
      sucursales={inicial}
      configuracion={null}
      puedeGestionar={puedeGestionar}
      sesionUsuarioId={99}
      sesionSucursalId={SESION_SUCURSAL_ID}

      roles={null}

      empresaNombre="Empresa Demo"
    />,
  );
}

const fila = (id: number) => screen.getByTestId(`sucursal-fila-${id}`);

async function abrirEstado(id: number, nombre: "Desactivar" | "Activar"): Promise<HTMLElement> {
  await act(async () => {
    fireEvent.click(within(fila(id)).getByRole("button", { name: nombre }));
  });
  return screen.getByRole("dialog", { name: `${nombre} sucursal` });
}

async function confirmar(dialogo: HTMLElement, nombre: "Desactivar" | "Activar") {
  await act(async () => {
    fireEvent.click(within(dialogo).getByRole("button", { name: nombre }));
  });
}

beforeEach(() => {
  jest.resetAllMocks();
  mockTodas.mockResolvedValue({ ok: true, data: [CENTRAL, NORTE, SUR_INACTIVA] });
  mockActivas.mockResolvedValue({ ok: true, data: [CENTRAL, NORTE] });
});

afterEach(cleanup);

describe("Sucursales table: estado and actions (S7, S8)", () => {
  it("shows the badge from `activa`: Activa / Inactiva", () => {
    montar();

    expect(within(fila(1)).getByText("Activa")).toBeInTheDocument();
    expect(within(fila(2)).getByText("Activa")).toBeInTheDocument();
    expect(within(fila(3)).getByText("Inactiva")).toBeInTheDocument();
    expect(within(fila(3)).queryByText("Activa")).not.toBeInTheDocument();
  });

  it("per row: Desactivar for active, Activar for inactive, and Editar stays on every row", () => {
    montar();

    expect(within(fila(2)).getByRole("button", { name: "Desactivar" })).toBeEnabled();
    expect(within(fila(2)).queryByRole("button", { name: "Activar" })).not.toBeInTheDocument();
    expect(within(fila(3)).getByRole("button", { name: "Activar" })).toBeEnabled();
    expect(within(fila(3)).queryByRole("button", { name: "Desactivar" })).not.toBeInTheDocument();
    for (const id of [1, 2, 3]) {
      expect(within(fila(id)).getByRole("button", { name: "Editar" })).toBeEnabled();
    }
  });

  it("renders no Desactivar/Activar when the caller cannot manage, but still shows the badges", () => {
    montar({ puedeGestionar: false });

    expect(screen.queryByRole("button", { name: /^(Desactivar|Activar)$/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Acciones" })).not.toBeInTheDocument();
    expect(within(fila(3)).getByText("Inactiva")).toBeInTheDocument();
  });

  it("disables Desactivar on the session's own branch with an explanatory title", () => {
    montar();

    const propio = within(fila(SESION_SUCURSAL_ID)).getByRole("button", { name: "Desactivar" });
    expect(propio).toBeDisabled();
    expect(propio).toHaveAttribute("title", expect.stringMatching(/en la que está trabajando/));
    expect(within(fila(2)).getByRole("button", { name: "Desactivar" })).not.toHaveAttribute("title");
  });
});

describe("Desactivar confirmation (S8)", () => {
  it("names the branch and the effect, and sends nothing until confirmed", async () => {
    montar();
    const dialogo = await abrirEstado(2, "Desactivar");

    expect(within(dialogo).getAllByText(/Sucursal Norte/).length).toBeGreaterThan(0);
    expect(within(dialogo).getByText(/Se desactivará la sucursal Sucursal Norte/)).toBeInTheDocument();
    expect(mockDesactivar).not.toHaveBeenCalled();

    fireEvent.click(within(dialogo).getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(mockDesactivar).not.toHaveBeenCalled();
  });

  it("confirm calls desactivarSucursalAction with sucursalId and the row's version", async () => {
    mockDesactivar.mockResolvedValue(resultadoOk(NORTE, false));
    montar();
    const dialogo = await abrirEstado(2, "Desactivar");

    await confirmar(dialogo, "Desactivar");

    expect(mockDesactivar).toHaveBeenCalledTimes(1);
    expect(mockDesactivar).toHaveBeenCalledWith({ sucursalId: 2, versionEsperada: 4 });
    expect(mockActivar).not.toHaveBeenCalled();
  });

  it("on ok: re-reads through the ALL-branches action and shows the new state only after", async () => {
    let resolver: (v: ResultadoEstado) => void = () => {};
    mockDesactivar.mockImplementationOnce(() => new Promise<ResultadoEstado>((r) => (resolver = r)));
    mockTodas.mockResolvedValue({
      ok: true,
      data: [CENTRAL, { ...NORTE, activa: false, version: 5 }, SUR_INACTIVA],
    });
    montar();
    const dialogo = await abrirEstado(2, "Desactivar");

    await confirmar(dialogo, "Desactivar");

    // Pending: nothing is shown as changed and nothing was re-read yet.
    expect(within(fila(2)).getByText("Activa")).toBeInTheDocument();
    expect(mockTodas).not.toHaveBeenCalled();

    await act(async () => {
      resolver(resultadoOk(NORTE, false));
    });

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(mockTodas).toHaveBeenCalledTimes(1);
    expect(mockActivas).not.toHaveBeenCalled();
    expect(within(fila(2)).getByText("Inactiva")).toBeInTheDocument();
    expect(within(fila(2)).getByRole("button", { name: "Activar" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Sucursal Sucursal Norte desactivada.");
  });

  it("while pending: confirm and Cancelar are disabled and the action is sent once", async () => {
    mockDesactivar.mockImplementationOnce(() => new Promise<ResultadoEstado>(() => {}));
    montar();
    const dialogo = await abrirEstado(2, "Desactivar");

    await confirmar(dialogo, "Desactivar");

    expect(within(dialogo).getByRole("button", { name: "Desactivar" })).toBeDisabled();
    expect(within(dialogo).getByRole("button", { name: "Cancelar" })).toBeDisabled();
    fireEvent.click(within(dialogo).getByRole("button", { name: "Desactivar" }));
    expect(mockDesactivar).toHaveBeenCalledTimes(1);
  });

  it("a blocked response renders ONE message with every blocker and its count, and keeps the dialog open", async () => {
    mockDesactivar.mockResolvedValue({
      ok: false,
      error: {
        code: "TEN_SUCURSAL_CON_USUARIOS",
        message: "servidor",
        detalle: {
          usuarios: 3,
          stock: 12,
          documentosAbiertos: 1,
          saldos: 2,
          codigos: [
            "TEN_SUCURSAL_CON_USUARIOS",
            "TEN_SUCURSAL_CON_STOCK",
            "TEN_SUCURSAL_CON_DOCUMENTOS_ABIERTOS",
            "TEN_SUCURSAL_CON_SALDOS_PENDIENTES",
          ],
        },
      },
    });
    montar();
    const dialogo = await abrirEstado(2, "Desactivar");

    await confirmar(dialogo, "Desactivar");

    expect(within(screen.getByRole("dialog")).getByRole("alert")).toHaveTextContent(
      "No se puede desactivar: 3 usuarios activos, 12 productos con existencias, 1 documento abierto, 2 facturas con saldo pendiente.",
    );
    // A refusal is not a conflict: no re-read, no retry, the person can cancel.
    expect(mockTodas).not.toHaveBeenCalled();
    expect(mockDesactivar).toHaveBeenCalledTimes(1);
    expect(within(fila(2)).getByText("Activa")).toBeInTheDocument();
  });

  it.each([
    ["TEN_SUCURSAL_PROPIA_NO_DESACTIVABLE"],
    ["TEN_SUCURSAL_ULTIMA_ACTIVA"],
    ["TEN_SUCURSAL_NO_VALIDA"],
    ["TEN_OPS_NO_AUTORIZADO"],
  ] as const)("a %s refusal shows its catalog message", async (codigo) => {
    mockDesactivar.mockResolvedValue({
      ok: false,
      error: {
        code: codigo,
        message: "servidor",
        ...(codigo === "TEN_SUCURSAL_PROPIA_NO_DESACTIVABLE" || codigo === "TEN_SUCURSAL_ULTIMA_ACTIVA"
          ? { detalle: { usuarios: 0, stock: 0, documentosAbiertos: 0, saldos: 0, codigos: [codigo] } }
          : {}),
      },
    });
    montar();
    const dialogo = await abrirEstado(2, "Desactivar");

    await confirmar(dialogo, "Desactivar");

    expect(within(screen.getByRole("dialog")).getByRole("alert")).toHaveTextContent(messageFor(codigo));
  });

  it("a conflict shows the message, reloads the list through the all-branches action and never retries", async () => {
    mockDesactivar.mockResolvedValueOnce({
      ok: false,
      error: { code: "TEN_CONCURRENCIA_CONFLICTO", message: "x" },
    });
    mockTodas.mockResolvedValue({ ok: true, data: [CENTRAL, { ...NORTE, version: 5 }, SUR_INACTIVA] });
    montar();
    const dialogo = await abrirEstado(2, "Desactivar");

    await confirmar(dialogo, "Desactivar");

    expect(within(screen.getByRole("dialog")).getByRole("alert")).toHaveTextContent(
      messageFor("TEN_CONCURRENCIA_CONFLICTO"),
    );
    expect(mockTodas).toHaveBeenCalledTimes(1);
    expect(mockDesactivar).toHaveBeenCalledTimes(1);

    // The person retries by hand: the new attempt carries the reloaded version.
    mockDesactivar.mockResolvedValueOnce(resultadoOk(NORTE, false));
    await confirmar(screen.getByRole("dialog"), "Desactivar");
    expect(mockDesactivar).toHaveBeenCalledTimes(2);
    expect(mockDesactivar).toHaveBeenLastCalledWith({ sucursalId: 2, versionEsperada: 5 });
  });

  it("shows the generic message and keeps the dialog open when the action throws", async () => {
    mockDesactivar.mockRejectedValue(new Error("network"));
    montar();
    const dialogo = await abrirEstado(2, "Desactivar");

    await confirmar(dialogo, "Desactivar");

    expect(within(screen.getByRole("dialog")).getByRole("alert")).toHaveTextContent(MENSAJE_FALLO_ACCION);
    expect(mockTodas).not.toHaveBeenCalled();
  });
});

describe("Activar confirmation (S8)", () => {
  it("confirm calls activarSucursalAction with sucursalId and the row's version, then shows Activa after the re-read", async () => {
    mockActivar.mockResolvedValue(resultadoOk(SUR_INACTIVA, true));
    mockTodas.mockResolvedValue({
      ok: true,
      data: [CENTRAL, NORTE, { ...SUR_INACTIVA, activa: true, version: 8 }],
    });
    montar();
    const dialogo = await abrirEstado(3, "Activar");

    expect(within(dialogo).getByText(/Se activará la sucursal Sucursal Sur/)).toBeInTheDocument();
    await confirmar(dialogo, "Activar");

    expect(mockActivar).toHaveBeenCalledWith({ sucursalId: 3, versionEsperada: 7 });
    expect(mockDesactivar).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(mockTodas).toHaveBeenCalledTimes(1);
    expect(within(fila(3)).getByText("Activa")).toBeInTheDocument();
    expect(within(fila(3)).getByRole("button", { name: "Desactivar" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Sucursal Sucursal Sur activada.");
  });

  it("an idempotent no-op answer says nothing changed", async () => {
    mockActivar.mockResolvedValue(resultadoOk(SUR_INACTIVA, true, false));
    montar();
    const dialogo = await abrirEstado(3, "Activar");

    await confirmar(dialogo, "Activar");

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("No había cambios que guardar."));
  });
});

describe("the all-branches list feeds the tab; the move dialog stays active-only (S7)", () => {
  it("the Mover de sucursal dialog lists only the active branches even though the tab shows an inactive one", async () => {
    const usuarios: ListarUsuariosAdministracion = {
      items: [
        {
          id: 11,
          nombreUsuario: "jperez",
          nombre: "Juan Pérez",
          activo: true,
          version: 5,
          sucursalNombre: "Sucursal Central",
          sucursalId: 1,
          esDeOtraSucursal: false,
          empresaNombre: "Empresa Demo",
          roles: ["Operador"],
          rolIds: [2],
        },
      ],
      total: 1,
      page: 1,
      pageSize: 25,
      rolesCatalogo: [{ id: 2, nombre: "Operador" }],
    };
    mockUsuarios.mockResolvedValue({ ok: true, data: usuarios });
    render(
      <AdministracionScreen
        tab="usuarios"
        filtrosIniciales={{ busqueda: "", activo: "" }}
        usuarios={{ ok: true, data: usuarios }}
        sucursales={null}
        configuracion={null}
        puedeGestionar
        sesionUsuarioId={99}
        sesionSucursalId={SESION_SUCURSAL_ID}

        roles={null}

        empresaNombre="Empresa Demo"
      />,
    );

    await act(async () => {
      fireEvent.click(
        within(screen.getByTestId("usuario-fila-11")).getByRole("button", { name: "Mover de sucursal" }),
      );
    });
    const dialogo = screen.getByRole("dialog");
    const select = await within(dialogo).findByRole("combobox", { name: "Sucursal destino" });

    expect(within(select).getByRole("option", { name: "Sucursal Norte" })).toBeInTheDocument();
    expect(within(select).queryByRole("option", { name: "Sucursal Sur" })).not.toBeInTheDocument();
    expect(mockActivas).toHaveBeenCalledTimes(1);
    expect(mockTodas).not.toHaveBeenCalled();
  });

  it("a tab switch with a mounted screen shows the branches, inactive ones included", () => {
    const props = {
      filtrosIniciales: { busqueda: "", activo: "" as const },
      usuarios: null,
      configuracion: null,
      puedeGestionar: true,
      sesionUsuarioId: 99,
      sesionSucursalId: SESION_SUCURSAL_ID,

      roles: null,

      empresaNombre: "Empresa Demo",
    };
    const { rerender } = render(<AdministracionScreen tab="usuarios" sucursales={null} {...props} />);

    rerender(
      <AdministracionScreen
        tab="sucursales"
        sucursales={{ ok: true, data: [CENTRAL, NORTE, SUR_INACTIVA] }}
        {...props}
      />,
    );

    expect(fila(1)).toBeInTheDocument();
    expect(within(fila(3)).getByText("Inactiva")).toBeInTheDocument();
  });
});
