/**
 * Shared E2E DB probes (design D8, task 5.3).
 *
 * Superuser read for ASSERTIONS ONLY (RLS would tenant-filter the probe);
 * queries never mutate. The connection string falls back to the app URL when
 * DIRECT_URL is absent, identical to every spec's previous post-connection.
 */

import { Pool } from "pg";

export function openDb(): Pool {
  return new Pool({
    connectionString: process.env.DIRECT_URL ?? process.env.DATABASE_URL,
  });
}

export type UsuarioPrecond = {
  usuarioId: number;
  empresaId: number;
  sucursalId: number;
  rol: string;
};

/**
 * The superset user+rol precondition shared by the POS specs: the acting user
 * must exist, be active, and hold an Administrador/Operador role. Moved from
 * `confirm-venta.spec.ts`/`devolucion.spec.ts`; the cobros variant (a strict
 * subset — no sucursalId) folds into this one.
 */
export async function usuarioPrecond(
  pool: Pool,
  user: string,
): Promise<UsuarioPrecond> {
  const res = await pool.query(
    `select u.id as "usuarioId", u."empresaId", u."sucursalId", r.nombre as rol
       from "USUARIO" u
       left join "USUARIO_ROL" ur on ur."usuarioId" = u.id
       left join "ROL" r on r.id = ur."rolId"
      where u."nombreUsuario" = $1 and u.activo = true`,
    [user],
  );
  if (res.rowCount === 0) {
    throw new Error(
      `E2E_USER "${user}" not found in the precondition DB (DIRECT_URL/DATABASE_URL). ` +
        `Create the user row there, then run pnpm seed:venta && pnpm seed:ncf && pnpm seed:cliente.`,
    );
  }
  const row = res.rows[0];
  if (row.rol !== "Administrador" && row.rol !== "Operador") {
    throw new Error(
      `E2E_USER "${user}" has rol "${row.rol}"; this flow requires Administrador/Operador.`,
    );
  }
  return {
    usuarioId: row.usuarioId,
    empresaId: row.empresaId,
    sucursalId: row.sucursalId,
    rol: row.rol,
  };
}
