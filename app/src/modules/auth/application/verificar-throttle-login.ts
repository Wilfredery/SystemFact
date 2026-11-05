import {
  VENTANA_INTENTOS_MS,
  evaluarThrottle,
  normalizarClaveUsuario,
} from "../domain/login-throttle";

/**
 * Application seam for the login throttle (docs/22 T3, ADR-020).
 *
 * Three responsibilities, all thin on purpose: turn `(ip, username)` into the counter
 * key the domain expects, hand the recorded attempts to the pure policy, and keep the
 * write ordering that makes the throttle actually hold under a burst.
 *
 * The port is declared HERE, not in `infrastructure/`, so this layer never imports
 * Prisma: the Prisma implementation implements this interface and the http adapter
 * injects it. That is what lets these functions be proven with a fake store and no
 * database — and it keeps the dependency arrow pointing inward.
 */

/** Storage the throttle needs. Implemented by `infrastructure/login-attempt-repository`. */
export interface AlmacenIntentosLogin {
  /** Records one attempt for the pair and returns the row id, so it can be undone. */
  registrar(ip: string, nombreUsuarioNormalizado: string, momento: Date): Promise<number>;
  /** Removes one specific attempt (used when the refusal was not a password guess). */
  descartar(id: number): Promise<void>;
  /** Attempt timestamps (epoch ms) for the pair since `desde`. */
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
function avisarContadorNoDisponible(
  accion: "verificar" | "registrar" | "barrer" | "descartar" | "limpiar",
  error: unknown,
): void {
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
 * Records the attempt BEFORE the guess is sent to the provider, and returns its id.
 *
 * The ordering is the point. Counting first and inserting afterwards leaves the whole
 * provider round-trip as a window in which a concurrent burst all passes the same check —
 * which is exactly the burst a brute-force attempt is. Writing first makes each attempt
 * visible to the next one, so the window shrinks from hundreds of milliseconds to the
 * microseconds between the read and this insert.
 *
 * Honest limit: this is not atomic. True atomicity would need the count and the insert in
 * one statement or one transaction with a lock, and the residual window here is small
 * enough that the provider's own per-IP limit (150 password grants / 5 min) is the next
 * backstop rather than this counter. Recorded so nobody reads this as a guarantee.
 *
 * The sweep rides along instead of running on a timer: this table has no scheduler, and a
 * bounded indexed DELETE on the only path that writes it keeps the row count tied to the
 * window instead of to history.
 */
export async function registrarIntentoDeLogin(
  nombreUsuario: string,
  ip: string,
  ahora: number,
  almacen: AlmacenIntentosLogin,
): Promise<number | null> {
  const clave = normalizarClaveUsuario(nombreUsuario);

  // The insert and the sweep are separated on purpose: once the row is committed the caller
  // MUST receive its id, or it cannot undo an attempt that turns out not to be a guess. A
  // shared try would return null for a committed row whenever the sweep failed.
  let id: number;
  try {
    id = await almacen.registrar(ip, clave, new Date(ahora));
  } catch (error) {
    avisarContadorNoDisponible("registrar", error);
    return null;
  }

  try {
    await almacen.barrer(new Date(ahora - VENTANA_INTENTOS_MS));
  } catch (error) {
    avisarContadorNoDisponible("barrer", error);
  }

  return id;
}

/**
 * Undoes the attempt when the refusal was NOT a password guess.
 *
 * A refused inactive account or a password-policy rejection is reached with credentials
 * Auth already accepted. Counting it would let anyone who knows a valid password lock that
 * account out, so the row is removed instead of left to age.
 */
export async function descartarIntentoDeLogin(
  id: number | null,
  almacen: AlmacenIntentosLogin,
): Promise<void> {
  if (id === null) return;
  try {
    await almacen.descartar(id);
  } catch (error) {
    avisarContadorNoDisponible("descartar", error);
  }
}

/**
 * Forgets the pair after a successful sign-in, so honest typos do not follow a user into
 * their next session (S6) — and so the attempt this login wrote does not linger.
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
  }
}
