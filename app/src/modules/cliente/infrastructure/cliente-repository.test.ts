import {
  clienteByIdEnEmpresa,
  existeIdentificacionFiscalEnEmpresa,
  crearClienteEnTx,
  actualizarClienteEnTx,
  desactivarClienteEnTx,
  listarClientesEnEmpresa,
  tieneVentasNoCanceladas,
  registrarAuditClienteEnTx,
} from "./cliente-repository";
import { CLIENTE_IDENTIFICACION_DUPLICADA } from "../domain/errors";
import { Decimal } from "decimal.js";
import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";

// The generated Prisma client is ESM-only; tests replace it with the minimal
// runtime surface the repository actually touches (proveedor precedent).
jest.mock("@/generated/prisma/client", () => ({
  Prisma: {
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
  EstadoVenta: {
    BORRADOR: "BORRADOR",
    CONFIRMADA: "CONFIRMADA",
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
    cliente: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    venta: { count: jest.fn().mockResolvedValue(0) },
    movimientoAuditoria: { create: jest.fn().mockResolvedValue({}) },
    ...overrides,
  } as unknown as PrismaTx;
}

const filaCliente = {
  id: 3,
  empresaId: 1,
  nombre: "Ferretería del Valle",
  telefono: "809-555-1212",
  direccion: "Av. Central 100",
  identificacionFiscal: "131045677",
  tipoCliente: "MAYORISTA",
  esConsumidorFinal: false,
  creditoHabilitado: true,
  limiteCredito: new Decimal("5000.00"),
  plazoCreditoDias: 30,
  activo: true,
  version: 2,
};

describe("cliente-repository", () => {
  describe("clienteByIdEnEmpresa", () => {
    it("CLT-ISO-A: filters by empresaId and treats a foreign id as null", async () => {
      const tx = makeTx();
      const result = await clienteByIdEnEmpresa(tx, 999, 1);
      expect(result).toBeNull();
      expect(tx.cliente.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: 1, empresaId: 999 }),
        }),
      );
    });

    it("maps a tenant-owned row to the domain entity with a decimal.js limit", async () => {
      const tx = makeTx();
      (tx.cliente.findFirst as jest.Mock).mockResolvedValue(filaCliente);
      const cliente = await clienteByIdEnEmpresa(tx, 1, 3);
      expect(cliente).not.toBeNull();
      expect(cliente?.id).toBe(3);
      expect(cliente?.limiteCredito).toBeInstanceOf(Decimal);
      // decimal.js is value-normalized (trailing zeros are not part of the
      // value); assert scale-2 presentation, which is how the DTO renders it.
      expect(cliente?.limiteCredito.toFixed(2)).toBe("5000.00");
    });
  });

  describe("existeIdentificacionFiscalEnEmpresa", () => {
    it("CLT-DUP-A: active-only, non-CF probe blocks reuse of a taken fiscal id", async () => {
      const tx = makeTx();
      (tx.cliente.findFirst as jest.Mock).mockResolvedValue({ id: 7 });
      expect(
        await existeIdentificacionFiscalEnEmpresa(tx, 1, "131045677"),
      ).toBe(true);
      expect(tx.cliente.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            empresaId: 1,
            identificacionFiscal: "131045677",
            activo: true,
          }),
        }),
      );
    });

    it("CLT-DUP-B: a null fiscal id skips the probe (CF / unverified repeat freely)", async () => {
      const tx = makeTx();
      expect(await existeIdentificacionFiscalEnEmpresa(tx, 1, null)).toBe(false);
      expect(tx.cliente.findFirst).not.toHaveBeenCalled();
    });

    it("excludes the edited row when an id is given", async () => {
      const tx = makeTx();
      await existeIdentificacionFiscalEnEmpresa(tx, 1, "131045677", 5);
      expect(tx.cliente.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: { not: 5 } }),
        }),
      );
    });
  });

  describe("crearClienteEnTx", () => {
    it("CLT-DUP-C: maps a P2002 on the partial fiscal UK to the duplicate code", async () => {
      const tx = makeTx();
      (tx.cliente.create as jest.Mock).mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
          code: "P2002",
          meta: { target: ["identificacionFiscal"] },
          clientVersion: "0.0.0-test",
        }),
      );
      await expect(
        crearClienteEnTx(tx, ctx, {
          nombre: "Ferretería del Valle",
          telefono: "809-555-1212",
          direccion: "Av. Central 100",
          identificacionFiscal: "131045677",
          tipoCliente: "MAYORISTA",
          esConsumidorFinal: false,
          creditoHabilitado: true,
          limiteCredito: "5000.00",
          plazoCreditoDias: 30,
        }),
      ).rejects.toMatchObject({ code: CLIENTE_IDENTIFICACION_DUPLICADA });
    });

    it("writes the fiscal limit as a Decimal string, never a float, active at defaults", async () => {
      const tx = makeTx();
      (tx.cliente.create as jest.Mock).mockResolvedValue(filaCliente);
      await crearClienteEnTx(tx, ctx, {
        nombre: "Ferretería del Valle",
        telefono: "809-555-1212",
        direccion: "Av. Central 100",
        identificacionFiscal: "131045677",
        tipoCliente: "MAYORISTA",
        esConsumidorFinal: false,
        creditoHabilitado: true,
        limiteCredito: "5000.00",
        plazoCreditoDias: 30,
      });
      const arg = (tx.cliente.create as jest.Mock).mock.calls[0][0];
      expect(arg.data.limiteCredito).toBe("5000.00");
      expect(typeof arg.data.limiteCredito).toBe("string");
      expect(arg.data.empresaId).toBe(1);
      expect(arg.data.activo).toBe(true);
    });
  });

  describe("actualizarClienteEnTx", () => {
    it("CLT-OPT-A: zero affected rows on a stale version → { updated: false }", async () => {
      const tx = makeTx();
      (tx.cliente.updateMany as jest.Mock).mockResolvedValue({ count: 0 });
      const res = await actualizarClienteEnTx(tx, 1, 3, 2, { nombre: "X" });
      expect(res).toEqual({ updated: false, newVersion: 2 });
      expect(tx.cliente.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 3, empresaId: 1, version: 2 },
        }),
      );
    });

    it("CLT-OPT-B: on a matching version it bumps version and reports updated", async () => {
      const tx = makeTx();
      (tx.cliente.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
      const res = await actualizarClienteEnTx(tx, 1, 3, 2, {
        limiteCredito: "6000.00",
      });
      expect(res).toEqual({ updated: true, newVersion: 3 });
      const arg = (tx.cliente.updateMany as jest.Mock).mock.calls[0][0];
      expect(arg.data).toEqual({ limiteCredito: "6000.00", version: 3 });
    });

    it("CLT-DUP-D: a P2002 during update maps to the duplicate code", async () => {
      const tx = makeTx();
      (tx.cliente.updateMany as jest.Mock).mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
          code: "P2002",
          meta: { target: ["identificacionFiscal"] },
          clientVersion: "0.0.0-test",
        }),
      );
      await expect(
        actualizarClienteEnTx(tx, 1, 3, 2, { identificacionFiscal: "999999999" }),
      ).rejects.toMatchObject({ code: CLIENTE_IDENTIFICACION_DUPLICADA });
    });
  });

  describe("desactivarClienteEnTx", () => {
    it("CLT-DEACT-A: soft write scoped to active rows makes it idempotent", async () => {
      const tx = makeTx();
      (tx.cliente.updateMany as jest.Mock).mockResolvedValue({ count: 0 });
      const res = await desactivarClienteEnTx(tx, 1, 3);
      expect(res).toEqual({ deactivated: false });
      expect(tx.cliente.updateMany).toHaveBeenCalledWith({
        where: { id: 3, empresaId: 1, activo: true },
        data: { activo: false },
      });
    });

    it("returns deactivated=true when a row flips", async () => {
      const tx = makeTx();
      (tx.cliente.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
      expect(await desactivarClienteEnTx(tx, 1, 3)).toEqual({
        deactivated: true,
      });
    });
  });

  describe("listarClientesEnEmpresa", () => {
    it("CLT-LIST-A: defaults active-only, CF-excluded, deterministic, tenant-scoped", async () => {
      const tx = makeTx();
      await listarClientesEnEmpresa(tx, ctx, { page: 2, limit: 25 });
      const arg = (tx.cliente.findMany as jest.Mock).mock.calls[0][0];
      expect(arg.where).toEqual({
        empresaId: 1,
        activo: true,
        esConsumidorFinal: false,
      });
      expect(arg.orderBy).toEqual([{ nombre: "asc" }, { id: "asc" }]);
      expect(arg.skip).toBe(25);
      expect(arg.take).toBe(25);
    });

    it("CLT-LIST-B: buscar matches nombre or digits-only fiscal id; CF+inactives opt-in", async () => {
      const tx = makeTx();
      await listarClientesEnEmpresa(tx, ctx, {
        page: 1,
        limit: 25,
        buscar: "131-0456",
        incluirInactivos: true,
        incluirConsumidorFinal: true,
      });
      const arg = (tx.cliente.findMany as jest.Mock).mock.calls[0][0];
      expect(arg.where).toEqual({
        empresaId: 1,
        OR: [
          { nombre: { contains: "131-0456", mode: "insensitive" } },
          { identificacionFiscal: { contains: "1310456" } },
        ],
      });
    });
  });

  describe("tieneVentasNoCanceladas", () => {
    it("CLT-GUARD-A: real Venta probe counts non-CANCELADA sales in tenant", async () => {
      const tx = makeTx();
      (tx.venta.count as jest.Mock).mockResolvedValue(1);
      expect(await tieneVentasNoCanceladas(tx, 1, 4)).toBe(true);
      expect(tx.venta.count).toHaveBeenCalledWith({
        where: {
          clienteId: 4,
          empresaId: 1,
          estado: { not: "CANCELADA" },
        },
      });
    });

    it("returns false when only cancelled sales or none exist", async () => {
      const tx = makeTx();
      expect(await tieneVentasNoCanceladas(tx, 1, 4)).toBe(false);
    });
  });

  describe("registrarAuditClienteEnTx", () => {
    it("appends a tenant-scoped row for entity Cliente", async () => {
      const tx = makeTx();
      await registrarAuditClienteEnTx(tx, ctx, "CREAR", 9, null, { id: 9 });
      const mov = tx.movimientoAuditoria as unknown as { create: jest.Mock };
      expect(mov.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            empresaId: 1,
            usuarioId: 1,
            accion: "CREAR",
            entidad: "Cliente",
            idEntidad: "9",
            valorNuevo: JSON.stringify({ id: 9 }),
          }),
        }),
      );
    });
  });
});
