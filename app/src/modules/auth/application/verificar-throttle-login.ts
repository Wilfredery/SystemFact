import {
  VENTANA_INTENTOS_MS,
  evaluarThrottle,
  normalizarClaveUsuario,
} from "../domain/login-throttle";

/**
 * Application seam for the login throttle (docs/22 T3, ADR-020).
 *
 * Two responsibilities, both thin on purpose: turn `(ip, username)` into the counter
 * key the domain expects, and hand the recorded attempts to the pure policy. The
 * adapter above (the Server Action) says WHEN to check; the domain says WHAT the
 * verdict is; this file is the only place that knows both.
 *
 * The port is declared HERE, not in `infrastructure/`, so this layer never imports
 * Prisma: the Prisma implementation implements this interface and the http adapter
 * injects it. That is what lets these functions be proven with a fake store and no
 * database — and it keeps the dependency arrow pointing inward.
 */

/** Storage the throttle needs. Implemented by `infrastructure/login-attempt-repository`. */
export interface AlmacenIntentosLogin {
  /** Records one failed attempt for the pair. */
  registrar(ip: string, nombreUsuarioNormalizado: string, momento: Date): Promise<void>;
  /** Failure timestamps (epoch ms) for the pair since `desde`. */
  listar(ip: string, nombreUsuarioNormalizado: string, desde: Date): Promise<number[]>;
  /** Forgets the pair — called on a successful sign-in. */
  limpiar(ip: string, nombreUsuarioNormalizado: string): Promise<void>;
  /** Drops every row older than `corte`. Returns how many rows went away. */
  barrer(corte: Date): Promise<number>;
}

export type VeredictoLogin = { permitido: true } | { permitido: false; esperarMs: number };

/**
 * Fail-open must never be silent.
 *
 * A security control that is quietly OFF is worse than one that is visibly off: a dropped
 * table, a revoked grant or a migration that never ran would remove the throttle and the
 * only people who could notice are reading logs. There is no logger contract in this
 * module, so this uses the one channel a deployment actually collects — stderr — with the
 * action that failed as the first token, so it is greppable and attributable.
 */
function avisarContadorNoDisponible(accion: "verificar" | "registrar" | "limpiar", error: unknown): void {
  console.error(`[auth.throttle] attempt counter unavailable (${accion}); continuing without it`, error);
}

/**
 * THE FAIL-OPEN DECISION, recorded here because it is a security trade, not an
 * implementation detail.
 *
 * If the counter cannot be read, this returns "permitido". The alternative — failing
 * closed — would convert a problem with one ops table into a total login outage, which
 * is precisely the app-wide lockout lever docs/22 T3 is trying to avoid. It costs
 * little in practice: the sign-in that follows reads `USUARIO` through Prisma too, so a
 * database that cannot answer the counter cannot complete a login either — failing open
 * here does not open a path that was otherwise closed.
 *
 * The error itself is never swallowed: `avisarContadorNoDisponible` writes it to stderr
 * with the failing action as the first token, so a counter that is quietly OFF is visible
 * to whoever reads logs. What is swallowed here is the FAILURE, not the evidence — the
 * caller gets a typed verdict instead of an exception it cannot act on.
 */
export async function verificarThrottleLogin(
  nombreUsuario: string,
  ip: string,
  ahora: number,
  almacen: AlmacenIntentosLogin,
): Promise<VeredictoLogin> {
  const clave = normalizarClaveUsuario(nombreUsuario);
  try {
    const intentos = await almacen.listar(ip, clave, new Date(ahora - VENTANA_INTENTOS_MS));
    const veredicto = evaluarThrottle(intentos, ahora);
    return veredicto.bloqueado
      ? { permitido: false, esperarMs: veredicto.esperarMs }
      : { permitido: true };
  } catch (error) {
    avisarContadorNoDisponible("verificar", error);
    return { permitido: true };
  }
}

/**
 * Records one failed attempt and sweeps the expired tail in the same call.
 *
 * The sweep rides along instead of running on a timer: this table has no scheduler, and
 * a bounded indexed DELETE on the only path that writes it keeps the row count tied to
 * the window instead of to history. It runs after a FAILED sign-in — traffic that is
 * already rare and already delayed by the policy — never on the success path.
 */
export async function registrarFalloDeLogin(
  nombreUsuario: string,
  ip: string,
  ahora: number,
  almacen: AlmacenIntentosLogin,
): Promise<void> {
  const clave = normalizarClaveUsuario(nombreUsuario);
  try {
    await almacen.registrar(ip, clave, new Date(ahora));
    await almacen.barrer(new Date(ahora - VENTANA_INTENTOS_MS));
  } catch (error) {
    // Same reasoning as the fail-open above: an unhealthy counter must not turn a
    // rejected login into a 500 the user cannot act on. The sign-in outcome stands.
    avisarContadorNoDisponible("registrar", error);
    return;
  }
}

/**
 * Forgets the pair after a successful sign-in, so honest typos do not follow a user
 * into their next session (S6). Also fail-open, for the same reason.
 */
export async function registrarExitoDeLogin(
  nombreUsuario: string,
  ip: string,
  almacen: AlmacenIntentosLogin,
): Promise<void> {
  const clave = normalizarClaveUsuario(nombreUsuario);
  try {
    await almacen.limpiar(ip, clave);
  } catch (error) {
    avisarContadorNoDisponible("limpiar", error);
    return;
  }
}
