/**
 * Integration — product create/update validate the ITBIS rate against the
 * per-empresa list `TASA_ITBIS` (feature `itbis-tasas-config`, sub-slice 3b),
 * on real Postgres with RLS on. The REAL server actions run with the real
 * tenant wrapper; only the Supabase session lookup is replaced by a fixed
 * tenant context. Every test restores the config rows it changes.
 *
 * Covers S12 (an old product stays editable when its rate is unchanged),
 * S14 (TASA_ITBIS_INVALIDA with the list-derived sentence) and S15 (a missing
 * key fails loud and writes nothing).
 */

import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import {
  actualizarProductoAction,
  crearProductoAction,
} from "@/modules/producto/http/actions.escritura";
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
let ctxA: TenantCtx;
let categoriaA: number;
let secuencia = 0;

async function cambiarFila(
  empresaId: number,
  data: { valor?: string; activa?: boolean },
): Promise<void> {
  await getHarnessDb().configuracionEmpresa.updateMany({
    where: { empresaId, clave: "TASA_ITBIS" },
    data,
  });
}

function crear(tasa: string, codigo?: string) {
  secuencia += 1;
  return crearProductoAction({
    categoriaId: categoriaA,
    codigo: codigo ?? `TASA-${secuencia}`,
    nombre: `Producto tasa ${tasa}`,
    precioVenta: "100.00",
    itbisTasa: tasa,
    itbisAplicaRetencionITBIS: false,
  });
}

const contarProductos = (empresaId: number) =>
  getHarnessDb().producto.count({ where: { empresaId } });

async function leerProducto(id: number) {
  return getHarnessDb().producto.findUniqueOrThrow({
    where: { id },
    select: { nombre: true, tasaItbis: true, version: true },
  });
}

describe("producto write path vs the TASA_ITBIS list (real DB)", () => {
  beforeEach(async () => {
    fixture = await seedTenantFixture();
    ctxA = {
      empresaId: fixture.empresaA.id,
      sucursalId: fixture.sucursalA1.id,
      usuarioId: fixture.usuarios.adminA.id,
      esAdmin: true,
    };
    ctxActual = ctxA;
    const categoria = await getHarnessDb().categoria.findFirstOrThrow({
      where: { empresaId: fixture.empresaA.id },
    });
    categoriaA = categoria.id;
  });

  it("list 18,16,0 creates a product at each of the three rates", async () => {
    for (const tasa of ["18", "16", "0"]) {
      const result = await crear(tasa);
      expect(result.ok).toBe(true);
      if (result.ok) {
        const fila = await leerProducto(result.data.id);
        expect(Number(fila.tasaItbis)).toBe(Number(tasa));
      }
    }
  });

  it("S14: a rate outside the list is TASA_ITBIS_INVALIDA with the list sentence, nothing written", async () => {
    const antes = await contarProductos(fixture.empresaA.id);

    const result = await crear("19");

    expect(result).toEqual({
      ok: false,
      error: {
        code: "TASA_ITBIS_INVALIDA",
        message: "La tasa de ITBIS debe ser 0%, 16% o 18%",
      },
    });
    expect(await contarProductos(fixture.empresaA.id)).toBe(antes);
  });

  it("a malformed rate is still VALIDATION_ERROR (shape only in zod)", async () => {
    const antes = await contarProductos(fixture.empresaA.id);

    for (const tasa of ["abc", "", "-1"]) {
      const result = await crear(tasa);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("VALIDATION_ERROR");
    }
    expect(await contarProductos(fixture.empresaA.id)).toBe(antes);
  });

  it("S14: with 18 retired (list 16,0) creating at 18 is refused, at 16 works", async () => {
    const creado = await crear("18");
    expect(creado.ok).toBe(true);
    const antes = await contarProductos(fixture.empresaA.id);
    try {
      await cambiarFila(fixture.empresaA.id, { valor: "16,0" });

      const refused = await crear("18");
      expect(refused).toEqual({
        ok: false,
        error: {
          code: "TASA_ITBIS_INVALIDA",
          message: "La tasa de ITBIS debe ser 0% o 16%",
        },
      });
      expect(await contarProductos(fixture.empresaA.id)).toBe(antes);

      const permitido = await crear("16");
      expect(permitido.ok).toBe(true);
      expect(await contarProductos(fixture.empresaA.id)).toBe(antes + 1);
    } finally {
      await cambiarFila(fixture.empresaA.id, { valor: "18,16,0" });
    }
  });

  it("S12: an old 18% product stays editable after 18 is retired; only changing TO a retired rate is refused", async () => {
    const creado = await crear("18");
    expect(creado.ok).toBe(true);
    if (!creado.ok) return;
    const id = creado.data.id;
    try {
      await cambiarFila(fixture.empresaA.id, { valor: "16,0" });

      // Rename without sending the rate.
      const v1 = (await leerProducto(id)).version;
      const renombrado = await actualizarProductoAction({ id, version: v1, nombre: "Renombrado" });
      expect(renombrado.ok).toBe(true);

      // Resubmitting the unchanged (retired) rate is not blocked either.
      const v2 = (await leerProducto(id)).version;
      const mismaTasa = await actualizarProductoAction({
        id,
        version: v2,
        nombre: "Renombrado dos",
        itbisTasa: "18",
      });
      expect(mismaTasa.ok).toBe(true);
      const tras = await leerProducto(id);
      expect(tras.nombre).toBe("Renombrado dos");
      expect(Number(tras.tasaItbis)).toBe(18);

      // Changing to an allowed rate works.
      const a16 = await actualizarProductoAction({ id, version: tras.version, itbisTasa: "16" });
      expect(a16.ok).toBe(true);

      // Going back to the retired 18 is refused and leaves the row untouched.
      const antes = await leerProducto(id);
      const refused = await actualizarProductoAction({ id, version: antes.version, itbisTasa: "18" });
      expect(refused).toEqual({
        ok: false,
        error: {
          code: "TASA_ITBIS_INVALIDA",
          message: "La tasa de ITBIS debe ser 0% o 16%",
        },
      });
      const despues = await leerProducto(id);
      expect(despues).toEqual(antes);
      expect(Number(despues.tasaItbis)).toBe(16);
    } finally {
      await cambiarFila(fixture.empresaA.id, { valor: "18,16,0" });
    }
  });

  it("narrowing empresa B's list does not change what empresa A may create", async () => {
    try {
      await cambiarFila(fixture.empresaB.id, { valor: "16,0" });
      const result = await crear("18");
      expect(result.ok).toBe(true);
    } finally {
      await cambiarFila(fixture.empresaB.id, { valor: "18,16,0" });
    }
  });

  it("S15: an inactive (missing) key fails loud on create and writes nothing", async () => {
    const antes = await contarProductos(fixture.empresaA.id);
    try {
      await cambiarFila(fixture.empresaA.id, { activa: false });

      const result = await crear("18");

      expect(result).toEqual({
        ok: false,
        error: { code: "TASA_ITBIS_CONFIG_FALTANTE", message: MENSAJE_CONFIG_FALTANTE },
      });
      expect(await contarProductos(fixture.empresaA.id)).toBe(antes);
    } finally {
      await cambiarFila(fixture.empresaA.id, { activa: true });
    }
  });

  it("S15: a malformed stored list fails loud on update and leaves the row untouched", async () => {
    const creado = await crear("18");
    expect(creado.ok).toBe(true);
    if (!creado.ok) return;
    const antes = await leerProducto(creado.data.id);
    try {
      await cambiarFila(fixture.empresaA.id, { valor: "18,abc" });

      const result = await actualizarProductoAction({
        id: creado.data.id,
        version: antes.version,
        nombre: "No debe guardarse",
      });

      expect(result).toEqual({
        ok: false,
        error: { code: "TASA_ITBIS_CONFIG_FALTANTE", message: MENSAJE_CONFIG_FALTANTE },
      });
      expect(await leerProducto(creado.data.id)).toEqual(antes);
    } finally {
      await cambiarFila(fixture.empresaA.id, { valor: "18,16,0" });
    }
  });
});
