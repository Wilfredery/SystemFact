/**
 * @jest-environment jsdom
 *
 * Administración — "Mover de sucursal" UI (odd/tasks/administracion-mover-usuario.md
 * T2: S10, S11 RTL). The move action, the branch list and the user list are
 * mocked at the HTTP boundary, so the island is tested against the action
 * result contract.
 *
 * S10: action on rows of ANY branch except the session user's own, dialog with
 * the ACTIVE branches minus the user's current one, explicit confirmation,
 * confirm disabled while pending, the new state shown ONLY after the server
 * answered ok (then a re-read), a catalog message per refusal code.
 */

import "@testing-library/jest-dom";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { AdministracionScreen, type UsuariosInicial } from "../AdministracionScreen";
import {
  listarSucursalesDeEmpresaAction,
  listarUsuariosAction,
} from "@/modules/tenant/http/actions.administracion";
import { moverUsuarioDeSucursalAction } from "@/modules/tenant/http/actions.usuarios";
import { messageFor } from "@/modules/tenant/domain/errors";
import type { ListarUsuariosAdministracion } from "@/modules/tenant/http/shared";
import { MENSAJE_AUTO_MOVER } from "../administracion-tabs";

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(async () => undefined) }),
}));

jest.mock("@/modules/tenant/http/actions.sucursal", () => ({
  crearSucursalAction: jest.fn(),
  editarSucursalAction: jest.fn(),
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
  moverUsuarioDeSucursalAction: jest.fn(),
}));

// The new config write action (feature itbis-tasas-edit) is mocked at the
// HTTP boundary like the other write actions; its real module graph pulls
// the server-only Prisma client that jsdom cannot load.
jest.mock("@/modules/tenant/http/actions.configuracion", () => ({
  editarTasasItbisAction: jest.fn(),
}));

const mockListar = jest.mocked(listarUsuariosAction);
const mockSucursales = jest.mocked(listarSucursalesDeEmpresaAction);
const mockMover = jest.mocked(moverUsuarioDeSucursalAction);

type ResultadoCambio = Awaited<ReturnType<typeof moverUsuarioDeSucursalAction>>;

const SUCURSALES = [
  { id: 1, nombre: "Sucursal Central", direccion: "Calle 1", telefono: "809-555-0001", version: 1 },
  { id: 2, nombre: "Sucursal Norte", direccion: "Calle 2", telefono: "809-555-0002", version: 1 },
  { id: 3, nombre: "Sucursal Sur", direccion: "Calle 3", telefono: "809-555-0003", version: 1 },
];

function usuario(parcial: Record<string, unknown> = {}) {
  return {
    id: 10,
    nombreUsuario: "aperez",
    nombre: "Ana Pérez",
    activo: true,
    version: 3,
    sucursalNombre: "Sucursal Central",
    sucursalId: 1,
    esDeOtraSucursal: false,
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

const AJENO = usuario({
  id: 13,
  nombreUsuario: "otra",
  nombre: "Olga Otra",
  version: 7,
  sucursalNombre: "Sucursal Norte",
  sucursalId: 2,
  esDeOtraSucursal: true,
});

function salida(items: unknown[] = [usuario(), OPERADOR, AJENO]): ListarUsuariosAdministracion {
  return {
    items: items as ListarUsuariosAdministracion["items"],
    total: items.length,
    page: 1,
    pageSize: 25,
    rolesCatalogo: [{ id: 1, nombre: "Administrador" }],
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
      sesionSucursalId={1}

      roles={null}

      empresaNombre="Empresa Demo"
    />,
  );
}

const fila = (id: number) => screen.getByTestId(`usuario-fila-${id}`);
const BOTON_MOVER = { name: "Mover de sucursal" };

async function abrirMover(id = 11): Promise<HTMLElement> {
  await act(async () => {
    fireEvent.click(within(fila(id)).getByRole("button", BOTON_MOVER));
  });
  return screen.getByRole("dialog");
}

async function elegirYConfirmar(dialogo: HTMLElement, destino = "Sucursal Norte") {
  await waitFor(() =>
    expect(within(dialogo).getByRole("combobox", { name: "Sucursal destino" })).toBeInTheDocument(),
  );
  fireEvent.change(within(dialogo).getByRole("combobox", { name: "Sucursal destino" }), {
    target: { value: String(SUCURSALES.find((s) => s.nombre === destino)?.id) },
  });
  await act(async () => {
    fireEvent.click(within(dialogo).getByRole("button", { name: "Mover usuario" }));
  });
}

beforeEach(() => {
  jest.resetAllMocks();
  mockListar.mockResolvedValue({ ok: true, data: salida() });
  mockSucursales.mockResolvedValue({ ok: true, data: SUCURSALES });
});

afterEach(cleanup);

describe("Mover de sucursal action (S10)", () => {
  it("is offered to the Administrador on every row", () => {
    montar();

    for (const id of [10, 11, 13]) {
      expect(within(fila(id)).getByRole("button", BOTON_MOVER)).toBeEnabled();
    }
  });

  it("is not rendered when the caller cannot manage", () => {
    montar({ puedeGestionar: false });

    expect(screen.queryByRole("button", BOTON_MOVER)).not.toBeInTheDocument();
    expect(mockSucursales).not.toHaveBeenCalled();
  });

  it("is disabled on the session user's own row with the own-user title", () => {
    montar({ sesionUsuarioId: 10 });

    const propio = within(fila(10)).getByRole("button", BOTON_MOVER);
    expect(propio).toBeDisabled();
    expect(propio).toHaveAttribute("title", expect.stringMatching(/su propio usuario/i));
    expect(within(fila(11)).getByRole("button", BOTON_MOVER)).toBeEnabled();
  });

  it("stays enabled on another branch's row while roles and estado stay disabled there", () => {
    montar();

    const ajena = within(fila(13));
    expect(ajena.getByRole("button", BOTON_MOVER)).toBeEnabled();
    expect(ajena.getByRole("button", BOTON_MOVER)).not.toHaveAttribute("title");
    expect(ajena.getByRole("button", { name: "Cambiar roles" })).toBeDisabled();
    expect(ajena.getByRole("button", { name: "Desactivar" })).toBeDisabled();
  });
});

describe("Mover de sucursal dialog (S10)", () => {
  it("offers the company's active branches except the user's current one", async () => {
    montar();
    const dialogo = await abrirMover(11);

    const select = await within(dialogo).findByRole("combobox", { name: "Sucursal destino" });
    const opciones = within(select).getAllByRole("option").map((o) => o.textContent);
    expect(opciones).toEqual(["Seleccione una sucursal", "Sucursal Norte", "Sucursal Sur"]);
    expect(mockSucursales).toHaveBeenCalledTimes(1);
  });

  it("excludes the current branch of an other-branch row too", async () => {
    montar();
    const dialogo = await abrirMover(13);

    const select = await within(dialogo).findByRole("combobox", { name: "Sucursal destino" });
    const opciones = within(select).getAllByRole("option").map((o) => o.textContent);
    expect(opciones).toEqual(["Seleccione una sucursal", "Sucursal Central", "Sucursal Sur"]);
  });

  it("shows an empty state and no confirm button when there is no other active branch", async () => {
    mockSucursales.mockResolvedValue({ ok: true, data: [SUCURSALES[0]] });
    montar();
    const dialogo = await abrirMover(11);

    expect(
      await within(dialogo).findByText("No hay otra sucursal activa a la que mover a este usuario."),
    ).toBeInTheDocument();
    expect(within(dialogo).queryByRole("combobox")).not.toBeInTheDocument();
    expect(within(dialogo).queryByRole("button", { name: "Mover usuario" })).not.toBeInTheDocument();
  });

  it("shows a message and no confirm button when the branch list cannot be read", async () => {
    mockSucursales.mockResolvedValue({
      ok: false,
      error: { code: "TEN_OPS_NO_AUTORIZADO", message: "x" },
    });
    montar();
    const dialogo = await abrirMover(11);

    expect(await within(dialogo).findByRole("alert")).toHaveTextContent(
      messageFor("TEN_OPS_NO_AUTORIZADO"),
    );
    expect(within(dialogo).queryByRole("button", { name: "Mover usuario" })).not.toBeInTheDocument();
  });

  it("shows a generic message when the branch list throws", async () => {
    mockSucursales.mockRejectedValue(new Error("boom"));
    montar();
    const dialogo = await abrirMover(11);

    expect(await within(dialogo).findByRole("alert")).toHaveTextContent(
      "No se pudieron cargar las sucursales. Intente de nuevo.",
    );
  });

  it("keeps confirm disabled until a destination is chosen, then names the user and the destination", async () => {
    montar();
    const dialogo = await abrirMover(11);
    const select = await within(dialogo).findByRole("combobox", { name: "Sucursal destino" });

    expect(within(dialogo).getByRole("button", { name: "Mover usuario" })).toBeDisabled();
    expect(within(dialogo).queryByText(/Se moverá a/)).not.toBeInTheDocument();

    fireEvent.change(select, { target: { value: "3" } });

    expect(within(dialogo).getByRole("button", { name: "Mover usuario" })).toBeEnabled();
    expect(
      within(dialogo).getByText(
        /Se moverá a Juan Pérez \(jperez\) de Sucursal Central a Sucursal Sur\./,
      ),
    ).toBeInTheDocument();
    expect(mockMover).not.toHaveBeenCalled();
  });

  it("confirm sends {usuarioId, sucursalDestinoId, versionEsperada} from the row", async () => {
    mockMover.mockResolvedValue({ ok: true, data: { usuarioId: 11, version: 6, cambio: true } });
    montar();
    const dialogo = await abrirMover(11);

    await elegirYConfirmar(dialogo, "Sucursal Norte");

    expect(mockMover).toHaveBeenCalledTimes(1);
    expect(mockMover).toHaveBeenCalledWith({
      usuarioId: 11,
      sucursalDestinoId: 2,
      versionEsperada: 5,
    });
  });

  it("while pending: disables the controls, shows no new state, re-reads nothing and sends once", async () => {
    let resolver: (v: ResultadoCambio) => void = () => {};
    mockMover.mockImplementationOnce(() => new Promise<ResultadoCambio>((r) => (resolver = r)));
    montar();
    const dialogo = await abrirMover(11);

    await elegirYConfirmar(dialogo);

    expect(within(dialogo).getByRole("button", { name: "Mover usuario" })).toBeDisabled();
    expect(within(dialogo).getByRole("button", { name: "Cancelar" })).toBeDisabled();
    expect(within(dialogo).getByRole("combobox", { name: "Sucursal destino" })).toBeDisabled();
    // Never optimistic: the row still shows the old branch and nothing was re-read.
    expect(within(fila(11)).getByText("Empresa Demo / Sucursal Central")).toBeInTheDocument();
    expect(mockListar).not.toHaveBeenCalled();

    fireEvent.click(within(dialogo).getByRole("button", { name: "Mover usuario" }));
    expect(mockMover).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolver({ ok: true, data: { usuarioId: 11, version: 6, cambio: true } });
    });
  });

  it("on ok: closes the dialog, re-reads the list and shows the new branch", async () => {
    mockMover.mockResolvedValue({ ok: true, data: { usuarioId: 11, version: 6, cambio: true } });
    mockListar.mockResolvedValue({
      ok: true,
      data: salida([
        usuario(),
        usuario({
          id: 11,
          nombreUsuario: "jperez",
          nombre: "Juan Pérez",
          version: 6,
          sucursalNombre: "Sucursal Norte",
          sucursalId: 2,
          esDeOtraSucursal: true,
          roles: ["Operador"],
        }),
      ]),
    });
    montar();
    const dialogo = await abrirMover(11);

    await elegirYConfirmar(dialogo, "Sucursal Norte");

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(mockListar).toHaveBeenCalledTimes(1);
    expect(within(fila(11)).getByText("Empresa Demo / Sucursal Norte")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Usuario movido a Sucursal Norte.");
    // The reloaded row is another branch's: the role button is disabled, Mover is not.
    expect(within(fila(11)).getByRole("button", { name: "Cambiar roles" })).toBeDisabled();
    expect(within(fila(11)).getByRole("button", BOTON_MOVER)).toBeEnabled();
  });

  it("an idempotent no-op answer says nothing changed", async () => {
    mockMover.mockResolvedValue({ ok: true, data: { usuarioId: 11, version: 5, cambio: false } });
    montar();
    const dialogo = await abrirMover(11);

    await elegirYConfirmar(dialogo);

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("No había cambios que guardar."));
  });

  it.each([
    ["TEN_ULTIMO_ADMINISTRADOR", messageFor("TEN_ULTIMO_ADMINISTRADOR")],
    ["TEN_AUTO_PROTECCION", MENSAJE_AUTO_MOVER],
    ["TEN_SUCURSAL_NO_VALIDA", messageFor("TEN_SUCURSAL_NO_VALIDA")],
    ["TEN_USUARIO_NO_ENCONTRADO", messageFor("TEN_USUARIO_NO_ENCONTRADO")],
    ["TEN_OPS_NO_AUTORIZADO", messageFor("TEN_OPS_NO_AUTORIZADO")],
  ] as const)("keeps the dialog open and shows the message of %s", async (codigo, esperado) => {
    mockMover.mockResolvedValue({ ok: false, error: { code: codigo, message: "mensaje del servidor" } });
    montar();
    const dialogo = await abrirMover(11);

    await elegirYConfirmar(dialogo);

    expect(within(screen.getByRole("dialog")).getByRole("alert")).toHaveTextContent(esperado);
    expect(esperado).not.toBe("");
    expect(mockListar).not.toHaveBeenCalled();
    // The person can retry: confirm is enabled again.
    expect(within(screen.getByRole("dialog")).getByRole("button", { name: "Mover usuario" })).toBeEnabled();
  });

  it("on a conflict shows the message and reloads the rows, without retrying", async () => {
    mockMover.mockResolvedValue({
      ok: false,
      error: { code: "TEN_CONCURRENCIA_CONFLICTO", message: "x" },
    });
    montar();
    const dialogo = await abrirMover(11);

    await elegirYConfirmar(dialogo);

    expect(within(screen.getByRole("dialog")).getByRole("alert")).toHaveTextContent(
      messageFor("TEN_CONCURRENCIA_CONFLICTO"),
    );
    expect(mockListar).toHaveBeenCalledTimes(1);
    expect(mockMover).toHaveBeenCalledTimes(1);
  });

  it("shows a generic message and keeps the dialog open when the action throws", async () => {
    mockMover.mockRejectedValue(new Error("network"));
    montar();
    const dialogo = await abrirMover(11);

    await elegirYConfirmar(dialogo);

    expect(within(screen.getByRole("dialog")).getByRole("alert")).toHaveTextContent(
      "No se pudo completar la acción. Intente de nuevo.",
    );
  });

  it("Cancelar closes the dialog without calling the move action", async () => {
    montar();
    const dialogo = await abrirMover(11);
    await within(dialogo).findByRole("combobox", { name: "Sucursal destino" });

    fireEvent.click(within(dialogo).getByRole("button", { name: "Cancelar" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(mockMover).not.toHaveBeenCalled();
  });
});
