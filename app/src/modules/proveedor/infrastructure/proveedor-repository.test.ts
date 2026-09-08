import {
  proveedorByIdEnEmpresa,
  existeRncEnEmpresa,
  tieneComprasNoCanceladas,
  crearProveedorEnTx,
  registrarAuditProveedorEnTx,
  listarProveedoresEnEmpresa,
} from "./proveedor-repository";
import { RNC_PROVEEDOR_DUPLICADO } from "../domain/errors";
import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";

// The generated Prisma client is ESM-only; tests replace it with the minimal
// runtime surface the repository actually touches (categoria precedent).
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
  },
  EstadoCompra: {
    BORRADOR: "BORRADOR",
    PENDIENTE: "PENDIENTE",
    RECIBIDA: "RECIBIDA",
    PAGADA: "PAGADA",
    CANCELADA: "CANCELADA",
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
    proveedor: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    compra: {
      count: jest.fn().mockResolvedValue(0),
    },
    movimientoAuditoria: {
      create: jest.fn().mockResolvedValue({}),
    },
    ...overrides,
  } as unknown as PrismaTx;
}

describe("proveedor-repository", () => {
  describe("proveedorByIdEnEmpresa", () => {
    it("PRV-ISO-A: returns null for a wrong-tenant id and filters by empresaId", async () => {
      const tx = makeTx();
      const result = await proveedorByIdEnEmpresa(tx, 999, 1);

      expect(result).toBeNull();
      expect(tx.proveedor.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: 1, empresaId: 999 }),
        }),
      );
    });

    it("maps a tenant-owned row to the domain entity", async () => {
      const tx = makeTx();
      (tx.proveedor.findFirst as jest.Mock).mockResolvedValue({
        id: 3,
        empresaId: 1,
        nombre: "Distribuidora Norte",
        contacto: "Juan Pérez",
        telefono: "809-555-1212",
        rnc: "138000001",
        tipoProveedor: "FORMAL",
        tipoPersona: "JURIDICA",
        activo: true,
        version: 2,
      });

      expect(await proveedorByIdEnEmpresa(tx, 1, 3)).toEqual({
        id: 3,
        empresaId: 1,
        nombre: "Distribuidora Norte",
        contacto: "Juan Pérez",
        telefono: "809-555-1212",
        rnc: "138000001",
        tipoProveedor: "FORMAL",
        tipoPersona: "JURIDICA",
        activo: true,
        version: 2,
      });
    });
  });

  describe("existeRncEnEmpresa", () => {
    it("PRV-RNC-B: returns true for an active duplicate RNC in the tenant", async () => {
      const tx = makeTx();
      (tx.proveedor.findFirst as jest.Mock).mockResolvedValue({ id: 7 });

      const result = await existeRncEnEmpresa(tx, 1, "138000001");
      expect(result).toBe(true);
      // Only ACTIVE rows block reuse: the partial UK releases deactivated RNCs.
      expect(tx.proveedor.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            empresaId: 1,
            rnc: "138000001",
            activo: true,
          }),
        }),
      );
    });

    it("PRV-RNC-C: a null RNC skips the probe entirely (nulls repeat freely)", async () => {
      const tx = makeTx();
      expect(await existeRncEnEmpresa(tx, 1, null)).toBe(false);
      expect(tx.proveedor.findFirst).not.toHaveBeenCalled();
    });

    it("excludes the edited row when an id is given", async () => {
      const tx = makeTx();
      await existeRncEnEmpresa(tx, 1, "138000001", 5);
      expect(tx.proveedor.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: { not: 5 } }),
        }),
      );
    });
  });

  describe("tieneComprasNoCanceladas", () => {
    it("PRV-GUARD-A: returns true when a non-cancelled Compra references the supplier", async () => {
      const tx = makeTx();
      (tx.compra.count as jest.Mock).mockResolvedValue(1);

      const result = await tieneComprasNoCanceladas(tx, 1, 4);
      expect(result).toBe(true);
      expect(tx.compra.count).toHaveBeenCalledWith({
        where: {
          proveedorId: 4,
          empresaId: 1,
          estado: { not: "CANCELADA" },
        },
      });
    });

    it("returns false when only cancelled purchases or none exist", async () => {
      const tx = makeTx();
      expect(await tieneComprasNoCanceladas(tx, 1, 4)).toBe(false);
    });
  });

  describe("crearProveedorEnTx", () => {
    it("PRV-RNC-D: maps a P2002 on the partial RNC UK to the duplicate domain error", async () => {
      const tx = makeTx();
      (tx.proveedor.create as jest.Mock).mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
          code: "P2002",
          meta: { target: ["rnc"] },
          clientVersion: "0.0.0-test",
        }),
      );

      await expect(
        crearProveedorEnTx(tx, ctx, {
          nombre: "Distribuidora Norte",
          contacto: "Juan Pérez",
          telefono: "809-555-1212",
          rnc: "138000001",
          tipoProveedor: "FORMAL",
          tipoPersona: "JURIDICA",
        }),
      ).rejects.toMatchObject({ code: RNC_PROVEEDOR_DUPLICADO });
    });
  });

  describe("listarProveedoresEnEmpresa", () => {
    it("PRV-LIST-A: defaults to active-only, tenant-filtered, nombre-ordered pages", async () => {
      const tx = makeTx();
      await listarProveedoresEnEmpresa(tx, ctx, { page: 2, limit: 25 });
      const args = (tx.proveedor.findMany as jest.Mock).mock.calls[0][0];
      expect(args.where).toEqual({ empresaId: 1, activo: true });
      expect(args.orderBy).toEqual({ nombre: "asc" });
      expect(args.skip).toBe(25);
      expect(args.take).toBe(25);
    });

    it("PRV-LIST-B: buscar matches nombre or digits-only rnc and drops the activa filter when asked", async () => {
      const tx = makeTx();
      await listarProveedoresEnEmpresa(tx, ctx, {
        page: 1,
        limit: 25,
        buscar: "1-3800",
        incluirInactivos: true,
      });
      const args = (tx.proveedor.findMany as jest.Mock).mock.calls[0][0];
      expect(args.where).toEqual({
        empresaId: 1,
        OR: [
          { nombre: { contains: "1-3800", mode: "insensitive" } },
          { rnc: { contains: "13800" } },
        ],
      });
    });
  });

  describe("registrarAuditProveedorEnTx", () => {
    it("appends CREAR / ACTUALIZAR / CANCELAR rows for entity Proveedor", async () => {
      const tx = makeTx();
      await registrarAuditProveedorEnTx(tx, ctx, "CREAR", 9, null, { id: 9 });
      await registrarAuditProveedorEnTx(tx, ctx, "ACTUALIZAR", 9, { nombre: "A" }, { nombre: "B" });
      await registrarAuditProveedorEnTx(tx, ctx, "CANCELAR", 9, { activo: true }, { activo: false }, "proveedor.desactivado");

      const mov = tx.movimientoAuditoria as unknown as { create: jest.Mock };
      expect(mov.create).toHaveBeenCalledTimes(3);
      expect(mov.create).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          data: expect.objectContaining({
            empresaId: 1,
            usuarioId: 1,
            accion: "CREAR",
            entidad: "Proveedor",
            idEntidad: "9",
            valorAnterior: null,
            valorNuevo: JSON.stringify({ id: 9 }),
          }),
        }),
      );
      const cancelar = (mov.create.mock.calls[2][0] as { data: Record<string, unknown> }).data;
      expect(cancelar.accion).toBe("CANCELAR");
      expect(cancelar.valorAnterior).toBe(JSON.stringify({ activo: true }));
      expect(cancelar.motivo).toBe("proveedor.desactivado");
    });
  });
});
