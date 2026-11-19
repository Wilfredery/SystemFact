import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import { leerHistorialPagosFacturaEnTx } from "./pago-repository";

// The generated client is only needed for `Prisma.Decimal` on the WRITE path;
// this unit pins the read shape with a plain stub so no DB driver is touched.
jest.mock("@/generated/prisma/client", () => ({
  Prisma: { Decimal: jest.fn() },
}));

const ctx: TenantCtx = { empresaId: 4, sucursalId: 5, usuarioId: 6, esAdmin: true };

function txCon(filas: unknown[]) {
  const findMany = jest.fn().mockResolvedValue(filas);
  return { tx: { pago: { findMany } } as unknown as PrismaTx, findMany };
}

describe("leerHistorialPagosFacturaEnTx (S13 Historial de Pagos)", () => {
  it("reads EVERY PAGO row of the invoice, tenant-pinned, newest first", async () => {
    const { tx, findMany } = txCon([
      {
        correlativoRecibo: 42,
        fecha: new Date("2026-02-02T10:00:00.000Z"),
        tipo: "COBRO",
        estado: "APLICADO",
        monto: { toFixed: () => "1500.00" },
        metodoPago: "EFECTIVO",
        usuario: { nombre: "Ana" },
      },
      {
        correlativoRecibo: 41,
        fecha: new Date("2026-02-01T10:00:00.000Z"),
        tipo: "REEMBOLSO",
        estado: "REGISTRADO",
        monto: { toFixed: () => "100.00" },
        metodoPago: "EFECTIVO",
        usuario: { nombre: "Luis" },
      },
    ]);

    const historial = await leerHistorialPagosFacturaEnTx(tx, ctx, 12);

    expect(findMany).toHaveBeenCalledTimes(1);
    const args = findMany.mock.calls[0][0] as {
      where: Record<string, unknown>;
      orderBy: readonly Record<string, string>[];
      select: Record<string, unknown>;
    };
    // Multi-tenancy: the invoice AND the empresa pin, never the id alone.
    expect(args.where).toEqual({ facturaId: 12, empresaId: ctx.empresaId });
    // Newest first, with a deterministic tie-break (never an unstable order).
    expect(args.orderBy).toEqual([{ fecha: "desc" }, { id: "desc" }]);
    // The receipt label and the acting user's name ride the read (no N+1).
    expect(args.select).toHaveProperty("correlativoRecibo");
    expect(args.select).toHaveProperty("usuario");
    // Money crosses as a Decimal(12,2) STRING — never a float.
    expect(historial).toEqual([
      {
        correlativoRecibo: 42,
        fecha: new Date("2026-02-02T10:00:00.000Z"),
        tipo: "COBRO",
        estado: "APLICADO",
        monto: "1500.00",
        metodoPago: "EFECTIVO",
        usuarioNombre: "Ana",
      },
      {
        correlativoRecibo: 41,
        fecha: new Date("2026-02-01T10:00:00.000Z"),
        tipo: "REEMBOLSO",
        estado: "REGISTRADO",
        monto: "100.00",
        metodoPago: "EFECTIVO",
        usuarioNombre: "Luis",
      },
    ]);
  });

  it("returns an empty history when the invoice has no payments", async () => {
    const { tx } = txCon([]);
    await expect(leerHistorialPagosFacturaEnTx(tx, ctx, 12)).resolves.toEqual([]);
  });
});
