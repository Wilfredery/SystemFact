import {
  categoriaByIdEnEmpresa,
  existeNombreEnEmpresa,
  tieneProductosActivos,
  categoriaPerteneceAEmpresa,
  listarCategoriasEnEmpresa,
  crearCategoriaEnTx,
} from "./categoria-repository";
import { NOMBRE_CATEGORIA_DUPLICADO } from "../domain/errors";
import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";

// The generated Prisma client is ESM-only; tests replace it with the minimal
// runtime surface the repository actually touches (actions.test.ts precedent).
jest.mock("@/generated/prisma/client", () => ({
  Prisma: {
    // Mirrors the real constructor shape: (message, { code, meta }).
    PrismaClientKnownRequestError: class PrismaClientKnownRequestError {
      code: string;
      meta?: Record<string, unknown>;
      constructor(
        message: string,
        args: { code: string; meta?: Record<string, unknown> },
      ) {
        this.code = args.code;
        this.meta = args.meta;
      }
    },
  },
  AccionAuditoria: {
    CREAR: "CREAR",
    ACTUALIZAR: "ACTUALIZAR",
    CANCELAR: "CANCELAR",
    LEER: "LEER",
  },
}));

import { Prisma } from "@/generated/prisma/client";

const ctx: TenantCtx = {
  empresaId: 1,
  sucursalId: 1,
  usuarioId: 1,
  esAdmin: true,
};

function makeTx(overrides: Record<string, unknown> = {}): PrismaTx {
  return {
    categoria: {
      findFirst: jest.fn().mockResolvedValue(null),
      findUnique: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    producto: {
      count: jest.fn().mockResolvedValue(0),
    },
    ...overrides,
  } as unknown as PrismaTx;
}

describe("categoria-repository", () => {
  describe("categoriaByIdEnEmpresa", () => {
    it("returns null for a wrong-tenant id and filters by empresaId", async () => {
      const tx = makeTx();
      const result = await categoriaByIdEnEmpresa(tx, 999, 1);

      expect(result).toBeNull();
      expect(tx.categoria.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: 1, empresaId: 999 }),
        }),
      );
    });

    it("maps a tenant-owned row to the domain entity", async () => {
      const tx = makeTx();
      (tx.categoria.findFirst as jest.Mock).mockResolvedValue({
        id: 1,
        empresaId: 1,
        nombre: "Zapatos",
        activa: true,
        version: 2,
      });

      const result = await categoriaByIdEnEmpresa(tx, 1, 1);
      expect(result).toEqual({
        id: 1,
        empresaId: 1,
        nombre: "Zapatos",
        activa: true,
        version: 2,
      });
    });
  });

  describe("existeNombreEnEmpresa", () => {
    it("returns true for an active duplicate name in the tenant", async () => {
      const tx = makeTx();
      (tx.categoria.findFirst as jest.Mock).mockResolvedValue({ id: 7 });

      const result = await existeNombreEnEmpresa(tx, 1, "Zapatos");
      expect(result).toBe(true);
      // Only ACTIVE rows block reuse: the partial UK releases deactivated names.
      expect(tx.categoria.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            empresaId: 1,
            nombre: "Zapatos",
            activa: true,
          }),
        }),
      );
    });

    it("excludes the edited row when an id is given", async () => {
      const tx = makeTx();
      await existeNombreEnEmpresa(tx, 1, "Zapatos", 5);
      expect(tx.categoria.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: { not: 5 } }),
        }),
      );
    });
  });

  describe("tieneProductosActivos", () => {
    it("returns true when an active product references the category", async () => {
      const tx = makeTx();
      (tx.producto.count as jest.Mock).mockResolvedValue(1);

      const result = await tieneProductosActivos(tx, 1, 3);
      expect(result).toBe(true);
      expect(tx.producto.count).toHaveBeenCalledWith({
        where: { categoriaId: 3, empresaId: 1, activo: true },
      });
    });

    it("returns false when no active product references it", async () => {
      const tx = makeTx();
      expect(await tieneProductosActivos(tx, 1, 3)).toBe(false);
    });
  });

  describe("categoriaPerteneceAEmpresa (relocated from producto)", () => {
    it("returns false for a foreign tenant", async () => {
      const tx = makeTx();
      (tx.categoria.findUnique as jest.Mock).mockResolvedValue({
        empresaId: 2,
      });
      expect(await categoriaPerteneceAEmpresa(tx, 1, 4)).toBe(false);
    });

    it("returns true for the owning tenant and false for a missing id", async () => {
      const tx = makeTx();
      (tx.categoria.findUnique as jest.Mock).mockResolvedValue({
        empresaId: 1,
      });
      expect(await categoriaPerteneceAEmpresa(tx, 1, 4)).toBe(true);
      (tx.categoria.findUnique as jest.Mock).mockResolvedValue(null);
      expect(await categoriaPerteneceAEmpresa(tx, 1, 404)).toBe(false);
    });
  });

  describe("listarCategoriasEnEmpresa", () => {
    it("defaults to active-only, tenant-filtered, nombre-ordered pages", async () => {
      const tx = makeTx();
      await listarCategoriasEnEmpresa(tx, ctx, { page: 2, limit: 25 });
      const args = (tx.categoria.findMany as jest.Mock).mock.calls[0][0];
      expect(args.where).toEqual({ empresaId: 1, activa: true });
      expect(args.orderBy).toEqual({ nombre: "asc" });
      expect(args.skip).toBe(25);
      expect(args.take).toBe(25);
    });

    it("drops the activa filter when incluirInactivas is set", async () => {
      const tx = makeTx();
      await listarCategoriasEnEmpresa(tx, ctx, {
        page: 1,
        limit: 25,
        incluirInactivas: true,
      });
      const args = (tx.categoria.findMany as jest.Mock).mock.calls[0][0];
      expect(args.where).toEqual({ empresaId: 1 });
    });
  });

  describe("crearCategoriaEnTx", () => {
    it("maps a P2002 on nombre to the duplicate-name domain error", async () => {
      const tx = makeTx();
      (tx.categoria.create as jest.Mock).mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
          code: "P2002",
          meta: { target: ["nombre"] },
          clientVersion: "0.0.0-test",
        }),
      );

      await expect(crearCategoriaEnTx(tx, ctx, "Zapatos")).rejects.toMatchObject({
        code: NOMBRE_CATEGORIA_DUPLICADO,
      });
    });
  });
});
