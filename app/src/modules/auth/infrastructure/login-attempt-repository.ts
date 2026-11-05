import { prisma } from "@/lib/prisma";
import type { AlmacenIntentosLogin } from "../application/verificar-throttle-login";

/**
 * Prisma access for the login throttle counter (docs/22 T3, ADR-020).
 *
 * THIS IS THE DOCUMENTED EXCEPTION TO `withTenantTransaction`. The login path runs
 * before any session or `empresaId` exists, so there is no `TenantCtx` to enter the
 * wrapper with — and `LOGIN_INTENTO` holds no tenant data to scope. The exception is
 * bounded in ADR-020: no tenant columns, no PostgREST grant, deny-all RLS policy,
 * swept rows. Do not "fix" this by adding `empresaId`, and do not call these from any
 * context that DOES have a tenant — there, the wrapper is mandatory.
 *
 * Every function takes the moment from the caller so the repository stays clock-free
 * and the policy stays testable: the domain decides, this file only persists.
 */

export const almacenIntentosPrisma: AlmacenIntentosLogin = {
  async registrar(ip, nombreUsuarioNormalizado, momento) {
    const fila = await prisma.loginIntento.create({
      data: { ip, nombreUsuarioNormalizado, creadoEn: momento },
      select: { id: true },
    });
    return fila.id;
  },

  async descartar(id) {
    await prisma.loginIntento.deleteMany({ where: { id } });
  },

  async listar(ip, nombreUsuarioNormalizado, desde) {
    const filas = await prisma.loginIntento.findMany({
      where: { ip, nombreUsuarioNormalizado, creadoEn: { gte: desde } },
      select: { creadoEn: true },
      // Bounded by construction: the window is short and a pair that keeps failing is
      // delayed by the policy long before this list could grow without limit. Truncation
      // cannot make the verdict too permissive — the delay is already at its cap by the
      // tenth attempt, so any 500 rows inside the window are far past the threshold.
      take: 500,
    });
    return filas.map((fila) => fila.creadoEn.getTime());
  },

  async limpiar(ip, nombreUsuarioNormalizado) {
    await prisma.loginIntento.deleteMany({
      where: { ip, nombreUsuarioNormalizado },
    });
  },

  async barrer(corte) {
    const { count } = await prisma.loginIntento.deleteMany({
      where: { creadoEn: { lt: corte } },
    });
    return count;
  },
};
