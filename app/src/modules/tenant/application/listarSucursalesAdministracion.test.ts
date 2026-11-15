import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "../domain/tenant";
import { TEN_OPS_NO_AUTORIZADO, messageFor } from "../domain/errors";
import { listarSucursalesAdministracion } from "./listarSucursalesAdministracion";

const ctx: TenantCtx = { empresaId: 4, sucursalId: 1, usuarioId: 2, esAdmin: true };
const tx = {} as unknown as PrismaTx;

const SUCURSALES = [
  { id: 1, nombre: "Matriz", direccion: "A", telefono: "1", activa: true, version: 1 },
  { id: 2, nombre: "Cerrada", direccion: "B", telefono: "2", activa: false, version: 5 },
];

describe("listarSucursalesAdministracion", () => {
  it("returns every branch (active and inactive) of the SESSION empresa for an admin", async () => {
    const lector = jest.fn().mockResolvedValue(SUCURSALES);

    const result = await listarSucursalesAdministracion(ctx, tx, {
      listarSucursalesConEstadoEnTx: lector,
    });

    expect(result).toEqual({ ok: true, sucursales: SUCURSALES });
    expect(lector).toHaveBeenCalledWith(tx, 4);
  });

  it("refuses a non-admin BEFORE any read", async () => {
    const lector = jest.fn();

    const result = await listarSucursalesAdministracion({ ...ctx, esAdmin: false }, tx, {
      listarSucursalesConEstadoEnTx: lector,
    });

    expect(result).toEqual({
      ok: false,
      code: TEN_OPS_NO_AUTORIZADO,
      message: messageFor(TEN_OPS_NO_AUTORIZADO),
    });
    expect(lector).not.toHaveBeenCalled();
  });
});
