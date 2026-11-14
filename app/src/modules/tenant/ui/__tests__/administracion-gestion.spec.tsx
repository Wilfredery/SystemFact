/**
 * @jest-environment jsdom
 *
 * Administración — user-management writes UI (odd/tasks/administracion-writes.md
 * T3: S11, S12). The two write actions and the list action are mocked at the
 * HTTP boundary, so the island is tested against the action result contract.
 *
 * S11: `Acciones` column only for the Administrador (the server decides; the
 * page passes `puedeGestionar`), role dialog with preselection and rules,
 * activate/deactivate confirmation, buttons disabled while pending, the new
 * state shown ONLY after the server answered ok (then a re-read), stable-code
 * messages kept in the open dialog, conflict reloads, own row disabled.
 */

import "@testing-library/jest-dom";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { AdministracionScreen, type UsuariosInicial } from "../AdministracionScreen";
import { listarUsuariosAction } from "@/modules/tenant/http/actions.administracion";
import {
  cambiarEstadoUsuarioAction,
  cambiarRolesUsuarioAction,
} from "@/modules/tenant/http/actions.usuarios";
import { TEN_ERROR_CODES, messageFor } from "@/modules/tenant/domain/errors";
import type { ListarUsuariosAdministracion } from "@/modules/tenant/http/shared";

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(async () => undefined) }),
}));

jest.mock("@/modules/tenant/http/actions.administracion", () => ({
  listarUsuariosAction: jest.fn(),
  listarSucursalesDeEmpresaAction: jest.fn(),
  consultarConfiguracionAction: jest.fn(),
  obtenerPermisosAdministracionAction: jest.fn(),
}));

jest.mock("@/modules/tenant/http/actions.usuarios", () => ({
  cambiarRolesUsuarioAction: jest.fn(),
  cambiarEstadoUsuarioAction: jest.fn(),
}));

const mockListar = jest.mocked(listarUsuariosAction);
const mockRoles = jest.mocked(cambiarRolesUsuarioAction);
const mockEstado = jest.mocked(cambiarEstadoUsuarioAction);

type ResultadoCambio = Awaited<ReturnType<typeof cambiarRolesUsuarioAction>>;

const CATALOGO = [
  { id: 1, nombre: "Administrador" },
  { id: 2, nombre: "Operador" },
  { id: 3, nombre: "Despachador" },
];

const CODIGOS_SIN_CONFLICTO = TEN_ERROR_CODES.filter((c) => c !== "TEN_CONCURRENCIA_CONFLICTO");

function usuario(parcial: Record<string, unknown> = {}) {
  return {
    id: 10,
    nombreUsuario: "aperez",
    nombre: "Ana Pérez",
    activo: true,
    version: 3,
    sucursalNombre: "Sucursal Central",
    empresaNombre: "Empresa Demo",
    roles: ["Administrador"],
    rolIds: [1],
    ...parcial,
  };
}

const OPERADOR = usuario({
  id: 11,
  nombreUsuario: "jperez",
  nombre: "Juan Pérez",
  version: 5,
  roles: ["Operador"],
  rolIds: [2],
});

function salida(items: unknown[] = [usuario(), OPERADOR]): ListarUsuariosAdministracion {
  return {
    items: items as ListarUsuariosAdministracion["items"],
    total: items.length,
    page: 1,
    pageSize: 25,
    rolesCatalogo: CATALOGO,
  };
}

function montar({
  puedeGestionar = true,
  sesionUsuarioId = 99,
  items,
}: { puedeGestionar?: boolean; sesionUsuarioId?: number; items?: unknown[] } = {}) {
  const inicial: UsuariosInicial = { ok: true, data: salida(items) };
  return render(
    <AdministracionScreen
      tab="usuarios"
      filtrosIniciales={{ busqueda: "", activo: "" }}
      usuarios={inicial}
      sucursales={null}
      configuracion={null}
      puedeGestionar={puedeGestionar}
      sesionUsuarioId={sesionUsuarioId}
    />,
  );
}

const fila = (id: number) => screen.getByTestId(`usuario-fila-${id}`);

function abrirRoles(id = 11) {
  fireEvent.click(within(fila(id)).getByRole("button", { name: "Cambiar roles" }));
  return screen.getByRole("dialog");
}

function marcarDespachadorYGuardar(dialogo: HTMLElement) {
  fireEvent.click(within(dialogo).getByRole("checkbox", { name: "Despachador" }));
  return act(async () => {
    fireEvent.click(within(dialogo).getByRole("button", { name: "Guardar" }));
  });
}

beforeEach(() => {
  jest.resetAllMocks();
  mockListar.mockResolvedValue({ ok: true, data: salida() });
});

afterEach(cleanup);

describe("Acciones column (S11)", () => {
  it("renders the Acciones column and the per-row buttons for the Administrador", () => {
    montar();

    expect(screen.getByRole("columnheader", { name: "Acciones" })).toBeInTheDocument();
    expect(within(fila(10)).getByRole("button", { name: "Cambiar roles" })).toBeEnabled();
    expect(within(fila(10)).getByRole("button", { name: "Desactivar" })).toBeEnabled();
    expect(within(fila(11)).getByRole("button", { name: "Cambiar roles" })).toBeEnabled();
  });

  it("offers Activar (not Desactivar) for an inactive user", () => {
    montar({ items: [usuario({ id: 12, activo: false })] });

    expect(within(fila(12)).getByRole("button", { name: "Activar" })).toBeEnabled();
    expect(within(fila(12)).queryByRole("button", { name: "Desactivar" })).not.toBeInTheDocument();
  });

  it("renders no Acciones column and no controls when the caller cannot manage", () => {
    montar({ puedeGestionar: false });

    expect(screen.queryByRole("columnheader", { name: "Acciones" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cambiar roles" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^(Activar|Desactivar)$/ })).not.toBeInTheDocument();
  });

  it("disables both actions on the session user's own row with an explanatory title", () => {
    montar({ sesionUsuarioId: 10 });

    const propia = within(fila(10));
    expect(propia.getByRole("button", { name: "Cambiar roles" })).toBeDisabled();
    expect(propia.getByRole("button", { name: "Desactivar" })).toBeDisabled();
    expect(propia.getByRole("button", { name: "Cambiar roles" })).toHaveAttribute(
      "title",
      expect.stringMatching(/su propio usuario/i),
    );
    expect(propia.getByRole("button", { name: "Desactivar" })).toHaveAttribute(
      "title",
      expect.stringMatching(/su propio usuario/i),
    );
    // Other rows stay actionable.
    expect(within(fila(11)).getByRole("button", { name: "Cambiar roles" })).toBeEnabled();
  });
});

describe("Cambiar roles dialog (S11)", () => {
  it("lists one checkbox per active catalog role, preselected with the user's roles", () => {
    montar();
    const dialogo = abrirRoles(11);

    expect(within(dialogo).getByText(/jperez/)).toBeInTheDocument();
    expect(within(dialogo).getAllByRole("checkbox")).toHaveLength(3);
    expect(within(dialogo).getByRole("checkbox", { name: "Administrador" })).not.toBeChecked();
    expect(within(dialogo).getByRole("checkbox", { name: "Operador" })).toBeChecked();
    expect(within(dialogo).getByRole("checkbox", { name: "Despachador" })).not.toBeChecked();
  });

  it("keeps Guardar disabled until the selection changed and is non-empty", () => {
    montar();
    const dialogo = abrirRoles(11);
    const guardar = within(dialogo).getByRole("button", { name: "Guardar" });
    expect(guardar).toBeDisabled();

    fireEvent.click(within(dialogo).getByRole("checkbox", { name: "Despachador" }));
    expect(guardar).toBeEnabled();

    // Back to the original selection: nothing to save.
    fireEvent.click(within(dialogo).getByRole("checkbox", { name: "Despachador" }));
    expect(guardar).toBeDisabled();

    // Empty selection: at least one role is required.
    fireEvent.click(within(dialogo).getByRole("checkbox", { name: "Operador" }));
    expect(guardar).toBeDisabled();
    expect(within(dialogo).getByText("Seleccione al menos un rol.")).toBeInTheDocument();
  });

  it("submits the exact payload {usuarioId, rolIds, versionEsperada}", async () => {
    mockRoles.mockResolvedValue({ ok: true, data: { usuarioId: 11, version: 6, cambio: true } });
    montar();

    await marcarDespachadorYGuardar(abrirRoles(11));

    expect(mockRoles).toHaveBeenCalledTimes(1);
    expect(mockRoles).toHaveBeenCalledWith({ usuarioId: 11, rolIds: [2, 3], versionEsperada: 5 });
  });

  it("disables the dialog controls while pending, shows no new state and sends once", async () => {
    let resolver: (v: ResultadoCambio) => void = () => {};
    mockRoles.mockImplementationOnce(() => new Promise<ResultadoCambio>((r) => (resolver = r)));
    montar();
    const dialogo = abrirRoles(11);

    await marcarDespachadorYGuardar(dialogo);

    expect(within(dialogo).getByRole("button", { name: "Guardar" })).toBeDisabled();
    expect(within(dialogo).getByRole("button", { name: "Cancelar" })).toBeDisabled();
    expect(within(dialogo).getByRole("checkbox", { name: "Despachador" })).toBeDisabled();
    // No optimistic update: the row still shows the old roles and nothing was re-read.
    expect(within(fila(11)).getByText("Operador")).toBeInTheDocument();
    expect(mockListar).not.toHaveBeenCalled();

    // A second click while pending does not send a second request.
    fireEvent.click(within(dialogo).getByRole("button", { name: "Guardar" }));
    expect(mockRoles).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolver({ ok: true, data: { usuarioId: 11, version: 6, cambio: true } });
    });
  });

  it("on ok: closes the dialog, re-reads the list and shows the new roles", async () => {
    mockRoles.mockResolvedValue({ ok: true, data: { usuarioId: 11, version: 6, cambio: true } });
    mockListar.mockResolvedValue({
      ok: true,
      data: salida([
        usuario(),
        { ...OPERADOR, roles: ["Operador", "Despachador"], rolIds: [2, 3], version: 6 },
      ]),
    });
    montar();

    await marcarDespachadorYGuardar(abrirRoles(11));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(mockListar).toHaveBeenCalledWith({ page: 1, pageSize: 25 });
    expect(within(fila(11)).getByText("Operador, Despachador")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Roles actualizados.");

    // The next save uses the re-read version, not the stale one.
    mockRoles.mockResolvedValue({ ok: true, data: { usuarioId: 11, version: 7, cambio: true } });
    const siguiente = abrirRoles(11);
    fireEvent.click(within(siguiente).getByRole("checkbox", { name: "Despachador" }));
    await act(async () => {
      fireEvent.click(within(siguiente).getByRole("button", { name: "Guardar" }));
    });
    expect(mockRoles).toHaveBeenLastCalledWith({ usuarioId: 11, rolIds: [2], versionEsperada: 6 });
  });

  it.each(CODIGOS_SIN_CONFLICTO)("keeps the dialog open and shows the message of %s", async (codigo) => {
    mockRoles.mockResolvedValue({
      ok: false,
      error: { code: codigo, message: "mensaje del servidor" },
    });
    montar();

    await marcarDespachadorYGuardar(abrirRoles(11));

    const dialogo = screen.getByRole("dialog");
    expect(within(dialogo).getByRole("alert")).toHaveTextContent(messageFor(codigo));
    expect(within(dialogo).getByRole("button", { name: "Guardar" })).toBeEnabled();
    expect(mockListar).not.toHaveBeenCalled();
  });

  it("on a conflict shows the message, reloads the row data and waits for an explicit retry", async () => {
    mockRoles.mockResolvedValueOnce({
      ok: false,
      error: { code: "TEN_CONCURRENCIA_CONFLICTO", message: "x" },
    });
    mockListar.mockResolvedValue({
      ok: true,
      data: salida([usuario(), { ...OPERADOR, version: 9 }]),
    });
    montar();

    await marcarDespachadorYGuardar(abrirRoles(11));

    const dialogo = screen.getByRole("dialog");
    expect(within(dialogo).getByRole("alert")).toHaveTextContent(
      messageFor("TEN_CONCURRENCIA_CONFLICTO"),
    );
    expect(mockListar).toHaveBeenCalledTimes(1);
    // Never an automatic retry.
    expect(mockRoles).toHaveBeenCalledTimes(1);

    // The explicit retry carries the reloaded version.
    mockRoles.mockResolvedValueOnce({
      ok: true,
      data: { usuarioId: 11, version: 10, cambio: true },
    });
    await act(async () => {
      fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Guardar" }));
    });
    expect(mockRoles).toHaveBeenLastCalledWith({
      usuarioId: 11,
      rolIds: [2, 3],
      versionEsperada: 9,
    });
  });

  it("shows a generic message and keeps the dialog open when the action throws", async () => {
    mockRoles.mockRejectedValue(new Error("boom"));
    montar();

    await marcarDespachadorYGuardar(abrirRoles(11));

    expect(within(screen.getByRole("dialog")).getByRole("alert")).toHaveTextContent(
      "No se pudo completar la acción. Intente de nuevo.",
    );
  });

  it("Cancelar closes the dialog without calling the action", async () => {
    montar();
    const dialogo = abrirRoles(11);

    fireEvent.click(within(dialogo).getByRole("button", { name: "Cancelar" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(mockRoles).not.toHaveBeenCalled();
  });
});

describe("Activar / Desactivar confirmation (S11)", () => {
  function abrirDesactivar(id = 11) {
    fireEvent.click(within(fila(id)).getByRole("button", { name: "Desactivar" }));
    return screen.getByRole("dialog");
  }

  function confirmarDesactivar() {
    return act(async () => {
      fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Desactivar" }));
    });
  }

  it("states the user and the effect before deactivating, and sends nothing until confirmed", () => {
    montar();
    const dialogo = abrirDesactivar(11);

    expect(within(dialogo).getByText(/Juan Pérez/)).toBeInTheDocument();
    expect(within(dialogo).getByText(/jperez/)).toBeInTheDocument();
    expect(
      within(dialogo).getByText("No podrá iniciar sesión ni operar desde su próxima solicitud."),
    ).toBeInTheDocument();
    expect(mockEstado).not.toHaveBeenCalled();
  });

  it("deactivates with the exact payload, then closes, re-reads and shows Inactivo", async () => {
    mockEstado.mockResolvedValue({ ok: true, data: { usuarioId: 11, version: 6, cambio: true } });
    mockListar.mockResolvedValue({
      ok: true,
      data: salida([usuario(), { ...OPERADOR, activo: false, version: 6 }]),
    });
    montar();
    abrirDesactivar(11);

    await confirmarDesactivar();

    expect(mockEstado).toHaveBeenCalledWith({ usuarioId: 11, activo: false, versionEsperada: 5 });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(within(fila(11)).getByText("Inactivo")).toBeInTheDocument();
    expect(within(fila(11)).getByRole("button", { name: "Activar" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Usuario desactivado.");
  });

  it("activates an inactive user with activo=true", async () => {
    mockEstado.mockResolvedValue({ ok: true, data: { usuarioId: 12, version: 4, cambio: true } });
    montar({ items: [usuario({ id: 12, nombreUsuario: "inactivo", activo: false, version: 3 })] });
    fireEvent.click(within(fila(12)).getByRole("button", { name: "Activar" }));

    const dialogo = screen.getByRole("dialog");
    expect(within(dialogo).getByText(/inactivo/)).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(within(dialogo).getByRole("button", { name: "Activar" }));
    });

    expect(mockEstado).toHaveBeenCalledWith({ usuarioId: 12, activo: true, versionEsperada: 3 });
  });

  it("disables the buttons while pending and sends once", async () => {
    mockEstado.mockImplementationOnce(() => new Promise<ResultadoCambio>(() => {}));
    montar();
    const dialogo = abrirDesactivar(11);

    await confirmarDesactivar();

    expect(within(dialogo).getByRole("button", { name: "Desactivar" })).toBeDisabled();
    expect(within(dialogo).getByRole("button", { name: "Cancelar" })).toBeDisabled();
    fireEvent.click(within(dialogo).getByRole("button", { name: "Desactivar" }));
    expect(mockEstado).toHaveBeenCalledTimes(1);
    expect(within(fila(11)).getByText("Activo")).toBeInTheDocument();
  });

  it.each(CODIGOS_SIN_CONFLICTO)("keeps the confirmation open and shows the message of %s", async (codigo) => {
    mockEstado.mockResolvedValue({
      ok: false,
      error: { code: codigo, message: "mensaje del servidor" },
    });
    montar();
    abrirDesactivar(11);

    await confirmarDesactivar();

    expect(within(screen.getByRole("dialog")).getByRole("alert")).toHaveTextContent(
      messageFor(codigo),
    );
    expect(mockListar).not.toHaveBeenCalled();
  });

  it("on a conflict shows the message and reloads the row data", async () => {
    mockEstado.mockResolvedValue({
      ok: false,
      error: { code: "TEN_CONCURRENCIA_CONFLICTO", message: "x" },
    });
    montar();
    abrirDesactivar(11);

    await confirmarDesactivar();

    expect(within(screen.getByRole("dialog")).getByRole("alert")).toHaveTextContent(
      messageFor("TEN_CONCURRENCIA_CONFLICTO"),
    );
    expect(mockListar).toHaveBeenCalledTimes(1);
    expect(mockEstado).toHaveBeenCalledTimes(1);
  });
});
