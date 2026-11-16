import { Decimal } from "decimal.js";
import { crearProducto } from "./crear-producto";
import {
  existeCodigoEnEmpresa,
  crearProductoEnTx,
  registrarProductoCreadoEnTx,
} from "../infrastructure/producto-repository";
// Design D3 (fase-3-2): helper relocated to the Categoria module.
import { categoriaPerteneceAEmpresa } from "@/modules/categoria/infrastructure/categoria-repository";
import {
  CODIGO_PRODUCTO_DUPLICADO,
  TASA_ITBIS_INVALIDA,
  PRECIO_BASE_INVALIDO,
  VIGENCIA_INVALIDA,
  CATEGORIA_INVALIDA,
  ProductoDomainError,
} from "../domain/errors";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { CrearProductoInput } from "../infrastructure/producto-repository";

jest.mock("../infrastructure/producto-repository", () => ({
  existeCodigoEnEmpresa: jest.fn(),
  crearProductoEnTx: jest.fn(),
  registrarProductoCreadoEnTx: jest.fn(),
}));

jest.mock("@/modules/categoria/infrastructure/categoria-repository", () => ({
  categoriaPerteneceAEmpresa: jest.fn(),
}));

const ctx: TenantCtx = {
  empresaId: 1,
  sucursalId: 1,
  usuarioId: 1,
  esAdmin: true,
};

const TASAS = ["18", "16", "0"] as const;

const baseInput: CrearProductoInput = {
  categoriaId: 1,
  codigo: "LAPTOP-001",
  nombre: "Laptop",
  precioVenta: new Decimal("50000.00"),
  itbisTasa: "18",
  itbisVigenteDesde: new Date("2026-01-01"),
  itbisVigenteHasta: null,
  itbisAplicaRetencionITBIS: false,
};

function makeTx(): PrismaTx {
  // The application layer no longer touches Prisma directly; the transaction
  // handle is only forwarded to the (mocked) repository functions.
  return {} as unknown as PrismaTx;
}

describe("crearProducto", () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it("returns product on happy path", async () => {
    const tx = makeTx();
    (existeCodigoEnEmpresa as jest.Mock).mockResolvedValue(false);
    (categoriaPerteneceAEmpresa as jest.Mock).mockResolvedValue(true);
    (crearProductoEnTx as jest.Mock).mockResolvedValue({
      id: 1,
      empresaId: 1,
      categoriaId: 1,
      codigo: "LAPTOP-001",
      nombre: "Laptop",
      descripcion: null,
      unidadMedida: "",
      precioVenta: new Decimal("50000.00"),
      itbis: {
        tasa: "18",
        vigenteDesde: new Date("2026-01-01"),
        vigenteHasta: null,
        aplicaRetencionITBIS: false,
      },
      exento: false,
      activo: true,
    });

    const result = await crearProducto(tx, ctx, baseInput, TASAS);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.producto.id).toBe(1);
      expect(result.producto.codigo).toBe("LAPTOP-001");
    }
    expect(registrarProductoCreadoEnTx).toHaveBeenCalledTimes(1);
  });

  it("returns duplicate code error", async () => {
    const tx = makeTx();
    (existeCodigoEnEmpresa as jest.Mock).mockResolvedValue(true);

    const result = await crearProducto(tx, ctx, baseInput, TASAS);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe(CODIGO_PRODUCTO_DUPLICADO);
    }
  });

  it("rejects category from another empresa (cross-tenant)", async () => {
    const tx = makeTx();
    (existeCodigoEnEmpresa as jest.Mock).mockResolvedValue(false);
    (categoriaPerteneceAEmpresa as jest.Mock).mockResolvedValue(false);

    const result = await crearProducto(tx, ctx, baseInput, TASAS);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe(CATEGORIA_INVALIDA);
    }
    expect(crearProductoEnTx).not.toHaveBeenCalled();
  });

  it("returns invalid rate error", async () => {
    const tx = makeTx();
    const result = await crearProducto(tx, ctx, { ...baseInput, itbisTasa: "19" }, TASAS);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe(TASA_ITBIS_INVALIDA);
      expect(result.message).toBe("La tasa de ITBIS debe ser 0%, 16% o 18%");
    }
    expect(crearProductoEnTx).not.toHaveBeenCalled();
  });

  it.each(["18", "16", "0"])("accepts rate %s when it is in the list", async (tasa) => {
    (existeCodigoEnEmpresa as jest.Mock).mockResolvedValue(false);
    (categoriaPerteneceAEmpresa as jest.Mock).mockResolvedValue(true);
    (crearProductoEnTx as jest.Mock).mockImplementation(
      async (_tx: unknown, _ctx: unknown, input: CrearProductoInput) => ({
        ...input,
        id: 1,
        empresaId: 1,
        itbis: {
          tasa: input.itbisTasa,
          vigenteDesde: input.itbisVigenteDesde,
          vigenteHasta: input.itbisVigenteHasta,
          aplicaRetencionITBIS: input.itbisAplicaRetencionITBIS,
        },
        exento: input.itbisTasa === "0",
        activo: true,
      }),
    );

    const result = await crearProducto(makeTx(), ctx, { ...baseInput, itbisTasa: tasa }, TASAS);

    expect(result.ok).toBe(true);
    expect((crearProductoEnTx as jest.Mock).mock.calls[0][2].itbisTasa).toBe(tasa);
  });

  it.each([
    ["18.00", "18"],
    ["18.0", "18"],
    ["016", "16"],
    ["0.0", "0"],
  ])("stores %s in the list's own spelling (%s)", async (escrita, canonica) => {
    (existeCodigoEnEmpresa as jest.Mock).mockResolvedValue(false);
    (categoriaPerteneceAEmpresa as jest.Mock).mockResolvedValue(true);
    (crearProductoEnTx as jest.Mock).mockImplementation(
      async (_tx: unknown, _ctx: unknown, input: CrearProductoInput) => ({
        ...input,
        id: 1,
        empresaId: 1,
        itbis: {
          tasa: input.itbisTasa,
          vigenteDesde: input.itbisVigenteDesde,
          vigenteHasta: input.itbisVigenteHasta,
          aplicaRetencionITBIS: input.itbisAplicaRetencionITBIS,
        },
        exento: input.itbisTasa === "0",
        activo: true,
      }),
    );

    const result = await crearProducto(makeTx(), ctx, { ...baseInput, itbisTasa: escrita }, TASAS);

    expect(result.ok).toBe(true);
    expect((crearProductoEnTx as jest.Mock).mock.calls[0][2].itbisTasa).toBe(canonica);
  });

  it("refuses a rate that was retired from the list and names the current list", async () => {
    const result = await crearProducto(makeTx(), ctx, baseInput, ["16", "0"]);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe(TASA_ITBIS_INVALIDA);
      expect(result.message).toBe("La tasa de ITBIS debe ser 0% o 16%");
    }
    expect(crearProductoEnTx).not.toHaveBeenCalled();
  });

  it("refuses a malformed rate even when called directly (never throws)", async () => {
    const result = await crearProducto(makeTx(), ctx, { ...baseInput, itbisTasa: "abc" }, TASAS);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(TASA_ITBIS_INVALIDA);
  });

  it("returns invalid price error", async () => {
    const tx = makeTx();
    const result = await crearProducto(tx, ctx, { ...baseInput, precioVenta: new Decimal("-10") }, TASAS);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe(PRECIO_BASE_INVALIDO);
    }
  });

  it("returns invalid vigencia error", async () => {
    const tx = makeTx();
    const result = await crearProducto(tx, ctx, {
      ...baseInput,
      itbisVigenteDesde: new Date("2026-12-31"),
      itbisVigenteHasta: new Date("2026-01-01"),
    }, TASAS);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe(VIGENCIA_INVALIDA);
    }
  });

  it("maps TOCTOU race (constraint P2002) to duplicate code error", async () => {
    const tx = makeTx();
    (existeCodigoEnEmpresa as jest.Mock).mockResolvedValue(false); // pre-check passes
    (categoriaPerteneceAEmpresa as jest.Mock).mockResolvedValue(true);
    (crearProductoEnTx as jest.Mock).mockRejectedValue(
      new ProductoDomainError(CODIGO_PRODUCTO_DUPLICADO),
    );

    const result = await crearProducto(tx, ctx, baseInput, TASAS);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe(CODIGO_PRODUCTO_DUPLICADO);
    }
    expect(registrarProductoCreadoEnTx).not.toHaveBeenCalled();
  });

  it("rejects price above Decimal(12,2) magnitude", async () => {
    const tx = makeTx();
    const result = await crearProducto(tx, ctx, {
      ...baseInput,
      precioVenta: new Decimal("12345678901.00"), // 11 integer digits > 10
    }, TASAS);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe(PRECIO_BASE_INVALIDO);
    }
  });
});

describe("crearProducto — unidad (S1)", () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it("passes unidadMedida through to the repository create call", async () => {
    const tx = makeTx();
    (existeCodigoEnEmpresa as jest.Mock).mockResolvedValue(false);
    (categoriaPerteneceAEmpresa as jest.Mock).mockResolvedValue(true);
    (crearProductoEnTx as jest.Mock).mockResolvedValue({
      id: 1,
      empresaId: 1,
      categoriaId: 1,
      codigo: "LAPTOP-001",
      nombre: "Laptop",
      descripcion: null,
      unidadMedida: "",
      precioVenta: new Decimal("50000.00"),
      itbis: {
        tasa: "18",
        vigenteDesde: new Date("2026-01-01"),
        vigenteHasta: null,
        aplicaRetencionITBIS: false,
      },
      exento: false,
      activo: true,
    });

    const result = await crearProducto(tx, ctx, { ...baseInput, unidadMedida: "Unidad" }, TASAS);

    expect(result.ok).toBe(true);
    expect((crearProductoEnTx as jest.Mock).mock.calls[0][2]).toMatchObject({
      unidadMedida: "Unidad",
    });
  });

  it("omitting unidadMedida keeps the previous request untouched", async () => {
    const tx = makeTx();
    (existeCodigoEnEmpresa as jest.Mock).mockResolvedValue(false);
    (categoriaPerteneceAEmpresa as jest.Mock).mockResolvedValue(true);
    (crearProductoEnTx as jest.Mock).mockResolvedValue({
      id: 1,
      empresaId: 1,
      categoriaId: 1,
      codigo: "LAPTOP-001",
      nombre: "Laptop",
      descripcion: null,
      unidadMedida: "",
      precioVenta: new Decimal("50000.00"),
      itbis: {
        tasa: "18",
        vigenteDesde: new Date("2026-01-01"),
        vigenteHasta: null,
        aplicaRetencionITBIS: false,
      },
      exento: false,
      activo: true,
    });

    await crearProducto(tx, ctx, baseInput, TASAS);

    const enviado = (crearProductoEnTx as jest.Mock).mock.calls[0][2];
    expect(enviado.unidadMedida).toBeUndefined();
  });
});
