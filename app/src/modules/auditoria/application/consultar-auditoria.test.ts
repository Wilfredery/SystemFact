/**
 * Unit — consultarAuditoriaConOpciones use case (Board 09 slice B, S3/S4/S7b).
 * The admin gate and the filter normalisation run BEFORE any read or option query.
 */

import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import { AUDITORIA_NO_AUTORIZADO, AUDITORIA_VALIDACION } from "../domain/errors";
import { consultarAuditoriaConOpciones } from "./consultar-auditoria";

const tx = {} as unknown as PrismaTx;
const admin: TenantCtx = { empresaId: 1, sucursalId: 2, usuarioId: 3, esAdmin: true };

type Sucursales = readonly { id: number; nombre: string; activa: boolean }[];

type RespuestaSucursales =
  | {
      ok: true;
      sucursales: readonly {
        id: number;
        nombre: string;
        direccion: string;
        telefono: string;
        activa: boolean;
        version: number;
      }[];
    }
  | { ok: false; code: "TEN_OPS_NO_AUTORIZADO"; message: string };

function deps() {
  const listarSucursales = jest.fn<Promise<RespuestaSucursales>, [TenantCtx, PrismaTx]>(
    async () => ({
      ok: true,
      sucursales: [
        { id: 4, nombre: "Norte", direccion: "d", telefono: "t", activa: false, version: 9 },
      ],
    }),
  );
  const consultarConOpciones = jest.fn(
    async (_tx: PrismaTx, _ctx: TenantCtx, _f: unknown, leer: () => Promise<Sucursales>) => ({
      filas: [],
      total: 0,
      opciones: { usuarios: [], sucursales: await leer() },
    }),
  );
  return { listarSucursales, consultarConOpciones };
}

describe("consultarAuditoriaConOpciones", () => {
  it("refuses a non-admin with AUDITORIA_NO_AUTORIZADO and touches nothing", async () => {
    const d = deps();
    const r = await consultarAuditoriaConOpciones(tx, { ...admin, esAdmin: false }, {}, d);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe(AUDITORIA_NO_AUTORIZADO);
    expect(d.consultarConOpciones).not.toHaveBeenCalled();
    expect(d.listarSucursales).not.toHaveBeenCalled();
  });

  it("rejects an invalid filter before any read or option query", async () => {
    const d = deps();
    const r = await consultarAuditoriaConOpciones(tx, admin, { accion: "BORRAR" }, d);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe(AUDITORIA_VALIDACION);
    expect(d.consultarConOpciones).not.toHaveBeenCalled();
    expect(d.listarSucursales).not.toHaveBeenCalled();
  });

  it("returns { pagina, opciones } with branches reduced to { id, nombre, activa }", async () => {
    const d = deps();
    const r = await consultarAuditoriaConOpciones(tx, admin, { page: 2 }, d);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.pagina.page).toBe(2);
    expect(r.data.opciones.sucursales).toEqual([{ id: 4, nombre: "Norte", activa: false }]);
    expect(d.listarSucursales).toHaveBeenCalledWith(admin, tx);
  });

  it("fails closed when the branch reader refuses", async () => {
    const d = deps();
    d.listarSucursales.mockResolvedValueOnce({
      ok: false,
      code: "TEN_OPS_NO_AUTORIZADO",
      message: "x",
    });
    const r = await consultarAuditoriaConOpciones(tx, admin, {}, d);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe(AUDITORIA_NO_AUTORIZADO);
  });
});
