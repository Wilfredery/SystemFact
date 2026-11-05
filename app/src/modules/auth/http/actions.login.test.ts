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
  verificarThrottleLogin: jest.fn(),
  registrarFalloDeLogin: jest.fn(),
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
  registrarExitoDeLogin,
  registrarFalloDeLogin,
  verificarThrottleLogin,
} from "@/modules/auth/application/verificar-throttle-login";
import { almacenIntentosPrisma } from "@/modules/auth/infrastructure/login-attempt-repository";
import {
  AUTH_CREDENCIALES_INVALIDAS,
  AUTH_INTENTOS_EXCEDIDOS,
  messageFor,
} from "@/modules/auth/domain/errors";

const loginWithCredencialesMock = loginWithCredenciales as unknown as jest.Mock;
const redirectMock = redirect as unknown as jest.Mock;
const headersMock = headers as unknown as jest.Mock;
const verificarThrottleMock = verificarThrottleLogin as unknown as jest.Mock;
const registrarFalloMock = registrarFalloDeLogin as unknown as jest.Mock;
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
      new Headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" }),
    );
    verificarThrottleMock.mockResolvedValue({ permitido: true });
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
      new Headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" }),
    );
    verificarThrottleMock.mockResolvedValue({ permitido: true });
  });

  it("refuses before touching Supabase when that pair is throttled", async () => {
    verificarThrottleMock.mockResolvedValue({ permitido: false, esperarMs: 30_000 });

    const result = await login({ error: null }, formData("admin", "guess"));

    // S4 posture: the typed message, not the provider's, and not "invalid credentials".
    expect(result).toEqual({ error: messageFor(AUTH_INTENTOS_EXCEDIDOS) });
    expect(loginWithCredencialesMock).not.toHaveBeenCalled();
    // No failed attempt is recorded for a refused attempt: the delay must expire, and
    // counting the refusal itself would make it self-sustaining.
    expect(registrarFalloMock).not.toHaveBeenCalled();
    expect(redirectMock).not.toHaveBeenCalled();
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
    expect(verificarThrottleMock).toHaveBeenCalledWith(
      "Admin",
      "203.0.113.7",
      expect.any(Number),
      almacenIntentosPrisma,
    );
  });

  it("falls back to x-real-ip when there is no forwarded list", async () => {
    headersMock.mockResolvedValue(new Headers({ "x-real-ip": "198.51.100.9" }));
    loginWithCredencialesMock.mockResolvedValue({
      ok: true,
      esAdmin: false,
      activeBranchCount: 1,
    });

    await login({ error: null }, formData("admin", "buena"));

    expect(verificarThrottleMock).toHaveBeenCalledWith(
      "admin",
      "198.51.100.9",
      expect.any(Number),
      almacenIntentosPrisma,
    );
  });

  it("counts a rejected credential as one failed attempt", async () => {
    loginWithCredencialesMock.mockResolvedValue({
      ok: false,
      code: AUTH_CREDENCIALES_INVALIDAS,
      message: "Credenciales inválidas",
    });

    await login({ error: null }, formData("admin", "mala"));

    expect(registrarFalloMock).toHaveBeenCalledWith(
      "admin",
      "203.0.113.7",
      expect.any(Number),
      almacenIntentosPrisma,
    );
    expect(registrarExitoMock).not.toHaveBeenCalled();
  });

  it("does not count a refusal that was not a password guess", async () => {
    // The credentials were CORRECT here; the account is disabled. Counting it would let
    // anyone lock out a named user by replaying that user's valid password.
    loginWithCredencialesMock.mockResolvedValue({
      ok: false,
      code: "AUTH_USUARIO_INACTIVO",
      message: "inactivo",
    });

    await login({ error: null }, formData("admin", "correcta"));

    expect(registrarFalloMock).not.toHaveBeenCalled();
  });

  it("clears the pair on a successful sign-in", async () => {
    loginWithCredencialesMock.mockResolvedValue({
      ok: true,
      esAdmin: false,
      activeBranchCount: 1,
    });

    await login({ error: null }, formData("admin", "buena"));

    expect(registrarExitoMock).toHaveBeenCalledWith("admin", "203.0.113.7", almacenIntentosPrisma);
    expect(registrarFalloMock).not.toHaveBeenCalled();
  });
});
