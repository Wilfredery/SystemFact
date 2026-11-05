import { prisma } from "@/lib/prisma";
import { VENTANA_INTENTOS_MS, evaluarThrottle } from "../domain/login-throttle";
import type { AlmacenIntentosLogin, ResultadoIntento } from "../application/verificar-throttle-login";

/**
 * Prisma access for the login throttle counter (docs/22 T3, ADR-020).
 *
 * THIS IS THE DOCUMENTED EXCEPTION TO `withTenantTransaction`. The login path runs
 * before any session or `empresaId` exists, so there is no `TenantCtx` to enter the
 * wrapper with — and `LOGIN_INTENTO` holds no tenant data to scope. The exception is
 * bounded in ADR-020: no tenant columns, no PostgREST grant, a permissive policy scoped
 * to the runtime role, and swept rows. Do not "fix" this by adding `empresaId`, and do
 * not call these from any context that DOES have a tenant — there, the wrapper is
 * mandatory.
 *
 * The moment comes from the caller so the repository stays clock-free.
 */

/**
 * Counts and records ONE attempt atomically (docs/22 T3, finding `R4-002`).
 *
 * The count and the insert are a single decision inside one transaction, serialized per
 * pair with a transaction-scoped advisory lock. Doing them as two statements — read, then
 * insert — left the gap between them as a window in which a concurrent burst all read the
 * same count and all proceeded, which is exactly the shape of a brute-force attempt.
 *
 * WHY THE LOCK IS `xact`: it releases on commit or rollback, so a thrown error cannot leak
 * it, and it serializes only the SAME pair — two different users, or one user from two
 * addresses, never queue behind each other.
 *
 * The policy decision lives here rather than in the application layer for one reason: it
 * must run INSIDE the locked transaction to be meaningful. The pair separation it depends
 * on is proven by the integration tests against real SQL, not by a fake store.
 */
export const almacenIntentosPrisma: AlmacenIntentosLogin = {
  async intentar(ip, clave, ahoraMs) {
    const corte = new Date(ahoraMs - VENTANA_INTENTOS_MS);

    return prisma.$transaction(async (tx): Promise<ResultadoIntento> => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${ip}|${clave}`}))`;

      const filas = await tx.loginIntento.findMany({
        where: { ip, nombreUsuarioNormalizado: clave, creadoEn: { gte: corte } },
        select: { creadoEn: true },
        // NEWEST FIRST, and that is load-bearing, not cosmetic: the policy derives the
        // remaining delay from the most recent attempt, so an unordered `take` that dropped
        // the newest rows would compute a delay of zero and let the attack through.
        orderBy: { creadoEn: "desc" },
        take: 500,
      });

      const veredicto = evaluarThrottle(
        filas.map((fila) => fila.creadoEn.getTime()),
        ahoraMs,
      );

      if (veredicto.bloqueado) {
        return { permitido: false, esperarMs: veredicto.esperarMs };
      }

      const fila = await tx.loginIntento.create({
        data: { ip, nombreUsuarioNormalizado: clave, creadoEn: new Date(ahoraMs) },
        select: { id: true },
      });

      // Sweep rides along in the same transaction: cheap with the standalone `creadoEn`
      // index, and it keeps the row count tied to the window instead of to history.
      await tx.loginIntento.deleteMany({ where: { creadoEn: { lt: corte } } });

      return { permitido: true, id: fila.id };
    });
  },

  async descartar(id) {
    await prisma.loginIntento.deleteMany({ where: { id } });
  },

  async limpiar(ip, nombreUsuarioNormalizado) {
    await prisma.loginIntento.deleteMany({ where: { ip, nombreUsuarioNormalizado } });
  },
};
