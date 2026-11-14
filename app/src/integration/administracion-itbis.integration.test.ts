/**
 * Integration — administracion-itbis (real DB `systemfact_test`, RLS ON, as the
 * least-privilege app role through `withTenantTransaction`).
 *
 * Proves the Configuración tab's "ITBIS rates in use" read:
 *   - counts and windows match the seeded ACTIVE products of the empresa;
 *   - inactive products are excluded;
 *   - another empresa's products never appear (S2 empresaId pin + RLS);
 *   - an empresa without active products gets the empty list (S3);
 *   - the rate keeps the stored scale as a string and the order is rate desc,
 *     then vigente desde asc (S1).
 */

import { Prisma } from "@/generated/prisma/client";
import { withTenantTransaction } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import { consultarConfiguracion } from "@/modules/tenant/application/consultar-configuracion";
import { getHarnessDb, seedTenantFixture, type TenantFixture } from "./setup/fixtures";

describe("administracion ITBIS en uso integration (real DB)", () => {
  let fixture: TenantFixture;
  let ctxA: TenantCtx;
  let ctxB: TenantCtx;

  beforeEach(async () => {
    fixture = await seedTenantFixture();
    ctxA = {
      empresaId: fixture.empresaA.id,
      sucursalId: fixture.sucursalA1.id,
      usuarioId: fixture.usuarios.adminA.id,
      esAdmin: true,
    };
    ctxB = {
      empresaId: fixture.empresaB.id,
      sucursalId: fixture.sucursalB1.id,
      usuarioId: fixture.usuarios.adminB.id,
      esAdmin: true,
    };
  });

  async function crearProducto(
    empresaId: number,
    codigo: string,
    tasa: string,
    desde: Date,
    hasta: Date | null,
    activo: boolean,
  ): Promise<void> {
    const db = getHarnessDb();
    const categoria = await db.categoria.findFirstOrThrow({ where: { empresaId } });
    await db.producto.create({
      data: {
        empresaId,
        categoriaId: categoria.id,
        nombre: codigo,
        codigo,
        codigoBarras: codigo,
        unidadMedida: "u",
        unidadEmpaque: "c",
        stockMinimo: 0,
        precioCompra: new Prisma.Decimal(0),
        precioVenta: new Prisma.Decimal(0),
        costoPromedio: new Prisma.Decimal(0),
        tasaItbis: new Prisma.Decimal(tasa),
        itbisVigenteDesde: desde,
        itbisVigenteHasta: hasta,
        activo,
      },
    });
  }

  function leer(ctx: TenantCtx, ahora: Date) {
    return withTenantTransaction(ctx, (tx) => consultarConfiguracion(tx, ctx.empresaId, ahora));
  }

  // The shared fixture opens its 18% window at the real "now": evaluate at the real clock.
  const AHORA = new Date();
  const D2025 = new Date("2025-01-01T04:00:00.000Z");
  const D2026 = new Date("2026-01-01T04:00:00.000Z");

  it("lists the active products' rates with counts, windows, order and today's state", async () => {
    const idA = fixture.empresaA.id;
    // The shared fixture already seeds 2 active 18% products for A (one window).
    await crearProducto(idA, "T16-1", "16", D2025, new Date("2025-12-31T04:00:00.000Z"), true);
    await crearProducto(idA, "T16-2", "16", D2025, new Date("2025-12-31T04:00:00.000Z"), true);
    await crearProducto(idA, "T16-3", "16", D2025, new Date("2025-12-31T04:00:00.000Z"), true);
    await crearProducto(idA, "T0", "0", D2026, null, true);
    await crearProducto(idA, "T18B", "18", D2025, null, true);

    const result = await leer(ctxA, AHORA);
    const filas = result.data.itbisEnUso;

    expect(filas.map((f) => [f.tasaItbis, f.vigenteDesde, f.vigenteHasta, f.productos, f.vigenteHoy]))
      .toEqual([
        ["18.00", D2025.toISOString(), null, 1, true],
        [
          "18.00",
          expect.any(String), // fixture window starts at the seed instant
          null,
          2,
          true,
        ],
        ["16.00", D2025.toISOString(), "2025-12-31T04:00:00.000Z", 3, false],
        ["0.00", D2026.toISOString(), null, 1, true],
      ]);
  });

  it("excludes inactive products", async () => {
    await crearProducto(fixture.empresaA.id, "INACT", "7", D2026, null, false);

    const rates = (await leer(ctxA, AHORA)).data.itbisEnUso.map((f) => f.tasaItbis);

    expect(rates).toEqual(["18.00"]);
  });

  it("never shows another empresa's products", async () => {
    await crearProducto(fixture.empresaB.id, "B-ONLY", "9", D2026, null, true);

    const a = (await leer(ctxA, AHORA)).data.itbisEnUso.map((f) => f.tasaItbis);
    const b = (await leer(ctxB, AHORA)).data.itbisEnUso;

    expect(a).toEqual(["18.00"]);
    expect(b.map((f) => [f.tasaItbis, f.productos])).toEqual([
      ["18.00", 1],
      ["9.00", 1],
    ]);
  });

  it("returns the empty list when the empresa has no active products", async () => {
    await getHarnessDb().producto.updateMany({
      where: { empresaId: fixture.empresaB.id },
      data: { activo: false },
    });

    const result = await leer(ctxB, AHORA);

    expect(result.data.itbisEnUso).toEqual([]);
  });
});
