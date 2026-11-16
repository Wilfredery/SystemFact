/**
 * Unit tests — `editarTasasItbisAction` boundary (feature itbis-tasas-edit).
 *
 * Pins the application-layer authorization on the rate-list write: the
 * Administrador role check runs INSIDE the tenant transaction, a refusal
 * short-circuits before the use case, and transport/session/validation shapes
 * map to their stable codes. The database RLS wall
 * (`configempresa_insert/update`, migration
 * 20261116100000_configempresa_writes_admin_only) is proven separately by
 * `src/integration/configempresa-rls-writes.integration.test.ts`.
 *
 * Follow-up of the Judgment Day ledger on v0.35.0 (odd/tasks/
 * itbis-tasas-edit.md L3): until this file existed, removing the role gate
 * kept the whole suite green.
 */

import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import { editarTasasItbisAction } from "./actions.configuracion";
import { guardarTasasItbis } from "../application/gestion-configuracion";
import { tieneRolPermitidoEnTx } from "../infrastructure/usuario-repository";

jest.mock("@/lib/supabase/client", () => ({ createClient: jest.fn() }));
jest.mock("@/modules/tenant/infrastructure/tenant-runtime", () => ({
  getCurrentTenantContext: jest.fn(),
}));
jest.mock("@/modules/tenant/infrastructure/withTenantTransaction", () => ({
  withTenantTransaction: jest.fn(),
}));
jest.mock("../infrastructure/usuario-repository", () => ({
  tieneRolPermitidoEnTx: jest.fn(),
}));
jest.mock("../application/gestion-configuracion", () => ({
  guardarTasasItbis: jest.fn(),
}));

const ctx: TenantCtx = {
  empresaId: 1,
  sucursalId: 2,
  usuarioId: 3,
  esAdmin: true,
};
const tx = {} as unknown as PrismaTx;

beforeEach(() => {
  jest.clearAllMocks();
  const { getCurrentTenantContext } = jest.requireMock(
    "@/modules/tenant/infrastructure/tenant-runtime",
  ) as { getCurrentTenantContext: jest.Mock };
  getCurrentTenantContext.mockResolvedValue(ctx);
  const { withTenantTransaction } = jest.requireMock(
    "@/modules/tenant/infrastructure/withTenantTransaction",
  ) as { withTenantTransaction: jest.Mock };
  withTenantTransaction.mockImplementation(
    (_ctx: TenantCtx, fn: (t: PrismaTx) => unknown) => fn(tx),
  );
  (tieneRolPermitidoEnTx as jest.Mock).mockResolvedValue(true);
});

describe("editarTasasItbisAction", () => {
  it("refuses a malformed transport shape with VALIDATION_ERROR before any read", async () => {
    const r = await editarTasasItbisAction({ valor: 42 });
    expect(!r.ok && r.error.code).toBe("VALIDATION_ERROR");
    expect(tieneRolPermitidoEnTx).not.toHaveBeenCalled();
    expect(guardarTasasItbis).not.toHaveBeenCalled();
  });

  it("refuses an invalid session with SESION_INVALIDA", async () => {
    const { getCurrentTenantContext } = jest.requireMock(
      "@/modules/tenant/infrastructure/tenant-runtime",
    ) as { getCurrentTenantContext: jest.Mock };
    getCurrentTenantContext.mockResolvedValue(null);
    const r = await editarTasasItbisAction({ valor: "18,16,0" });
    expect(!r.ok && r.error.code).toBe("SESION_INVALIDA");
    expect(tieneRolPermitidoEnTx).not.toHaveBeenCalled();
    expect(guardarTasasItbis).not.toHaveBeenCalled();
  });

  it("THE GATE: refuses a non-Administrador with TEN_OPS_NO_AUTORIZADO before the use case", async () => {
    (tieneRolPermitidoEnTx as jest.Mock).mockResolvedValue(false);
    const r = await editarTasasItbisAction({ valor: "18,16,0" });
    expect(!r.ok && r.error.code).toBe("TEN_OPS_NO_AUTORIZADO");
    // The role check ran INSIDE the tenant transaction, against the session's
    // own ids (UI hiding is not the control).
    expect(tieneRolPermitidoEnTx).toHaveBeenCalledWith(
      tx,
      ctx.usuarioId,
      ctx.empresaId,
      ["Administrador"],
    );
    expect(guardarTasasItbis).not.toHaveBeenCalled();
  });

  it("delegates to the use case with the session context when authorized", async () => {
    (guardarTasasItbis as jest.Mock).mockResolvedValue({
      ok: true,
      data: { valor: "18,16,0", vigenciaInicio: "x", cambioAplicado: true },
    });
    const r = await editarTasasItbisAction({ valor: "18,16,0" });
    expect(r.ok).toBe(true);
    expect(guardarTasasItbis).toHaveBeenCalledWith(tx, ctx, "18,16,0");
  });

  it("passes the use case's typed refusal through verbatim", async () => {
    (guardarTasasItbis as jest.Mock).mockResolvedValue({
      ok: false,
      code: "TEN_TASA_ITBIS_INVALIDA",
      message: "La lista de tasas de ITBIS no es válida",
    });
    const r = await editarTasasItbisAction({ valor: "18,,16" });
    expect(!r.ok && r.error.code).toBe("TEN_TASA_ITBIS_INVALIDA");
    expect(!r.ok && r.error.message).toBe("La lista de tasas de ITBIS no es válida");
  });
});
