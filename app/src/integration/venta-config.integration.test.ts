/**
 * Integration — venta-config DESC_MAX hard-fail read + cap enforcement +
 * idempotent seed (capability `venta-config` R-C1/R-C2/R-C3, venta R-V8).
 *
 * Real DB. Covers: a zero-discount draft saves WITHOUT DESC_MAX while a
 * discounted one hard-fails `DESC_MAX_FALTANTE`; the seeded 4.00 cap accepts 4%
 * and rejects 4.01% (`DESCUENTO_EXCEDE_MAXIMO`); an adjusted cap takes effect
 * without a deploy (R-C3); an expired DESC_MAX window is treated as missing; the
 * triple-cap rejects a line discount over the cap; a non-admin discount is
 * `DESCUENTO_NO_AUTORIZADO`; and the seed is idempotent (one active row).
 */

import { withTenantTransaction } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import { crearVenta } from "@/modules/venta/application/venta-service";
import {
  seedVentaConfigParaEmpresa,
  DESC_MAX_SEED_VALOR,
} from "../../tools/scripts/seed-venta-config";
import { getHarnessDb, seedTenantFixture, type TenantFixture } from "./setup/fixtures";
import { crearProductoVenta, categoriaA } from "./setup/venta-helpers";

const CERO = { descuentoTipo: "PORCENTAJE", descuentoValor: "0.00" } as const;
const pct = (v: string) => ({ descuentoTipo: "PORCENTAJE" as const, descuentoValor: v });

let fixture: TenantFixture | null = null;
let prodA: number;
let adminCtx: () => TenantCtx;

function ctxA(f: TenantFixture, usuarioId: number): TenantCtx {
  return { empresaId: f.empresaA.id, sucursalId: f.sucursalA1.id, usuarioId, esAdmin: true };
}

async function crearOperador(): Promise<number> {
  const db = getHarnessDb();
  let rol = await db.rol.findFirst({ where: { nombre: "Operador" } });
  if (!rol) rol = await db.rol.create({ data: { nombre: "Operador", descripcion: "harness" } });
  const u = await db.usuario.create({
    data: {
      empresaId: fixture!.empresaA.id,
      sucursalId: fixture!.sucursalA1.id,
      nombre: "Op A",
      nombreUsuario: `op-${Date.now()}`,
      passwordHash: "x",
      roles: { create: { rolId: rol.id } },
    },
  });
  return u.id;
}

async function guardarConCabecera(usuarioId: number, header: { descuentoTipo: "PORCENTAJE" | "MONTO"; descuentoValor: string }, fecha = new Date("2026-01-10T00:00:00.000Z")) {
  const ctx = ctxA(fixture!, usuarioId);
  return withTenantTransaction(ctx, (tx) =>
    crearVenta(tx, ctx, {
      clienteId: null,
      fecha,
      lineas: [{ productoId: prodA, cantidad: "1", precioUnitario: "100.00", descuento: CERO }],
      descuentoCabecera: header,
    }),
  );
}

describe("venta-config DESC_MAX (real DB)", () => {
  beforeEach(async () => {
    fixture = await seedTenantFixture();
    const cat = await categoriaA(fixture.empresaA.id);
    const prod = await crearProductoVenta({
      empresaId: fixture.empresaA.id,
      categoriaId: cat,
      codigo: `CFG-${Date.now()}`,
      precioVenta: "100.00",
    });
    prodA = prod.id;
    adminCtx = () => ctxA(fixture!, fixture!.usuarios.adminA.id);
  });

  it("R-C1: no DESC_MAX → discounted draft hard-fails, zero-discount draft saves", async () => {
    // No DESC_MAX seeded for empresa A (the base fixture only adds RET_*).
    const discount = await guardarConCabecera(fixture!.usuarios.adminA.id, pct("4.00"));
    expect(!discount.ok && discount.code).toBe("DESC_MAX_FALTANTE");
    expect(
      await getHarnessDb().venta.count({ where: { empresaId: fixture!.empresaA.id } }),
    ).toBe(0);

    const cero = await withTenantTransaction(adminCtx(), (tx) =>
      crearVenta(tx, adminCtx(), {
        clienteId: null,
        fecha: new Date("2026-01-10T00:00:00.000Z"),
        lineas: [{ productoId: prodA, cantidad: "1", precioUnitario: "100.00", descuento: CERO }],
      }),
    );
    expect(cero.ok).toBe(true);
  });

  it("R-C2: seed provisions one active DESC_MAX=4.00 and is idempotent on re-run", async () => {
    const db = getHarnessDb();
    await seedVentaConfigParaEmpresa(db, fixture!.empresaA.id);
    await seedVentaConfigParaEmpresa(db, fixture!.empresaA.id); // second run
    const activas = await db.configuracionEmpresa.count({
      where: { empresaId: fixture!.empresaA.id, clave: "DESC_MAX", activa: true },
    });
    expect(activas).toBe(1);
    const [row] = await db.configuracionEmpresa.findMany({
      where: { empresaId: fixture!.empresaA.id, clave: "DESC_MAX", activa: true },
    });
    expect(row.valor).toBe(DESC_MAX_SEED_VALOR);
  });

  it("R-C3/R-V8: with seeded cap, 4% saves but 4.01% fails EXCEDE_MAXIMO", async () => {
    const db = getHarnessDb();
    await seedVentaConfigParaEmpresa(db, fixture!.empresaA.id);

    const ok4 = await guardarConCabecera(fixture!.usuarios.adminA.id, pct("4.00"));
    expect(ok4.ok).toBe(true);
    if (ok4.ok) {
      // base 96.00, itbis 17.28, total 113.28 (fixture F4).
      const venta = await db.venta.findUnique({ where: { id: ok4.data.id } });
      expect(venta?.subtotal.toFixed(2)).toBe("100.00");
      expect(venta?.descuento.toFixed(2)).toBe("4.00");
      expect(venta?.itbis.toFixed(2)).toBe("17.28");
      expect(venta?.total.toFixed(2)).toBe("113.28");
    }

    const fail = await guardarConCabecera(fixture!.usuarios.adminA.id, pct("4.01"));
    expect(!fail.ok && fail.code).toBe("DESCUENTO_EXCEDE_MAXIMO");
  });

  it("R-C3: an adjusted cap (10.00) takes effect without a deploy", async () => {
    const db = getHarnessDb();
    await seedVentaConfigParaEmpresa(db, fixture!.empresaA.id);
    await db.configuracionEmpresa.updateMany({
      where: { empresaId: fixture!.empresaA.id, clave: "DESC_MAX", activa: true },
      data: { valor: "10.00" },
    });
    const ok10 = await guardarConCabecera(fixture!.usuarios.adminA.id, pct("10.00"));
    expect(ok10.ok).toBe(true);
    const fail1001 = await guardarConCabecera(fixture!.usuarios.adminA.id, pct("10.01"));
    expect(!fail1001.ok && fail1001.code).toBe("DESCUENTO_EXCEDE_MAXIMO");
  });

  it("expired DESC_MAX window is treated as missing (hard-fail)", async () => {
    const db = getHarnessDb();
    await db.configuracionEmpresa.create({
      data: {
        empresaId: fixture!.empresaA.id,
        clave: "DESC_MAX",
        valor: "25.00",
        vigenciaInicio: new Date("2000-01-01T00:00:00.000Z"),
        vigenciaFin: new Date("2005-01-01T00:00:00.000Z"), // long expired
        activa: true,
      },
    });
    const r = await guardarConCabecera(fixture!.usuarios.adminA.id, pct("5.00"));
    expect(!r.ok && r.code).toBe("DESC_MAX_FALTANTE");
  });

  it("R-V17: overlapping DESC_MAX windows resolve deterministically — newest vigenciaInicio wins", async () => {
    // CodeRabbit F5: before this change the covering-window `findFirst` had NO
    // ORDER BY, so a Postgres arbitrary-row pick decided the cap. Insert TWO
    // active, overlapping rows (4.00 old, 25.00 new) and prove the draft reads
    // the NEWEST window; then add a THIRD (1.00 newest of all) and prove the
    // cap flips again — both directions pin `vigenciaInicio DESC`.
    const db = getHarnessDb();
    const empresaId = fixture!.empresaA.id;
    await db.configuracionEmpresa.create({
      data: {
        empresaId,
        clave: "DESC_MAX",
        valor: "4.00",
        vigenciaInicio: new Date("2000-01-01T00:00:00.000Z"),
        vigenciaFin: new Date("2099-12-31T23:59:59.000Z"),
        activa: true,
      },
    });
    await db.configuracionEmpresa.create({
      data: {
        empresaId,
        clave: "DESC_MAX",
        valor: "25.00",
        vigenciaInicio: new Date("2026-01-01T00:00:00.000Z"), // overlaps the 4.00 window
        vigenciaFin: new Date("2099-12-31T23:59:59.000Z"),
        activa: true,
      },
    });

    // 10% ≤ 25% (newest) but > 4% (oldest): saving proves the NEW window won.
    const ok10 = await guardarConCabecera(fixture!.usuarios.adminA.id, pct("10.00"));
    expect(ok10.ok).toBe(true);

    // Newest window now caps at 1.00 → the same 10% draft must fail.
    await db.configuracionEmpresa.create({
      data: {
        empresaId,
        clave: "DESC_MAX",
        valor: "1.00",
        vigenciaInicio: new Date("2026-06-01T00:00:00.000Z"),
        vigenciaFin: new Date("2099-12-31T23:59:59.000Z"),
        activa: true,
      },
    });
    const fail = await guardarConCabecera(
      fixture!.usuarios.adminA.id,
      pct("10.00"),
      new Date("2026-07-01T00:00:00.000Z"),
    );
    expect(!fail.ok && fail.code).toBe("DESCUENTO_EXCEDE_MAXIMO");
  });

  it("triple-cap: a LINE discount over the cap fails EXCEDE_MAXIMO", async () => {
    const db = getHarnessDb();
    await seedVentaConfigParaEmpresa(db, fixture!.empresaA.id); // cap 4.00
    const ctx = adminCtx();
    const r = await withTenantTransaction(ctx, (tx) =>
      crearVenta(tx, ctx, {
        clienteId: null,
        fecha: new Date("2026-01-10T00:00:00.000Z"),
        // 10% line discount on a 100.00 gross line, cap is 4%.
        lineas: [{ productoId: prodA, cantidad: "1", precioUnitario: "100.00", descuento: pct("10.00") }],
      }),
    );
    expect(!r.ok && r.code).toBe("DESCUENTO_EXCEDE_MAXIMO");
  });

  it("R-V8: a non-admin submitting a positive discount → DESCUENTO_NO_AUTORIZADO, no write", async () => {
    const db = getHarnessDb();
    await seedVentaConfigParaEmpresa(db, fixture!.empresaA.id);
    const operador = await crearOperador();
    const antes = await db.venta.count({ where: { empresaId: fixture!.empresaA.id } });
    const r = await guardarConCabecera(operador, pct("2.00"));
    expect(!r.ok && r.code).toBe("DESCUENTO_NO_AUTORIZADO");
    expect(await db.venta.count({ where: { empresaId: fixture!.empresaA.id } })).toBe(antes);
  });
});
