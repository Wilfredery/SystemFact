/**
 * AU-1 consolidation pin (design D5) — the 12 duplicated audit append sites
 * replay their OLD payload shape through the canonical writer.
 *
 * Two assertions per site:
 *   1. the site helper DELEGATES to `registrarEventoAuditoriaEnTx` (the spy) —
 *      RED before migration (per-site bodies appended directly);
 *   2. the appended row is byte-identical to the pre-consolidation payload
 *      (researched verbatim from the old bodies per the D5 mapping table):
 *      every field equal; `fechaHora` compared type-only (instant set in code).
 *
 * The recording `tx` captures the single `MovimientoAuditoria.create` call.
 */

import { AccionAuditoria } from "@/generated/prisma/client";
import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import { registrarEventoAuditoriaEnTx } from "@/modules/auditoria/application/auditoria-write-port";
import { registrarAuditNotaCreditoEnTx } from "@/modules/devolucion/infrastructure/devolucion-repository";
import {
  registrarAuditFacturaEnTx,
  registrarAuditVentaEnTx,
} from "@/modules/venta/infrastructure/venta-repository";
import {
  registrarAuditCompraEnTx,
} from "@/modules/compra/infrastructure/compra-repository";
import { registrarAuditoriaStockEnTx } from "@/modules/inventario/infrastructure/inventario-repository";
import { registrarAuditCategoriaEnTx } from "@/modules/categoria/infrastructure/categoria-repository";
import { registrarAuditClienteEnTx } from "@/modules/cliente/infrastructure/cliente-repository";
import { registrarAuditProveedorEnTx } from "@/modules/proveedor/infrastructure/proveedor-repository";
import {
  registrarProductoCreadoEnTx,
  registrarProductoActualizadoEnTx,
  registrarProductoDesactivadoEnTx,
} from "@/modules/producto/infrastructure/producto-repository";

jest.mock("@/modules/auditoria/application/auditoria-write-port", () => {
  const actual =
    jest.requireActual<Record<string, unknown>>(
      "@/modules/auditoria/application/auditoria-write-port",
    );
  return {
    ...actual,
    registrarEventoAuditoriaEnTx: jest.fn(actual.registrarEventoAuditoriaEnTx),
  };
});

const escenarioSpy = registrarEventoAuditoriaEnTx as jest.MockedFunction<
  typeof registrarEventoAuditoriaEnTx
>;

const ctx: TenantCtx = {
  empresaId: 7,
  sucursalId: 3,
  usuarioId: 11,
  esAdmin: false,
};

function makeTx(): PrismaTx {
  const create = jest
    .fn()
    .mockImplementation(async ({ data }: { data: unknown }) => data);
  return { movimientoAuditoria: { create } } as unknown as PrismaTx;
}

/** The create call a recording tx captured, without ever persisting anything. */
function fila(tx: PrismaTx): Record<string, unknown> {
  const create = (tx as unknown as {
    movimientoAuditoria: { create: jest.Mock };
  }).movimientoAuditoria.create;
  const [, createEstaVacio] = [create, create.mock.calls.length] as const;
  if (createEstaVacio !== 1) {
    return { SIN_CREATE: createEstaVacio };
  }
  const call = create.mock.calls[0]!;
  return call[0].data as Record<string, unknown>;
}

/** Field-level pin minus the code-set `fechaHora` (type-only comparison). */
function esperarFila(tx: PrismaTx, esperada: Record<string, unknown>): void {
  const data = fila(tx);
  for (const campo of Object.keys(esperada)) {
    expect(data[campo]).toEqual(esperada[campo]);
  }
  expect(data.fechaHora).toBeInstanceOf(Date);
}

describe("M2 — audit append sites delegate to the canonical writer (D5)", () => {
  beforeEach(() => {
    escenarioSpy.mockClear();
  });

  it("site 1 — devolucion nota credito (CREAR / NotaCredito)", async () => {
    const tx = makeTx();
    const nuevo = {
      estado: "VIGENTE",
      ncf: "B0100000123",
      monto: "1000.00",
      itbis: "180.00",
    };
    await registrarAuditNotaCreditoEnTx(tx, ctx, 44, nuevo, "devolucion B04");

    expect(escenarioSpy).toHaveBeenCalledTimes(1);
    esperarFila(tx, {
      empresaId: 7,
      sucursalId: 3,
      usuarioId: 11,
      accion: AccionAuditoria.CREAR,
      entidad: "NotaCredito",
      idEntidad: "44",
      valorAnterior: null,
      valorNuevo: JSON.stringify(nuevo),
      motivo: "devolucion B04",
    });
  });

  it("site 2 — venta factura anulada (ANULAR / Factura, null-safe JSON)", async () => {
    const tx = makeTx();
    const nuevos = { estado: "ANULADA" };
    await registrarAuditFacturaEnTx(tx, ctx, 55, null, nuevos, "anulacion");

    expect(escenarioSpy).toHaveBeenCalledTimes(1);
    esperarFila(tx, {
      empresaId: 7,
      sucursalId: 3,
      usuarioId: 11,
      accion: AccionAuditoria.ANULAR,
      entidad: "Factura",
      idEntidad: "55",
      valorAnterior: null,
      valorNuevo: JSON.stringify(nuevos),
      motivo: "anulacion",
    });

    const tx2 = makeTx();
    const anteriores = { estado: "VIGENTE" };
    await registrarAuditFacturaEnTx(
      tx2,
      ctx,
      56,
      anteriores,
      { estado: "ANULADA" },
      undefined,
    );
    esperarFila(tx2, {
      empresaId: 7,
      sucursalId: 3,
      usuarioId: 11,
      accion: AccionAuditoria.ANULAR,
      entidad: "Factura",
      idEntidad: "56",
      valorAnterior: JSON.stringify(anteriores),
      valorNuevo: JSON.stringify({ estado: "ANULADA" }),
      motivo: null,
    });
  });

  it("site 3 — venta estado (accion parametrizado / Venta)", async () => {
    const tx = makeTx();
    await registrarAuditVentaEnTx(
      tx,
      ctx,
      AccionAuditoria.CANCELAR,
      66,
      { estado: "BORRADOR" },
      { estado: "CANCELADA" },
      "cancel",
    );

    expect(escenarioSpy).toHaveBeenCalledTimes(1);
    esperarFila(tx, {
      empresaId: 7,
      sucursalId: 3,
      usuarioId: 11,
      accion: AccionAuditoria.CANCELAR,
      entidad: "Venta",
      idEntidad: "66",
      valorAnterior: JSON.stringify({ estado: "BORRADOR" }),
      valorNuevo: JSON.stringify({ estado: "CANCELADA" }),
      motivo: "cancel",
    });
  });

  it("sites 4-5 — compra (accion parametrizado) + inventario stock (JSON ya serializado)", async () => {
    const tx = makeTx();
    await registrarAuditCompraEnTx(
      tx,
      ctx,
      AccionAuditoria.CREAR,
      77,
      null,
      { estado: "CONFIRMADA" },
      "recibo",
    );

    expect(escenarioSpy).toHaveBeenCalledTimes(1);
    esperarFila(tx, {
      empresaId: 7,
      sucursalId: 3,
      usuarioId: 11,
      accion: AccionAuditoria.CREAR,
      entidad: "Compra",
      idEntidad: "77",
      valorAnterior: null,
      valorNuevo: JSON.stringify({ estado: "CONFIRMADA" }),
      motivo: "recibo",
    });

    const tx2 = makeTx();
    await registrarAuditoriaStockEnTx(
      tx2,
      ctx,
      88,
      "10.000",
      "12.500",
      "ajuste manual",
      AccionAuditoria.AJUSTAR,
    );

    expect(escenarioSpy).toHaveBeenCalledTimes(2);
    esperarFila(tx2, {
      empresaId: 7,
      sucursalId: 3,
      usuarioId: 11,
      accion: AccionAuditoria.AJUSTAR,
      entidad: "Inventario",
      idEntidad: "88",
      valorAnterior: "10.000",
      valorNuevo: "12.500",
      motivo: "ajuste manual",
    });
  });

  it("sites 6-8 — categoria / cliente / proveedor (accion parametrizado)", async () => {
    const tx = makeTx();
    await registrarAuditCategoriaEnTx(
      tx,
      ctx,
      AccionAuditoria.ACTUALIZAR,
      12,
      { nombre: "Vieja" },
      { nombre: "Nueva" },
    );
    expect(escenarioSpy).toHaveBeenCalledTimes(1);
    esperarFila(tx, {
      empresaId: 7,
      sucursalId: 3,
      usuarioId: 11,
      accion: AccionAuditoria.ACTUALIZAR,
      entidad: "Categoria",
      idEntidad: "12",
      valorAnterior: JSON.stringify({ nombre: "Vieja" }),
      valorNuevo: JSON.stringify({ nombre: "Nueva" }),
      motivo: null,
    });

    const tx2 = makeTx();
    await registrarAuditClienteEnTx(
      tx2,
      ctx,
      AccionAuditoria.CANCELAR,
      13,
      null,
      null,
    );
    esperarFila(tx2, {
      empresaId: 7,
      sucursalId: 3,
      usuarioId: 11,
      accion: AccionAuditoria.CANCELAR,
      entidad: "Cliente",
      idEntidad: "13",
      valorAnterior: null,
      valorNuevo: null,
      motivo: null,
    });

    const tx3 = makeTx();
    await registrarAuditProveedorEnTx(
      tx3,
      ctx,
      AccionAuditoria.CREAR,
      14,
      null,
      { rnc: "131045677" },
    );
    esperarFila(tx3, {
      empresaId: 7,
      sucursalId: 3,
      usuarioId: 11,
      accion: AccionAuditoria.CREAR,
      entidad: "Proveedor",
      idEntidad: "14",
      valorAnterior: null,
      valorNuevo: JSON.stringify({ rnc: "131045677" }),
      motivo: null,
    });
  });

  it("sites 9-11 — producto creado / actualizado / desactivado", async () => {
    const tx = makeTx();
    const producto = {
      id: 91,
      codigo: "PROD91",
      itbis: { tasa: "18" as const },
    } as Parameters<typeof registrarProductoCreadoEnTx>[2];
    await registrarProductoCreadoEnTx(tx, ctx, producto);
    expect(escenarioSpy).toHaveBeenCalledTimes(1);
    esperarFila(tx, {
      empresaId: 7,
      sucursalId: 3,
      usuarioId: 11,
      accion: AccionAuditoria.CREAR,
      entidad: "Producto",
      idEntidad: "91",
      valorAnterior: null,
      valorNuevo: JSON.stringify({ codigo: "PROD91", tasa: "18" }),
      motivo: null,
    });

    const tx2 = makeTx();
    await registrarProductoActualizadoEnTx(
      tx2,
      ctx,
      92,
      { precioVenta: "50.00" },
      { precioVenta: "55.00" },
    );
    esperarFila(tx2, {
      empresaId: 7,
      sucursalId: 3,
      usuarioId: 11,
      accion: AccionAuditoria.ACTUALIZAR,
      entidad: "Producto",
      idEntidad: "92",
      valorAnterior: JSON.stringify({ precioVenta: "50.00" }),
      valorNuevo: JSON.stringify({ precioVenta: "55.00" }),
      motivo: null,
    });

    const tx3 = makeTx();
    await registrarProductoDesactivadoEnTx(tx3, ctx, 93);
    esperarFila(tx3, {
      empresaId: 7,
      sucursalId: 3,
      usuarioId: 11,
      accion: AccionAuditoria.CANCELAR,
      entidad: "Producto",
      idEntidad: "93",
      valorAnterior: JSON.stringify({ activo: true }),
      valorNuevo: JSON.stringify({ activo: false }),
      motivo: "producto.desactivado",
    });
  });
});
