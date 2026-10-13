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

import { redirect } from "next/navigation";
import { loginWithCredenciales } from "@/modules/auth/infrastructure/auth-service";

const loginWithCredencialesMock = loginWithCredenciales as unknown as jest.Mock;
const redirectMock = redirect as unknown as jest.Mock;

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
