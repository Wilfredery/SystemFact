/**
 * Integration — the product READ path against the per-empresa rate list
 * `TASA_ITBIS` (feature `itbis-tasas-config`, sub-slice 3c: S4, S15), on real
 * Postgres with RLS on. The REAL read actions run with the real tenant wrapper;
 * only the Supabase session lookup is replaced by a fixed tenant context.
 *
 * S4: a product whose stored rate is not in the list (legacy) is still read,
 * never throws, and is flagged `tasaVigente: false`. S15: a missing key fails
 * loud with a typed code. Every test restores the config row it changes.
 */

import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import { crearProductoAction } from "@/modules/producto/http/actions.escritura";
import {
  consultarProductosAction,
  listarProductosAction,
  obtenerProductoPorIdAction,
} from "@/modules/producto/http/actions.lectura";
import { getHarnessDb, seedTenantFixture, type TenantFixture } from "./setup/fixtures";

let ctxActual: TenantCtx | null = null;

jest.mock("@/lib/supabase/client", () => ({
  createClient: jest.fn(async () => ({})),
}));

jest.mock("@/modules/tenant/infrastructure/tenant-runtime", () => ({
  ...jest.requireActual("@/modules/tenant/infrastructure/tenant-runtime"),
  getCurrentTenantContext: jest.fn(async () => ctxActual),
}));

const MENSAJE_CONFIG_FALTANTE =
  "Falta la configuración TASA_ITBIS requerida; no se puede validar la tasa de ITBIS";

let fixture: TenantFixture;
let categoriaA: number;
const ids: Record<string, number> = {};

async function cambiarFila(
  empresaId: number,
  data: { valor?: string; activa?: boolean },
): Promise<void> {
  await getHarnessDb().configuracionEmpresa.updateMany({
    where: { empresaId, clave: "TASA_ITBIS" },
    data,
  });
}

async function crear(tasa: string): Promise<number> {
  const r = await crearProductoAction({
    categoriaId: categoriaA,
    codigo: `LECT-${tasa}`,
    nombre: `Lectura tasa ${tasa}`,
    precioVenta: "100.00",
    itbisTasa: tasa,
    itbisAplicaRetencionITBIS: false,
  });
  if (!r.ok) throw new Error(`no se pudo crear ${tasa}: ${r.error.code}`);
  return r.data.id;
}

async function consultarPropios() {
  const r = await consultarProductosAction({ page: 1, limit: 100, busqueda: "LECT-" });
  if (!r.ok) throw new Error(`consulta falló: ${r.error.code}`);
  return r.data;
}

function vigencias(data: Awaited<ReturnType<typeof consultarPropios>>) {
  return Object.fromEntries(data.items.map((i) => [i.codigo, [i.tasaItbis, i.tasaVigente]]));
}

describe("producto read path vs the TASA_ITBIS list (real DB)", () => {
  beforeEach(async () => {
    fixture = await seedTenantFixture();
    ctxActual = {
      empresaId: fixture.empresaA.id,
      sucursalId: fixture.sucursalA1.id,
      usuarioId: fixture.usuarios.adminA.id,
      esAdmin: true,
    };
    categoriaA = (
      await getHarnessDb().categoria.findFirstOrThrow({ where: { empresaId: fixture.empresaA.id } })
    ).id;
    for (const tasa of ["18", "16", "0"]) ids[tasa] = await crear(tasa);
  });

  it("consulta returns the list in config order and every stored rate is current", async () => {
    const data = await consultarPropios();

    expect(data.tasasItbis).toEqual(["18", "16", "0"]);
    expect(vigencias(data)).toEqual({
      "LECT-18": ["18", true],
      "LECT-16": ["16", true],
      "LECT-0": ["0", true],
    });
  });

  it("S4: a legacy stored rate (7) is read by list, detail and consulta without throwing, flagged retired", async () => {
    await getHarnessDb().producto.update({ where: { id: ids["16"] }, data: { tasaItbis: "7" } });

    const data = await consultarPropios();
    expect(vigencias(data)).toEqual({
      "LECT-18": ["18", true],
      "LECT-16": ["7", false],
      "LECT-0": ["0", true],
    });
    expect(data.tasasItbis).toEqual(["18", "16", "0"]);

    const detalle = await obtenerProductoPorIdAction({ id: ids["16"] });
    expect(detalle.ok).toBe(true);
    if (detalle.ok) expect(detalle.data).toMatchObject({ tasaItbis: "7", tasaVigente: false });

    const listado = await listarProductosAction({ page: 1, limit: 100, descripcion: "Lectura tasa" });
    expect(listado.ok).toBe(true);
    if (listado.ok) {
      expect(listado.data.items.map((i) => [i.codigo, i.tasaItbis]).sort()).toEqual([
        ["LECT-0", "0"],
        ["LECT-16", "7"],
        ["LECT-18", "18"],
      ]);
    }
  });

  it("S4: narrowing the list to 16,0 makes the 18% product retired; restoring brings it back", async () => {
    try {
      await cambiarFila(fixture.empresaA.id, { valor: "16,0" });
      const data = await consultarPropios();
      expect(data.tasasItbis).toEqual(["16", "0"]);
      expect(vigencias(data)["LECT-18"]).toEqual(["18", false]);
      expect(vigencias(data)["LECT-16"]).toEqual(["16", true]);

      const detalle = await obtenerProductoPorIdAction({ id: ids["18"] });
      expect(detalle.ok && detalle.data.tasaVigente).toBe(false);
    } finally {
      await cambiarFila(fixture.empresaA.id, { valor: "18,16,0" });
    }
    expect(vigencias(await consultarPropios())["LECT-18"]).toEqual(["18", true]);
  });

  it("S15: an inactive key makes list, detail and consulta return TASA_ITBIS_CONFIG_FALTANTE", async () => {
    try {
      await cambiarFila(fixture.empresaA.id, { activa: false });
      const resultados = [
        await consultarProductosAction({ page: 1, limit: 25 }),
        await listarProductosAction({ page: 1, limit: 25 }),
        await obtenerProductoPorIdAction({ id: ids["18"] }),
      ];
      for (const r of resultados) {
        expect(r).toEqual({
          ok: false,
          error: { code: "TASA_ITBIS_CONFIG_FALTANTE", message: MENSAJE_CONFIG_FALTANTE },
        });
      }
    } finally {
      await cambiarFila(fixture.empresaA.id, { activa: true });
    }
    expect((await consultarProductosAction({ page: 1, limit: 25 })).ok).toBe(true);
  });

  it("S15: a malformed value fails loud the same way", async () => {
    try {
      await cambiarFila(fixture.empresaA.id, { valor: "18,,0" });
      const r = await consultarProductosAction({ page: 1, limit: 25 });
      expect(r.ok === false && r.error.code).toBe("TASA_ITBIS_CONFIG_FALTANTE");
    } finally {
      await cambiarFila(fixture.empresaA.id, { valor: "18,16,0" });
    }
  });

  it("a caller of another empresa never sees these products (tenant filter unchanged)", async () => {
    const db = getHarnessDb();
    const rolAdmin = await db.rol.findFirstOrThrow({ where: { nombre: "Administrador" } });
    await db.usuario.update({
      where: { id: fixture.usuarios.adminB.id },
      data: { roles: { create: { rolId: rolAdmin.id } } },
    });
    ctxActual = {
      empresaId: fixture.empresaB.id,
      sucursalId: fixture.sucursalB1.id,
      usuarioId: fixture.usuarios.adminB.id,
      esAdmin: true,
    };
    const data = await consultarPropios();
    expect(data.items).toEqual([]);
    const detalle = await obtenerProductoPorIdAction({ id: ids["18"] });
    expect(detalle.ok === false && detalle.error.code).toBe("PRODUCTO_NO_ENCONTRADO");
  });
});
