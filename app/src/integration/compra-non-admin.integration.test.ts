/**
 * Integration — real-DB non-admin rejection at the compra HTTP guard (RLS on).
 *
 * The Administrador-only gate lives INSIDE `withTenantTransaction` in the
 * Server Action layer (`compra/http/actions.ts`): `tieneRolPermitidoEnTx`
 * queries the user's actual DB roles. A Supabase session cannot be forged in
 * the harness, so this test replicates the action's exact guard flow against
 * the REAL database: a Operador-role usuario must receive the stable
 * NO_AUTORIZADO rejection and no compra row may ever be created.
 */

import { withTenantTransaction } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import { tieneRolPermitidoEnTx } from "@/modules/compra/infrastructure/compra-repository";
import { crearCompra } from "@/modules/compra/application/crear-compra";
import { NO_AUTORIZADO, messageFor } from "@/modules/compra/domain/errors";
import { getHarnessDb, seedTenantFixture, type TenantFixture } from "./setup/fixtures";

// Same allow-list as compra/http/actions.ts (compra-core is admin-only).
const ROLES_ADMIN_ONLY = ["Administrador"];

describe("compra action guard rejects non-admin (real DB)", () => {
  let fixture: TenantFixture;
  let ctxOperador: TenantCtx;

  beforeEach(async () => {
    fixture = await seedTenantFixture();

    // ROL.nombre is NOT unique in the schema — find-or-create (fixture rule).
    const db = getHarnessDb();
    let rolOperador = await db.rol.findFirst({ where: { nombre: "Operador" } });
    if (rolOperador === null) {
      rolOperador = await db.rol.create({
        data: { nombre: "Operador", descripcion: "Integration harness operador role" },
      });
    }
    const operador = await db.usuario.create({
      data: {
        empresaId: fixture.empresaA.id,
        sucursalId: fixture.sucursalA1.id,
        nombre: "Operador A",
        nombreUsuario: `intoper-a-${fixture.usuarios.adminA.nombreUsuario}`,
        passwordHash: "test-hash",
        roles: { create: { rolId: rolOperador.id } },
      },
    });

    ctxOperador = {
      empresaId: fixture.empresaA.id,
      sucursalId: fixture.sucursalA1.id,
      usuarioId: operador.id,
      esAdmin: false,
    };
  });

  it("Operador gets NO_AUTORIZADO and no compra row is created", async () => {
    const db = getHarnessDb();
    const countBefore = await db.compra.count({ where: { empresaId: fixture.empresaA.id } });

    // Exact body of crearCompraAction's withTenantTransaction block.
    const result = await withTenantTransaction(ctxOperador, async (tx) => {
      const permitido = await tieneRolPermitidoEnTx(
        tx,
        ctxOperador.usuarioId,
        ctxOperador.empresaId,
        ROLES_ADMIN_ONLY,
      );
      if (!permitido) {
        return { ok: false, error: { code: NO_AUTORIZADO, message: messageFor(NO_AUTORIZADO) } };
      }
      const created = await crearCompra(tx, ctxOperador, {
        proveedorId: fixture.proveedores.formalJuridica.id,
        tipoCompra: "MERCANCIA",
        fecha: new Date("2026-01-10T00:00:00.000Z"),
        lineas: [
          { productoId: fixture.productos.prodA1.id, cantidad: "1.000", costoUnitario: "50.00" },
        ],
      });
      if (!created.ok) {
        return { ok: false, error: { code: created.code, message: created.message } };
      }
      return { ok: true, data: created.data };
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error?.code).toBe(NO_AUTORIZADO);
    }
    expect(await db.compra.count({ where: { empresaId: fixture.empresaA.id } })).toBe(countBefore);
  });
});
