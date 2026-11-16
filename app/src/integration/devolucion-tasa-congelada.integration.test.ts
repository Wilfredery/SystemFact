/**
 * Integration — a return uses the ITBIS rate FROZEN on the original sale line, even when
 * that rate is no longer in the company's allowed list (odd/tasks/itbis-tasas-config.md
 * S4 and S7; sub-slice 3f). Real DB, RLS on.
 *
 * GIVEN a confirmed sale whose line froze a rate that the company list ({0,16,18}) does
 * not contain (modelled by rewriting the frozen line rate to 7, the state of a legacy
 * sale after a rate is retired),
 * WHEN a return is registered for that line,
 * THEN it succeeds and the credit note uses the frozen 7% (ITBIS 7.00 on a 100.00 line),
 * never the current list and never a refusal.
 */

import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import { withTenantTransaction } from "@/modules/tenant/infrastructure/withTenantTransaction";
import { crearVenta } from "@/modules/venta/application/venta-service";
import { confirmarVenta } from "@/modules/venta/application/confirmar-venta";
import { crearDevolucion } from "@/modules/devolucion/application/crear-devolucion";
import { getHarnessDb, seedTenantFixture, type TenantFixture } from "./setup/fixtures";
import { crearProductoVenta, fijarStock } from "./setup/venta-helpers";

const VIG_FIN = new Date("2099-12-31T23:59:59.000Z");
const NOW_DEVOLUCION = new Date("2026-09-05T12:00:00.000Z");
const FECHA_VENTA = new Date("2026-09-01T15:00:00.000Z");

let fixture: TenantFixture | null = null;
let ctx: TenantCtx;
let catA: number;

function ctxA1(f: TenantFixture): TenantCtx {
  return {
    empresaId: f.empresaA.id,
    sucursalId: f.sucursalA1.id,
    usuarioId: f.usuarios.adminA.id,
    esAdmin: true,
  };
}

describe("devolucion with a retired frozen rate (real DB, RLS on)", () => {
  beforeEach(async () => {
    fixture = await seedTenantFixture();
    ctx = ctxA1(fixture);
    const db = getHarnessDb();
    catA = (await db.categoria.findFirst({ where: { empresaId: ctx.empresaId } }))!.id;
    await db.empresa.update({ where: { id: ctx.empresaId }, data: { facturaAutomatica: true } });
    await db.ncfSecuencia.createMany({
      data: [
        {
          empresaId: ctx.empresaId,
          tipoNcf: "B02",
          rangoInicio: BigInt(500),
          rangoFin: BigInt(1000),
          secuenciaActual: BigInt(521),
          vigenciaInicio: new Date("2000-01-01T00:00:00.000Z"),
          vigenciaFin: VIG_FIN,
          activa: true,
        },
        {
          empresaId: ctx.empresaId,
          tipoNcf: "B04",
          rangoInicio: BigInt(201),
          rangoFin: BigInt(300),
          secuenciaActual: BigInt(200),
          vigenciaInicio: new Date("2000-01-01T00:00:00.000Z"),
          vigenciaFin: VIG_FIN,
          activa: true,
        },
      ],
    });
    await db.configuracionEmpresa.create({
      data: {
        empresaId: ctx.empresaId,
        clave: "PLAZO_DEVOLUCION",
        valor: "15",
        vigenciaInicio: new Date("2000-01-01T00:00:00.000Z"),
        vigenciaFin: VIG_FIN,
        activa: true,
      },
    });
  });

  it("returns a line whose frozen rate (7) is not in the company list, using the frozen rate", async () => {
    const prod = await crearProductoVenta({
      empresaId: ctx.empresaId,
      categoriaId: catA,
      codigo: "tasa-congelada",
      precioVenta: "100.00",
      tasa: 18,
    });
    await fijarStock(ctx.sucursalId, prod.id, "50.000");

    const ventaId = await withTenantTransaction(ctx, async (tx) => {
      const r = await crearVenta(tx, ctx, {
        clienteId: null,
        fecha: FECHA_VENTA,
        lineas: [
          {
            productoId: prod.id,
            cantidad: "2",
            precioUnitario: "100.00",
            descuento: { descuentoTipo: "PORCENTAJE", descuentoValor: "0.00" },
          },
        ],
      });
      if (!r.ok) throw new Error(`crearVenta falló: ${r.code}`);
      const c = await confirmarVenta(tx, ctx, { id: r.data.id });
      if (!c.ok) throw new Error(`confirmarVenta falló: ${c.code}`);
      return r.data.id;
    });

    // The state of a legacy sale after a rate is retired: the line froze a rate that the
    // company list no longer contains.
    const db = getHarnessDb();
    const actualizadas = await db.detalleVenta.updateMany({
      where: { ventaId },
      data: { tasaItbis: "7" },
    });
    expect(actualizadas.count).toBe(1);

    const res = await withTenantTransaction(ctx, (tx) =>
      crearDevolucion(tx, ctx, {
        ventaId,
        motivo: "tasa congelada integration",
        lineas: [{ productoId: prod.id, cantidad: "1", tipoReposicion: "VENDIBLE" }],
        now: NOW_DEVOLUCION,
      }),
    );

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.ncf).toBe("B0400000201");
      expect(res.data.monto).toBe("100.00"); // 1 x 100.00
      expect(res.data.itbis).toBe("7.00"); // the FROZEN 7%, not 18%, not a refusal
      expect(res.data.lineas).toBe(1);
    }
  });
});
