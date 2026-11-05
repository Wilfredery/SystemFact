import { normalizarClaveUsuario } from "../domain/login-throttle";

/**
 * Application seam for the login throttle (docs/22 T3, ADR-020).
 *
 * The port is declared HERE, not in `infrastructure/`, so this layer never imports Prisma:
 * the Prisma implementation implements this interface and the http adapter injects it. That
 * is what keeps the dependency arrow pointing inward and lets the fail-open and undo paths
 * be proven with a fake store.
 *
 * `intentar` is ONE operation on purpose (finding `R4-002`): the count and the insert must
 * be a single decision, taken under a lock by the implementation. A port with `listar` +
 * `registrar` invites exactly the two-statement bug that made a concurrent burst able to
 * slip past the counter.
 */

export type ResultadoIntento =
  | { permitido: true; id: number }
  | { permitido: false; esperarMs: number };

/** Storage the throttle needs. Implemented by `infrastructure/login-attempt-repository`. */
export interface AlmacenIntentosLogin {
  /** Counts this pair and records the attempt, atomically, returning the new row id. */
  intentar(ip: string, clave: string, ahoraMs: number): Promise<ResultadoIntento>;
  /** Removes one specific attempt (used when the refusal was not a password guess). */
  descartar(id: number): Promise<void>;
  /** Forgets the pair — called on a successful sign-in. */
  limpiar(ip: string, clave: string): Promise<void>;
}

export type VeredictoLogin =
  | { permitido: true; intentoId: number | null }
  | { permitido: false; esperarMs: number };

/**
 * Fail-open must never be silent.
 *
 * A security control that is quietly OFF is worse than one that is visibly off: a dropped
 * table, a revoked grant or a policy that stopped matching the runtime role would remove the
 * throttle and the only people who could notice are reading logs. There is no logger contract
 * in this module, so this uses the channel a deployment actually collects — stderr — with the
 * action as the first token, so it is greppable and attributable.
 */
function avisarContadorNoDisponible(accion: "intentar" | "descartar" | "limpiar", error: unknown): void {
  console.error(`[auth.throttle] attempt counter unavailable (${accion}); continuing without it`, error);
}

/**
 * THE FAIL-OPEN DECISION, recorded here because it is a security trade, not an
 * implementation detail.
 *
 * If the counter cannot be read or written, this permits the attempt. Failing closed would
 * turn a problem with one ops table into a total login outage — the app-wide lockout lever
 * docs/22 T3 exists to avoid. The sign-in that follows reads `USUARIO` through Prisma too, so
 * a database that cannot answer the counter cannot complete a login either.
 *
 * The error is never swallowed: `avisarContadorNoDisponible` writes it to stderr. What is
 * swallowed is the FAILURE, not the evidence.
 */
export async function intentarAccesoDeLogin(
  nombreUsuario: string,
  ip: string,
  ahora: number,
  almacen: AlmacenIntentosLogin,
): Promise<VeredictoLogin> {
  const clave = normalizarClaveUsuario(nombreUsuario);
  try {
    const resultado = await almacen.intentar(ip, clave, ahora);
    return resultado.permitido
      ? { permitido: true, intentoId: resultado.id }
      : { permitido: false, esperarMs: resultado.esperarMs };
  } catch (error) {
    avisarContadorNoDisponible("intentar", error);
    // `intentoId: null` means "nothing to undo": no row was committed.
    return { permitido: true, intentoId: null };
  }
}

/**
 * Undoes the attempt when the refusal was NOT a password guess.
 *
 * A refused inactive account, a policy rejection or a provider outage is reached with
 * credentials Auth already accepted (or not evaluated at all). Counting those would let anyone
 * who knows a valid password — or anyone at all during an outage — lock a named account out.
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
