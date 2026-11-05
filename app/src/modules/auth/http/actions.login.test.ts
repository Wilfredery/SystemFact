import { login } from "./actions.login";

jest.mock("@/lib/supabase/client", () => ({
  createClient: jest.fn().mockResolvedValue({ auth: {} }),
}));

jest.mock("@/modules/auth/infrastructure/auth-service", () => ({
  loginWithCredenciales: jest.fn(),
}));

jest.mock("next/navigation", () => ({
  redirect: jest.fn(),
}));

jest.mock("next/headers", () => ({
  headers: jest.fn(),
}));

jest.mock("@/modules/auth/application/verificar-throttle-login", () => ({
  intentarAccesoDeLogin: jest.fn(),
  registrarIntentoDeLogin: jest.fn(),
  descartarIntentoDeLogin: jest.fn(),
  registrarExitoDeLogin: jest.fn(),
}));

// The Prisma-backed store is injected by the action; the module is replaced so this
// test never touches `@/lib/prisma` (and therefore never needs server env).
jest.mock("@/modules/auth/infrastructure/login-attempt-repository", () => ({
  almacenIntentosPrisma: { marca: "almacen-falso" },
}));

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { loginWithCredenciales } from "@/modules/auth/infrastructure/auth-service";
import {
  descartarIntentoDeLogin,
  registrarExitoDeLogin,
  intentarAccesoDeLogin,
} from "@/modules/auth/application/verificar-throttle-login";
import { almacenIntentosPrisma } from "@/modules/auth/infrastructure/login-attempt-repository";
import {
  AUTH_AUTENTICACION_NO_DISPONIBLE,
  AUTH_CREDENCIALES_INVALIDAS,
  AUTH_INTENTOS_EXCEDIDOS,
  messageFor,
} from "@/modules/auth/domain/errors";

const loginWithCredencialesMock = loginWithCredenciales as unknown as jest.Mock;
const redirectMock = redirect as unknown as jest.Mock;
const headersMock = headers as unknown as jest.Mock;
const intentarAccesoMock = intentarAccesoDeLogin as unknown as jest.Mock;
const descartarIntentoMock = descartarIntentoDeLogin as unknown as jest.Mock;
const registrarExitoMock = registrarExitoDeLogin as unknown as jest.Mock;

function formData(usuario: string, password: string): FormData {
  const fd = new FormData();
  fd.set("nombreUsuario", usuario);
  fd.set("password", password);
  return fd;
}

describe("login — post-login landing branch (design D2)", () => {
  beforeEach(() => {
    jest.resetAllMocks();
    redirectMock.mockImplementation(() => undefined);
    // Default: the throttle lets the attempt through, so the pre-existing landing
    // cases keep testing the landing decision and nothing else.
    headersMock.mockResolvedValue(
      new Headers({ "x-forwarded-for": "203.0.113.7" }),
    );
    intentarAccesoMock.mockResolvedValue({ permitido: true, intentoId: 11 });
  });

  it("TEN landing: multi-branch admin goes to /selector-empresa-sucursal", async () => {
    loginWithCredencialesMock.mockResolvedValue({
      ok: true,
      esAdmin: true,
      activeBranchCount: 2,
    });

    await login({ error: null }, formData("ana", "pw"));

    expect(redirectMock).toHaveBeenCalledWith("/selector-empresa-sucursal");
  });

  it("the non-admin fast path stays /dashboard regardless of the count", async () => {
    loginWithCredencialesMock.mockResolvedValue({
      ok: true,
      esAdmin: false,
      activeBranchCount: 3,
    });

    await login({ error: null }, formData("cobrador", "pw"));

    expect(redirectMock).toHaveBeenCalledWith("/dashboard");
  });

  it("a single-branch admin goes to /dashboard (nothing to choose)", async () => {
    loginWithCredencialesMock.mockResolvedValue({
      ok: true,
      esAdmin: true,
      activeBranchCount: 1,
    });

    await login({ error: null }, formData("ana", "pw"));

    expect(redirectMock).toHaveBeenCalledWith("/dashboard");
  });

  it("a failure returns the typed message and never redirects", async () => {
    loginWithCredencialesMock.mockResolvedValue({
      ok: false,
      code: "AUTH_CREDENCIALES_INVALIDAS",
      message: "Credenciales inválidas",
      cuentaComoIntento: true,
    });

    const result = await login({ error: null }, formData("ana", "bad"));

    expect(result).toEqual({ error: "Credenciales inválidas" });
    expect(redirectMock).not.toHaveBeenCalled();
  });
});

describe("login — brute-force throttle wiring (docs/22 T3)", () => {
  beforeEach(() => {
    jest.resetAllMocks();
    redirectMock.mockImplementation(() => undefined);
    headersMock.mockResolvedValue(
      new Headers({ "x-forwarded-for": "203.0.113.7" }),
    );
    intentarAccesoMock.mockResolvedValue({ permitido: true, intentoId: 11 });
  });

  it("refuses before touching Supabase when that pair is throttled", async () => {
    intentarAccesoMock.mockResolvedValue({ permitido: false, esperarMs: 30_000 });

    const result = await login({ error: null }, formData("admin", "guess"));

    // S4 posture: the typed message, not the provider's, and not "invalid credentials".
    expect(result).toEqual({ error: messageFor(AUTH_INTENTOS_EXCEDIDOS) });
    expect(loginWithCredencialesMock).not.toHaveBeenCalled();
    // A refused attempt is not recorded either: the delay must expire on its own, and
    // counting refusals would keep the pair blocked forever.
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("records the attempt BEFORE the guess reaches the provider", async () => {
    // R3-throttle-race-window: counting first and inserting afterwards leaves the whole
    // provider round-trip as a window where a concurrent burst passes the same check.
    loginWithCredencialesMock.mockResolvedValue({
      ok: false,
      code: AUTH_CREDENCIALES_INVALIDAS,
      message: "Credenciales inválidas",
      cuentaComoIntento: true,
    });

    await login({ error: null }, formData("admin", "mala"));

    expect(intentarAccesoMock.mock.invocationCallOrder[0]).toBeLessThan(
      loginWithCredencialesMock.mock.invocationCallOrder[0] as number,
    );
  });

  it("checks the pair built from the forwarded hop and the submitted username", async () => {
    loginWithCredencialesMock.mockResolvedValue({
      ok: true,
      esAdmin: false,
      activeBranchCount: 1,
    });

    await login({ error: null }, formData("  Admin ", "buena"));

    // The zod schema trims first, so the action hands the adapter the trimmed value and
    // the application layer folds case — two different jobs, both observable here.
    expect(intentarAccesoMock).toHaveBeenCalledWith(
      "Admin",
      "203.0.113.7",
      expect.any(Number),
      almacenIntentosPrisma,
    );
  });

  it("prefers x-real-ip over the forwarded list, which a client can prepend to", async () => {
    headersMock.mockResolvedValue(
      new Headers({ "x-real-ip": "198.51.100.9", "x-forwarded-for": "1.2.3.4, 203.0.113.7" }),
    );
    loginWithCredencialesMock.mockResolvedValue({
      ok: true,
      esAdmin: false,
      activeBranchCount: 1,
    });

    await login({ error: null }, formData("admin", "buena"));

    expect(intentarAccesoMock).toHaveBeenCalledWith(
      "admin",
      "198.51.100.9",
      expect.any(Number),
      almacenIntentosPrisma,
    );
  });

  it("undoes the recorded attempt when the provider call throws", async () => {
    // R4-003: without this, a throw between the insert and the verdict leaves a row counted
    // forever as a wrong password the user never typed.
    loginWithCredencialesMock.mockRejectedValue(new Error("fetch failed"));

    await expect(login({ error: null }, formData("admin", "buena"))).rejects.toThrow("fetch failed");

    expect(descartarIntentoMock).toHaveBeenCalledWith(11, almacenIntentosPrisma);
  });

  it("falls back to x-real-ip when there is no forwarded list", async () => {
    headersMock.mockResolvedValue(new Headers({ "x-real-ip": "198.51.100.9" }));
    loginWithCredencialesMock.mockResolvedValue({
      ok: true,
      esAdmin: false,
      activeBranchCount: 1,
    });

    await login({ error: null }, formData("admin", "buena"));

    expect(intentarAccesoMock).toHaveBeenCalledWith(
      "admin",
      "198.51.100.9",
      expect.any(Number),
      almacenIntentosPrisma,
    );
  });

  it("keeps the recorded attempt when the credential is rejected", async () => {
    loginWithCredencialesMock.mockResolvedValue({
      ok: false,
      code: AUTH_CREDENCIALES_INVALIDAS,
      message: "Credenciales inválidas",
      cuentaComoIntento: true,
    });

    await login({ error: null }, formData("admin", "mala"));

    expect(intentarAccesoMock).toHaveBeenCalledWith(
      "admin",
      "203.0.113.7",
      expect.any(Number),
      almacenIntentosPrisma,
    );
    expect(descartarIntentoMock).not.toHaveBeenCalled();
    expect(registrarExitoMock).not.toHaveBeenCalled();
  });

  it("undoes the attempt when the code says 'invalid credentials' but it was NOT a guess", async () => {
    // The decoupling pin (verification round 2): the action must decide on `cuentaComoIntento`,
    // never on the code. Several refusals share the uniform AUTH_CREDENCIALES_INVALIDAS message
    // on purpose, so code-based counting would silently throttle an account whose password was
    // right. Reverting actions.login.ts to `result.code !== AUTH_CREDENCIALES_INVALIDAS` fails here.
    loginWithCredencialesMock.mockResolvedValue({
      ok: false,
      code: AUTH_CREDENCIALES_INVALIDAS,
      message: "Credenciales inválidas",
      cuentaComoIntento: false,
    });

    await login({ error: null }, formData("admin", "correcta"));

    expect(descartarIntentoMock).toHaveBeenCalledWith(11, almacenIntentosPrisma);
  });

  it("undoes the recorded attempt when the refusal was not a password guess", async () => {
    // The credentials were CORRECT here; the account is disabled. Counting it would let
    // anyone lock out a named user by replaying that user's valid password.
    loginWithCredencialesMock.mockResolvedValue({
      ok: false,
      code: "AUTH_USUARIO_INACTIVO",
      message: "inactivo",
      cuentaComoIntento: false,
    });

    await login({ error: null }, formData("admin", "correcta"));

    expect(descartarIntentoMock).toHaveBeenCalledWith(11, almacenIntentosPrisma);
  });

  it("undoes the recorded attempt during a provider outage too — nobody guessed anything", async () => {
    loginWithCredencialesMock.mockResolvedValue({
      ok: false,
      code: AUTH_AUTENTICACION_NO_DISPONIBLE,
      message: "no disponible",
      cuentaComoIntento: false,
    });

    await login({ error: null }, formData("admin", "cualquiera"));

    expect(descartarIntentoMock).toHaveBeenCalledWith(11, almacenIntentosPrisma);
  });

  it("clears the pair on a successful sign-in", async () => {
    loginWithCredencialesMock.mockResolvedValue({
      ok: true,
      esAdmin: false,
      activeBranchCount: 1,
    });

    await login({ error: null }, formData("admin", "buena"));

    expect(registrarExitoMock).toHaveBeenCalledWith("admin", "203.0.113.7", almacenIntentosPrisma);
    expect(descartarIntentoMock).not.toHaveBeenCalled();
  });
});
