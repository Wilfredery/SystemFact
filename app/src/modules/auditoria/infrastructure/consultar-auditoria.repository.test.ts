/**
 * Unit — consultar-auditoria repository shape (Board 09 slice B, S2/S3/S5/S7b).
 *
 * A fake `tx` records every call in order. The REAL-Postgres behaviour (RLS under the
 * widened branch GUC) is proven by `integration/auditoria-consulta.integration.test.ts`;
 * here we pin the query shape: relation select (names only), one findMany per read, the
 * option reader's select/pin/cap/order, and the widen → read → restore window.
 */

import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import {
  consultarAuditoriaConOpcionesEnTx,
  listarUsuariosOpcionesEnTx,
} from "./consultar-auditoria.repository";

const ctx: TenantCtx = { empresaId: 7, sucursalId: 3, usuarioId: 11, esAdmin: true };

interface Espia {
  readonly eventos: string[];
  readonly gucs: unknown[][];
  readonly findManyAud: jest.Mock;
  readonly countAud: jest.Mock;
  readonly findManyUsu: jest.Mock;
  readonly tx: PrismaTx;
}

function crearTx(opts: { falla?: boolean } = {}): Espia {
  const eventos: string[] = [];
  const gucs: unknown[][] = [];
  const executeRaw = jest.fn(async (_s: TemplateStringsArray, ...v: unknown[]) => {
    gucs.push(v);
    eventos.push(v.length === 0 ? "guc-clear" : "guc-restore");
    return 0;
  });
  const findManyAud = jest.fn(async () => {
    eventos.push("pagina");
    if (opts.falla === true) throw new Error("boom");
    return [
      {
        id: 1,
        empresaId: 7,
        sucursalId: 9,
        usuarioId: 5,
        fechaHora: new Date("2026-01-01T00:00:00Z"),
        accion: "CREAR",
        entidad: "Producto",
        idEntidad: "1",
        valorAnterior: null,
        valorNuevo: null,
        motivo: null,
        usuario: { nombreUsuario: "AB-ana", nombre: "Ana Pérez", activo: false },
        sucursal: { nombre: "Norte", activa: true },
      },
    ];
  });
  const countAud = jest.fn(async () => 1);
  const findManyUsu = jest.fn(async () => {
    eventos.push("usuarios");
    return [{ id: 5, nombreUsuario: "AB-ana", nombre: "Ana Pérez", activo: false }];
  });
  const tx = {
    $executeRaw: executeRaw,
    movimientoAuditoria: { findMany: findManyAud, count: countAud },
    usuario: { findMany: findManyUsu },
  } as unknown as PrismaTx;
  return { eventos, gucs, findManyAud, countAud, findManyUsu, tx };
}

describe("listarUsuariosOpcionesEnTx", () => {
  it("selects ONLY id/nombreUsuario/nombre/activo, pins empresaId, caps at 500, active first", async () => {
    const e = crearTx();
    const r = await listarUsuariosOpcionesEnTx(e.tx, ctx);
    expect(e.findManyUsu).toHaveBeenCalledTimes(1);
    const arg = e.findManyUsu.mock.calls[0]![0] as Record<string, unknown>;
    expect(arg.where).toEqual({ empresaId: 7 });
    expect(arg.select).toEqual({ id: true, nombreUsuario: true, nombre: true, activo: true });
    expect(arg.take).toBe(500);
    expect(arg.orderBy).toEqual([{ activo: "desc" }, { nombreUsuario: "asc" }]);
    expect(r).toEqual([{ id: 5, nombreUsuario: "AB-ana", nombre: "Ana Pérez", activo: false }]);
  });
});

describe("consultarAuditoriaConOpcionesEnTx", () => {
  it("reads page, users and branches INSIDE one widen/restore window (one findMany for the page)", async () => {
    const e = crearTx();
    const r = await consultarAuditoriaConOpcionesEnTx(e.tx, ctx, { page: 1, pageSize: 25 }, async () => {
      e.eventos.push("sucursales");
      return [{ id: 9, nombre: "Norte", activa: true }];
    });
    expect(e.eventos[0]).toBe("guc-clear");
    expect(e.eventos[e.eventos.length - 1]).toBe("guc-restore");
    expect(e.eventos.filter((x) => x === "guc-clear")).toHaveLength(1);
    expect(e.eventos.filter((x) => x === "guc-restore")).toHaveLength(1);
    expect(e.eventos).toEqual(expect.arrayContaining(["pagina", "usuarios", "sucursales"]));
    expect(e.gucs[1]).toEqual(["3"]);
    expect(e.findManyAud).toHaveBeenCalledTimes(1);
    expect(r.total).toBe(1);
    expect(r.filas[0]!.usuario).toEqual({ nombreUsuario: "AB-ana", nombre: "Ana Pérez", activo: false });
    expect(r.filas[0]!.sucursal).toEqual({ nombre: "Norte", activa: true });
    expect(r.opciones.usuarios).toHaveLength(1);
    expect(r.opciones.sucursales).toEqual([{ id: 9, nombre: "Norte", activa: true }]);
  });

  it("selects name fields only on the relations (never email/passwordHash/rol)", async () => {
    const e = crearTx();
    await consultarAuditoriaConOpcionesEnTx(e.tx, ctx, { page: 1, pageSize: 25 }, async () => []);
    const sel = (e.findManyAud.mock.calls[0]![0] as { select: Record<string, unknown> }).select;
    expect(sel.usuario).toEqual({ select: { nombreUsuario: true, nombre: true, activo: true } });
    expect(sel.sucursal).toEqual({ select: { nombre: true, activa: true } });
  });

  it("restores the branch GUC even when the read throws (fail closed, error propagates)", async () => {
    const e = crearTx({ falla: true });
    await expect(
      consultarAuditoriaConOpcionesEnTx(e.tx, ctx, { page: 1, pageSize: 25 }, async () => []),
    ).rejects.toThrow("boom");
    expect(e.eventos[e.eventos.length - 1]).toBe("guc-restore");
    expect(e.gucs[e.gucs.length - 1]).toEqual(["3"]);
  });
});
