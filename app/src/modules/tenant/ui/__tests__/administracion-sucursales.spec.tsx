/**
 * @jest-environment jsdom
 *
 * Administración — "Nueva sucursal" / "Editar" UI
 * (odd/tasks/administracion-sucursales-crear-editar.md T3: S9, S10 RTL). The two
 * write actions and the branch list are mocked at the HTTP boundary, so the
 * island is tested against the action result contract.
 *
 * S9: buttons only where the caller may manage, one dialog for create and edit,
 * inline validation mirroring the zod rules, confirm disabled while invalid or
 * pending, the new state shown ONLY after the server answered ok (then a
 * re-read), a Spanish message per refusal code, a conflict reloads and never
 * retries. Edit with nothing changed keeps confirm disabled (like "Cambiar roles").
 */

import "@testing-library/jest-dom";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { AdministracionScreen, type SucursalesInicial } from "../AdministracionScreen";
import {
  listarSucursalesAdministracionAction,
  listarSucursalesDeEmpresaAction,
  listarUsuariosAction,
} from "@/modules/tenant/http/actions.administracion";
import { crearSucursalAction, editarSucursalAction } from "@/modules/tenant/http/actions.sucursal";
import { moverUsuarioDeSucursalAction } from "@/modules/tenant/http/actions.usuarios";
import { messageFor } from "@/modules/tenant/domain/errors";
import type { ListarUsuariosAdministracion, SucursalGestionDto } from "@/modules/tenant/http/shared";

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

const mockListarUsuarios = jest.mocked(listarUsuariosAction);
const mockSucursales = jest.mocked(listarSucursalesDeEmpresaAction);
const mockTodas = jest.mocked(listarSucursalesAdministracionAction);
const mockCrear = jest.mocked(crearSucursalAction);
const mockEditar = jest.mocked(editarSucursalAction);

type ResultadoCrear = Awaited<ReturnType<typeof crearSucursalAction>>;

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
const NUEVA: SucursalGestionDto = {
  id: 3,
  nombre: "Sucursal Sur",
  direccion: "Av. Sur 3",
  telefono: "809-555-0003",
  activa: true,
  version: 1,
};

function gestionable(s: SucursalGestionDto) {
  return { id: s.id, nombre: s.nombre, direccion: s.direccion, telefono: s.telefono, activa: s.activa, version: s.version };
}

function montar({
  puedeGestionar = true,
  sucursales = [CENTRAL, NORTE],
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
      sesionSucursalId={1}

      roles={null}

      empresaNombre="Empresa Demo"
    />,
  );
}

const BOTON_NUEVA = { name: "Nueva sucursal" };
const fila = (id: number) => screen.getByTestId(`sucursal-fila-${id}`);

async function abrirCrear(): Promise<HTMLElement> {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", BOTON_NUEVA));
  });
  return screen.getByRole("dialog", { name: "Nueva sucursal" });
}

async function abrirEditar(id = 2): Promise<HTMLElement> {
  await act(async () => {
    fireEvent.click(within(fila(id)).getByRole("button", { name: "Editar" }));
  });
  return screen.getByRole("dialog", { name: "Editar sucursal" });
}

function escribir(dialogo: HTMLElement, campo: "Nombre" | "Dirección" | "Teléfono", valor: string) {
  fireEvent.change(within(dialogo).getByLabelText(campo), { target: { value: valor } });
}

function llenar(dialogo: HTMLElement, nombre: string, direccion: string, telefono: string) {
  escribir(dialogo, "Nombre", nombre);
  escribir(dialogo, "Dirección", direccion);
  escribir(dialogo, "Teléfono", telefono);
}

async function confirmar(dialogo: HTMLElement, nombre: string) {
  await act(async () => {
    fireEvent.click(within(dialogo).getByRole("button", { name: nombre }));
  });
}

beforeEach(() => {
  jest.resetAllMocks();
  mockTodas.mockResolvedValue({ ok: true, data: [CENTRAL, NORTE] });
  mockSucursales.mockResolvedValue({ ok: true, data: [CENTRAL, NORTE] });
});

afterEach(cleanup);

describe("Sucursales tab (S9)", () => {
  it("shows Nombre, Dirección, Teléfono and Estado with the New button and an Editar per row for the Administrador", () => {
    montar();

    for (const columna of ["Nombre", "Dirección", "Teléfono", "Estado"]) {
      expect(screen.getByRole("columnheader", { name: columna })).toBeInTheDocument();
    }
    expect(screen.getByRole("button", BOTON_NUEVA)).toBeEnabled();
    expect(fila(1)).toHaveTextContent("Sucursal Central");
    expect(fila(1)).toHaveTextContent("Calle 1");
    expect(fila(1)).toHaveTextContent("809-555-0001");
    expect(fila(1)).toHaveTextContent("Activa");
    for (const id of [1, 2]) {
      expect(within(fila(id)).getByRole("button", { name: "Editar" })).toBeEnabled();
    }
  });

  it("renders no write control when the caller cannot manage, but still lists the branches", () => {
    montar({ puedeGestionar: false });

    expect(screen.queryByRole("button", BOTON_NUEVA)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Editar" })).not.toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Acciones" })).not.toBeInTheDocument();
    expect(fila(2)).toHaveTextContent("Sucursal Norte");
    expect(fila(2)).toHaveTextContent("Calle 2");
  });
});

describe("Nueva sucursal dialog (S9)", () => {
  it("opens empty with confirm disabled and no inline errors yet", async () => {
    montar();
    const dialogo = await abrirCrear();

    for (const campo of ["Nombre", "Dirección", "Teléfono"] as const) {
      expect(within(dialogo).getByLabelText(campo)).toHaveValue("");
    }
    expect(within(dialogo).getByRole("button", { name: "Crear sucursal" })).toBeDisabled();
    expect(within(dialogo).queryByText("Este campo es obligatorio.")).not.toBeInTheDocument();
  });

  it.each([
    ["empty", ""],
    ["blank", "   "],
    ["over 255 characters", "x".repeat(256)],
  ])("keeps confirm disabled and explains it when a field is %s", async (_caso, malo) => {
    montar();
    const dialogo = await abrirCrear();
    llenar(dialogo, "Sucursal Sur", "Av. Sur 3", "809-555-0003");
    expect(within(dialogo).getByRole("button", { name: "Crear sucursal" })).toBeEnabled();
    const mensaje = malo.length > 255 ? "Máximo 255 caracteres." : "Este campo es obligatorio.";

    for (const campo of ["Nombre", "Dirección", "Teléfono"] as const) {
      llenar(dialogo, "Sucursal Sur", "Av. Sur 3", "809-555-0003");
      escribir(dialogo, campo, malo);

      expect(within(dialogo).getByRole("button", { name: "Crear sucursal" })).toBeDisabled();
      expect(within(dialogo).getByLabelText(campo)).toHaveAttribute("aria-invalid", "true");
      expect(within(dialogo).getByText(mensaje)).toBeInTheDocument();
    }
    expect(mockCrear).not.toHaveBeenCalled();
  });

  it("accepts exactly 255 characters", async () => {
    montar();
    const dialogo = await abrirCrear();

    llenar(dialogo, "x".repeat(255), "Av. Sur 3", "809-555-0003");

    expect(within(dialogo).getByRole("button", { name: "Crear sucursal" })).toBeEnabled();
  });

  it("states what will happen once the form is valid", async () => {
    montar();
    const dialogo = await abrirCrear();

    llenar(dialogo, "  Sucursal Sur  ", "Av. Sur 3", "809-555-0003");

    expect(
      within(dialogo).getByText(
        "Se creará la sucursal Sucursal Sur y quedará activa. Las sucursales no se eliminan.",
      ),
    ).toBeInTheDocument();
  });

  it("confirm sends the three trimmed values", async () => {
    mockCrear.mockResolvedValue({ ok: true, data: gestionable(NUEVA) });
    mockTodas.mockResolvedValue({ ok: true, data: [CENTRAL, NORTE, NUEVA] });
    montar();
    const dialogo = await abrirCrear();

    llenar(dialogo, "  Sucursal Sur ", " Av. Sur 3  ", " 809-555-0003 ");
    await confirmar(dialogo, "Crear sucursal");

    expect(mockCrear).toHaveBeenCalledTimes(1);
    expect(mockCrear).toHaveBeenCalledWith({
      nombre: "Sucursal Sur",
      direccion: "Av. Sur 3",
      telefono: "809-555-0003",
    });
  });

  it("while pending: disables everything, shows no new state, re-reads nothing and sends once", async () => {
    let resolver: (v: ResultadoCrear) => void = () => {};
    mockCrear.mockImplementationOnce(() => new Promise<ResultadoCrear>((r) => (resolver = r)));
    mockTodas.mockResolvedValue({ ok: true, data: [CENTRAL, NORTE, NUEVA] });
    montar();
    const dialogo = await abrirCrear();
    llenar(dialogo, "Sucursal Sur", "Av. Sur 3", "809-555-0003");

    await confirmar(dialogo, "Crear sucursal");

    expect(within(dialogo).getByRole("button", { name: "Crear sucursal" })).toBeDisabled();
    expect(within(dialogo).getByRole("button", { name: "Cancelar" })).toBeDisabled();
    expect(within(dialogo).getByLabelText("Nombre")).toBeDisabled();
    expect(screen.queryByTestId("sucursal-fila-3")).not.toBeInTheDocument();
    expect(mockTodas).not.toHaveBeenCalled();

    fireEvent.click(within(dialogo).getByRole("button", { name: "Crear sucursal" }));
    expect(mockCrear).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolver({ ok: true, data: gestionable(NUEVA) });
    });
  });

  it("on ok: closes the dialog, re-reads the list and shows the new branch", async () => {
    mockCrear.mockResolvedValue({ ok: true, data: gestionable(NUEVA) });
    mockTodas.mockResolvedValue({ ok: true, data: [CENTRAL, NORTE, NUEVA] });
    montar();
    const dialogo = await abrirCrear();
    llenar(dialogo, "Sucursal Sur", "Av. Sur 3", "809-555-0003");

    await confirmar(dialogo, "Crear sucursal");

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(mockTodas).toHaveBeenCalledTimes(1);
    expect(fila(3)).toHaveTextContent("Sucursal Sur");
    expect(fila(3)).toHaveTextContent("Av. Sur 3");
    expect(fila(3)).toHaveTextContent("809-555-0003");
    expect(screen.getByRole("status")).toHaveTextContent("Sucursal Sucursal Sur creada.");
  });

  it("Cancelar closes the dialog without calling the action", async () => {
    montar();
    const dialogo = await abrirCrear();

    fireEvent.click(within(dialogo).getByRole("button", { name: "Cancelar" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(mockCrear).not.toHaveBeenCalled();
  });

  it("the new branch is selectable in the move dialog the next time it opens (it re-reads on open)", async () => {
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
    mockListarUsuarios.mockResolvedValue({ ok: true, data: usuarios });
    render(
      <AdministracionScreen
        tab="usuarios"
        filtrosIniciales={{ busqueda: "", activo: "" }}
        usuarios={{ ok: true, data: usuarios }}
        sucursales={null}
        configuracion={null}
        puedeGestionar
        sesionUsuarioId={99}
        sesionSucursalId={1}

        roles={null}

        empresaNombre="Empresa Demo"
      />,
    );
    const abrirMover = async () => {
      await act(async () => {
        fireEvent.click(
          within(screen.getByTestId("usuario-fila-11")).getByRole("button", { name: "Mover de sucursal" }),
        );
      });
      return screen.getByRole("dialog");
    };

    let dialogo = await abrirMover();
    let select = await within(dialogo).findByRole("combobox", { name: "Sucursal destino" });
    expect(within(select).queryByRole("option", { name: "Sucursal Sur" })).not.toBeInTheDocument();
    fireEvent.click(within(dialogo).getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    mockSucursales.mockResolvedValue({ ok: true, data: [CENTRAL, NORTE, NUEVA] });
    dialogo = await abrirMover();
    select = await within(dialogo).findByRole("combobox", { name: "Sucursal destino" });
    await waitFor(() =>
      expect(within(select).getByRole("option", { name: "Sucursal Sur" })).toBeInTheDocument(),
    );
    expect(mockSucursales).toHaveBeenCalledTimes(2);
    // The tab's all-branches read is never what feeds the move dialog.
    expect(mockTodas).not.toHaveBeenCalled();
    expect(jest.mocked(moverUsuarioDeSucursalAction)).not.toHaveBeenCalled();
  });
});

describe("Editar dialog (S9)", () => {
  it("is prefilled from the row and, unchanged, keeps confirm disabled", async () => {
    montar();
    const dialogo = await abrirEditar(2);

    expect(within(dialogo).getByLabelText("Nombre")).toHaveValue("Sucursal Norte");
    expect(within(dialogo).getByLabelText("Dirección")).toHaveValue("Calle 2");
    expect(within(dialogo).getByLabelText("Teléfono")).toHaveValue("809-555-0002");
    expect(within(dialogo).getByRole("button", { name: "Guardar cambios" })).toBeDisabled();

    // Whitespace around the same values is still "no change".
    escribir(dialogo, "Dirección", "  Calle 2 ");
    expect(within(dialogo).getByRole("button", { name: "Guardar cambios" })).toBeDisabled();
  });

  it("an emptied field disables confirm with the inline message", async () => {
    montar();
    const dialogo = await abrirEditar(2);

    escribir(dialogo, "Teléfono", "  ");

    expect(within(dialogo).getByRole("button", { name: "Guardar cambios" })).toBeDisabled();
    expect(within(dialogo).getByText("Este campo es obligatorio.")).toBeInTheDocument();
  });

  it("confirm sends sucursalId, the trimmed values and the row's version as versionEsperada", async () => {
    mockEditar.mockResolvedValue({ ok: true, data: { ...gestionable(NORTE), cambio: true } });
    montar();
    const dialogo = await abrirEditar(2);

    escribir(dialogo, "Dirección", "  Av. Nueva 9 ");
    expect(
      within(dialogo).getByText("Se guardarán los cambios de la sucursal Sucursal Norte."),
    ).toBeInTheDocument();
    await confirmar(dialogo, "Guardar cambios");

    expect(mockEditar).toHaveBeenCalledTimes(1);
    expect(mockEditar).toHaveBeenCalledWith({
      sucursalId: 2,
      nombre: "Sucursal Norte",
      direccion: "Av. Nueva 9",
      telefono: "809-555-0002",
      versionEsperada: 4,
    });
  });

  it("on ok: shows the new value only after the re-read", async () => {
    mockEditar.mockResolvedValue({
      ok: true,
      data: { ...gestionable({ ...NORTE, direccion: "Av. Nueva 9", version: 5 }), cambio: true },
    });
    mockTodas.mockResolvedValue({
      ok: true,
      data: [CENTRAL, { ...NORTE, direccion: "Av. Nueva 9", version: 5 }],
    });
    montar();
    const dialogo = await abrirEditar(2);
    escribir(dialogo, "Dirección", "Av. Nueva 9");

    await confirmar(dialogo, "Guardar cambios");

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(mockTodas).toHaveBeenCalledTimes(1);
    expect(fila(2)).toHaveTextContent("Av. Nueva 9");
    expect(fila(2)).not.toHaveTextContent("Calle 2");
    expect(screen.getByRole("status")).toHaveTextContent("Sucursal Sucursal Norte actualizada.");
  });

  it("an idempotent no-op answer says nothing changed", async () => {
    mockEditar.mockResolvedValue({ ok: true, data: { ...gestionable(NORTE), cambio: false } });
    montar();
    const dialogo = await abrirEditar(2);
    escribir(dialogo, "Dirección", "Av. Nueva 9");

    await confirmar(dialogo, "Guardar cambios");

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("No había cambios que guardar."));
  });

  it("while pending: disables confirm, keeps the old value and does not re-read", async () => {
    type ResultadoEditar = Awaited<ReturnType<typeof editarSucursalAction>>;
    let resolver: (v: ResultadoEditar) => void = () => {};
    mockEditar.mockImplementationOnce(() => new Promise<ResultadoEditar>((r) => (resolver = r)));
    montar();
    const dialogo = await abrirEditar(2);
    escribir(dialogo, "Dirección", "Av. Nueva 9");

    await confirmar(dialogo, "Guardar cambios");

    expect(within(dialogo).getByRole("button", { name: "Guardar cambios" })).toBeDisabled();
    expect(fila(2)).toHaveTextContent("Calle 2");
    expect(mockTodas).not.toHaveBeenCalled();
    fireEvent.click(within(dialogo).getByRole("button", { name: "Guardar cambios" }));
    expect(mockEditar).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolver({ ok: true, data: { ...gestionable(NORTE), cambio: true } });
    });
  });

  it("on a conflict shows the message, reloads the list and never retries; the next attempt carries the new version", async () => {
    mockEditar.mockResolvedValueOnce({
      ok: false,
      error: { code: "TEN_CONCURRENCIA_CONFLICTO", message: "x" },
    });
    mockTodas.mockResolvedValue({ ok: true, data: [CENTRAL, { ...NORTE, version: 5 }] });
    montar();
    const dialogo = await abrirEditar(2);
    escribir(dialogo, "Dirección", "Av. Nueva 9");

    await confirmar(dialogo, "Guardar cambios");

    expect(within(screen.getByRole("dialog")).getByRole("alert")).toHaveTextContent(
      messageFor("TEN_CONCURRENCIA_CONFLICTO"),
    );
    expect(mockTodas).toHaveBeenCalledTimes(1);
    expect(mockEditar).toHaveBeenCalledTimes(1);
    // What the person typed survives the reload.
    expect(within(dialogo).getByLabelText("Dirección")).toHaveValue("Av. Nueva 9");

    mockEditar.mockResolvedValueOnce({ ok: true, data: { ...gestionable(NORTE), cambio: true } });
    await confirmar(screen.getByRole("dialog"), "Guardar cambios");

    expect(mockEditar).toHaveBeenCalledTimes(2);
    expect(mockEditar).toHaveBeenLastCalledWith(expect.objectContaining({ versionEsperada: 5 }));
  });
});

describe("refusals (S9)", () => {
  const MENSAJE_VALIDACION = "Datos de entrada inválidos";

  it.each([
    ["TEN_SUCURSAL_NOMBRE_DUPLICADO", messageFor("TEN_SUCURSAL_NOMBRE_DUPLICADO")],
    ["TEN_SUCURSAL_NO_VALIDA", messageFor("TEN_SUCURSAL_NO_VALIDA")],
    ["TEN_OPS_NO_AUTORIZADO", messageFor("TEN_OPS_NO_AUTORIZADO")],
    ["TEN_CONCURRENCIA_CONFLICTO", messageFor("TEN_CONCURRENCIA_CONFLICTO")],
    ["VALIDATION_ERROR", MENSAJE_VALIDACION],
  ] as const)("create keeps the dialog open and shows the message of %s", async (codigo, esperado) => {
    mockCrear.mockResolvedValue({ ok: false, error: { code: codigo, message: MENSAJE_VALIDACION } });
    montar();
    const dialogo = await abrirCrear();
    llenar(dialogo, "Sucursal Sur", "Av. Sur 3", "809-555-0003");

    await confirmar(dialogo, "Crear sucursal");

    const abierto = screen.getByRole("dialog");
    expect(within(abierto).getByRole("alert")).toHaveTextContent(esperado);
    expect(esperado).not.toBe("");
    // The person can fix and retry: confirm is enabled again.
    expect(within(abierto).getByRole("button", { name: "Crear sucursal" })).toBeEnabled();
  });

  it.each([
    ["TEN_SUCURSAL_NOMBRE_DUPLICADO", messageFor("TEN_SUCURSAL_NOMBRE_DUPLICADO")],
    ["TEN_SUCURSAL_NO_VALIDA", messageFor("TEN_SUCURSAL_NO_VALIDA")],
    ["TEN_OPS_NO_AUTORIZADO", messageFor("TEN_OPS_NO_AUTORIZADO")],
    ["VALIDATION_ERROR", MENSAJE_VALIDACION],
  ] as const)("edit keeps the dialog open and shows the message of %s", async (codigo, esperado) => {
    mockEditar.mockResolvedValue({ ok: false, error: { code: codigo, message: MENSAJE_VALIDACION } });
    montar();
    const dialogo = await abrirEditar(2);
    escribir(dialogo, "Nombre", "Sucursal Central ");

    await confirmar(dialogo, "Guardar cambios");

    expect(within(screen.getByRole("dialog")).getByRole("alert")).toHaveTextContent(esperado);
    expect(mockTodas).not.toHaveBeenCalled();
  });

  it("the duplicate message says that inactive branches count", () => {
    expect(messageFor("TEN_SUCURSAL_NOMBRE_DUPLICADO")).toMatch(/inactivas también cuentan/);
  });

  it("shows a generic message and keeps the dialog open when the action throws", async () => {
    mockCrear.mockRejectedValue(new Error("network"));
    montar();
    const dialogo = await abrirCrear();
    llenar(dialogo, "Sucursal Sur", "Av. Sur 3", "809-555-0003");

    await confirmar(dialogo, "Crear sucursal");

    expect(within(screen.getByRole("dialog")).getByRole("alert")).toHaveTextContent(
      "No se pudo completar la acción. Intente de nuevo.",
    );
    expect(mockTodas).not.toHaveBeenCalled();
  });

  it("after an ok write whose re-read fails, shows the failure and keeps the old rows (no fabricated state)", async () => {
    mockCrear.mockResolvedValue({ ok: true, data: gestionable(NUEVA) });
    mockTodas.mockRejectedValue(new Error("boom"));
    montar();
    const dialogo = await abrirCrear();
    llenar(dialogo, "Sucursal Sur", "Av. Sur 3", "809-555-0003");

    await confirmar(dialogo, "Crear sucursal");

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("No se pudieron cargar las sucursales. Intente de nuevo."),
    );
    expect(screen.queryByTestId("sucursal-fila-3")).not.toBeInTheDocument();
  });
});

describe("tab navigation keeps the server branch list in sync (review R3)", () => {
  it("shows the branches after switching from the Usuarios tab (which had none) to Sucursales", () => {
    const props = {
      filtrosIniciales: { busqueda: "", activo: "" as const },
      usuarios: null,
      configuracion: null,
      puedeGestionar: true,
      sesionUsuarioId: 99,
      sesionSucursalId: 1,

      roles: null,

      empresaNombre: "Empresa Demo",
    };
    const { rerender } = render(<AdministracionScreen tab="usuarios" sucursales={null} {...props} />);

    rerender(
      <AdministracionScreen
        tab="sucursales"
        sucursales={{ ok: true, data: [CENTRAL, NORTE] }}
        {...props}
      />,
    );

    expect(screen.getByTestId(`sucursal-fila-${CENTRAL.id}`)).toBeInTheDocument();
    expect(screen.getByTestId(`sucursal-fila-${NORTE.id}`)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Nueva sucursal" })).toBeInTheDocument();
  });

  it("a newer server list replaces a list re-read after a write", async () => {
    const props = {
      filtrosIniciales: { busqueda: "", activo: "" as const },
      usuarios: null,
      configuracion: null,
      puedeGestionar: true,
      sesionUsuarioId: 99,
      sesionSucursalId: 1,

      roles: null,

      empresaNombre: "Empresa Demo",
    };
    const { rerender } = render(
      <AdministracionScreen tab="sucursales" sucursales={{ ok: true, data: [CENTRAL] }} {...props} />,
    );
    rerender(
      <AdministracionScreen
        tab="sucursales"
        sucursales={{ ok: true, data: [CENTRAL, NORTE] }}
        {...props}
      />,
    );

    expect(screen.getByTestId(`sucursal-fila-${NORTE.id}`)).toBeInTheDocument();
  });
});
