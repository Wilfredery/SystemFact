/**
 * Usuario listing repository — `where`/`select` shape with a fake tx (no DB).
 *
 * Pins the two rules the screen depends on:
 *   - S5: the branch scope comes from RLS (`usuario_select`), so the query pins
 *     `empresaId` ONLY. Adding a `sucursalId` predicate here would silently
 *     become the authority on who is listed — and would have to be undone
 *     the day the company-wide policy exists.
 *   - S4: page and count share the SAME `where`, the search is a trimmed
 *     case-insensitive OR over nombreUsuario/nombre, and `activo` is optional.
 */

import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import {
  contarUsuariosEnTx,
  listarUsuariosEnTx,
  tieneRolPermitidoEnTx,
} from "./usuario-repository";

const ctx: TenantCtx = {
  empresaId: 1,
  sucursalId: 2,
  usuarioId: 3,
  esAdmin: true,
};

function makeTx(rows: unknown[] = []): PrismaTx {
  return {
    usuario: {
      findMany: jest.fn().mockResolvedValue(rows),
      count: jest.fn().mockResolvedValue(rows.length),
      findUnique: jest.fn().mockResolvedValue(null),
    },
  } as unknown as PrismaTx;
}

describe("listarUsuariosEnTx", () => {
  it("pins empresaId only — no sucursalId predicate (S5: RLS owns the branch scope)", async () => {
    const tx = makeTx();
    await listarUsuariosEnTx(tx, ctx, { offset: 0, limit: 25 });

    const args = (tx.usuario.findMany as jest.Mock).mock.calls[0][0];
    expect(args.where).toEqual({ empresaId: 1 });
    expect(args.where).not.toHaveProperty("sucursalId");
  });

  it("pages with skip/take and orders deterministically by nombreUsuario", async () => {
    const tx = makeTx();
    await listarUsuariosEnTx(tx, ctx, { offset: 50, limit: 25 });

    const args = (tx.usuario.findMany as jest.Mock).mock.calls[0][0];
    expect(args.skip).toBe(50);
    expect(args.take).toBe(25);
    expect(args.orderBy).toEqual({ nombreUsuario: "asc" });
  });

  it("joins SUCURSAL name and USUARIO_ROL → ROL names (explicit select, no full include)", async () => {
    const tx = makeTx();
    await listarUsuariosEnTx(tx, ctx, { offset: 0, limit: 25 });

    const args = (tx.usuario.findMany as jest.Mock).mock.calls[0][0];
    expect(args.select).toEqual({
      id: true,
      nombreUsuario: true,
      nombre: true,
      activo: true,
      version: true,
      sucursal: { select: { nombre: true } },
      roles: { select: { rol: { select: { id: true, nombre: true } } } },
    });
  });

  it("adds an insensitive OR over nombreUsuario/nombre for the search term", async () => {
    const tx = makeTx();
    await listarUsuariosEnTx(tx, ctx, {
      offset: 0,
      limit: 25,
      buscar: "  Maria ",
    });

    const args = (tx.usuario.findMany as jest.Mock).mock.calls[0][0];
    expect(args.where).toEqual({
      empresaId: 1,
      OR: [
        { nombreUsuario: { contains: "Maria", mode: "insensitive" } },
        { nombre: { contains: "Maria", mode: "insensitive" } },
      ],
    });
  });

  it("ignores a blank search term instead of matching everything by accident", async () => {
    const tx = makeTx();
    await listarUsuariosEnTx(tx, ctx, { offset: 0, limit: 25, buscar: "   " });

    const args = (tx.usuario.findMany as jest.Mock).mock.calls[0][0];
    expect(args.where).toEqual({ empresaId: 1 });
  });

  it("applies the activo filter for BOTH true and false", async () => {
    const activos = makeTx();
    await listarUsuariosEnTx(activos, ctx, { offset: 0, limit: 25, activo: true });
    expect((activos.usuario.findMany as jest.Mock).mock.calls[0][0].where).toEqual({
      empresaId: 1,
      activo: true,
    });

    const inactivos = makeTx();
    await listarUsuariosEnTx(inactivos, ctx, {
      offset: 0,
      limit: 25,
      activo: false,
    });
    expect((inactivos.usuario.findMany as jest.Mock).mock.calls[0][0].where).toEqual({
      empresaId: 1,
      activo: false,
    });
  });

  it("maps joined rows to the listing shape (roles flattened to names)", async () => {
    const tx = makeTx([
      {
        id: 7,
        nombreUsuario: "maria",
        nombre: "María Pérez",
        activo: true,
        version: 4,
        sucursal: { nombre: "Matriz" },
        roles: [
          { rol: { id: 1, nombre: "Administrador" } },
          { rol: { id: 2, nombre: "Operador" } },
        ],
      },
    ]);
    const rows = await listarUsuariosEnTx(tx, ctx, { offset: 0, limit: 25 });

    expect(rows).toEqual([
      {
        id: 7,
        nombreUsuario: "maria",
        nombre: "María Pérez",
        activo: true,
        version: 4,
        sucursalNombre: "Matriz",
        roles: ["Administrador", "Operador"],
        rolIds: [1, 2],
      },
    ]);
    // The raw Prisma row never crosses the repository boundary.
    expect(rows[0]).not.toHaveProperty("sucursal");
  });
});

describe("contarUsuariosEnTx", () => {
  it("shares the exact same where as the page query", async () => {
    const tx = makeTx();
    await contarUsuariosEnTx(tx, ctx, { buscar: "Maria", activo: true });

    const args = (tx.usuario.count as jest.Mock).mock.calls[0][0];
    expect(args.where).toEqual({
      empresaId: 1,
      OR: [
        { nombreUsuario: { contains: "Maria", mode: "insensitive" } },
        { nombre: { contains: "Maria", mode: "insensitive" } },
      ],
      activo: true,
    });
  });
});

describe("tieneRolPermitidoEnTx", () => {
  it("is true when the usuario holds one of the named roles", async () => {
    const tx = makeTx();
    (tx.usuario.findUnique as jest.Mock).mockResolvedValue({
      roles: [{ rol: { nombre: "Administrador" } }],
    });
    await expect(
      tieneRolPermitidoEnTx(tx, 3, 1, ["Administrador"]),
    ).resolves.toBe(true);
  });

  it("is false when no listed role matches (deny by default)", async () => {
    const tx = makeTx();
    (tx.usuario.findUnique as jest.Mock).mockResolvedValue({
      roles: [{ rol: { nombre: "Operador" } }],
    });
    await expect(
      tieneRolPermitidoEnTx(tx, 3, 1, ["Administrador"]),
    ).resolves.toBe(false);
  });

  it("is false for a missing/foreign usuario", async () => {
    const tx = makeTx();
    await expect(
      tieneRolPermitidoEnTx(tx, 3, 1, ["Administrador"]),
    ).resolves.toBe(false);
  });
});
