/**
 * Login brute-force policy — pure domain.
 *
 * docs/22 T3 (Option B) / odd/tasks/login-brute-force.md S6, ADR-020.
 *
 * Pure TypeScript: no Next.js, no Prisma, no Supabase, no clock. The caller passes
 * "now" and the timestamps it read, so the whole policy is decidable without a
 * database and testable without waiting.
 *
 * THE POLICY, in one sentence: inside a sliding window, N failures on one
 * `(ip, username)` pair turn into an escalating *delay*, never into a permanent
 * lockout — because a permanent per-username lock is itself a denial-of-service
 * lever against a user whose name an attacker already knows.
 *
 * The key is what makes it a per-account control at all. Supabase's own rate limits
 * key on the IP of whoever calls it, and this app calls it from a Server Action, so
 * the provider sees the SERVER's IP for every user (docs/22 T3, verified 2026-11-03).
 * The pair is the smallest unit that separates one attacker from one user.
 */

/** Sliding window the failures are counted in. */
export const VENTANA_INTENTOS_MS = 15 * 60_000;

/** Failures inside the window that start the delay. */
export const UMBRAL_INTENTOS = 5;

/** Delay applied at the threshold. */
export const ESPERA_BASE_MS = 30_000;

/**
 * Ceiling of the escalating delay. Deliberately equal to the window: the longest a
 * pair can be delayed is the longest it takes for that history to age out, so the
 * delay and the window expire together and neither becomes a lockout.
 */
export const ESPERA_MAXIMA_MS = 15 * 60_000;

/** Longest value the `LOGIN_INTENTO.ip` column accepts (`VARCHAR(45)`). */
const IP_MAXIMA = 45;

/** Stored when no usable hop could be read. Never an empty string: the column is NOT NULL. */
export const IP_DESCONOCIDA = "desconocida";

export type VeredictoThrottle =
  | { bloqueado: false; intentosFallidos: number }
  | { bloqueado: true; intentosFallidos: number; esperarMs: number };

/**
 * Decides whether an attempt on this pair must be delayed, and for how long.
 *
 * `intentos` are the attempt timestamps (epoch ms) recorded for ONE pair; order does not
 * matter and neither does length — everything outside the window is discarded before
 * counting.
 *
 * THE DELAY IS ENFORCED BY ELAPSED TIME, not by the count alone. At or above the
 * threshold the pair is refused only until `esperaParaIntentos` has passed since the most
 * recent attempt; after that the next attempt is allowed even though the count is still
 * over the threshold, and a further failure escalates to the next step. Counting alone
 * would refuse the pair until the attempts aged out of the window — up to 15 minutes for
 * five typos, which is the permanent-lockout failure mode this policy exists to avoid.
 */
export function evaluarThrottle(intentos: readonly number[], ahora: number): VeredictoThrottle {
  const corte = ahora - VENTANA_INTENTOS_MS;
  const recientes = intentos.filter((momento) => momento > corte);

  if (recientes.length < UMBRAL_INTENTOS) {
    return { bloqueado: false, intentosFallidos: recientes.length };
  }

  const espera = esperaParaIntentos(recientes.length);
  const restante = espera - (ahora - Math.max(...recientes));

  if (restante <= 0) {
    return { bloqueado: false, intentosFallidos: recientes.length };
  }

  return { bloqueado: true, intentosFallidos: recientes.length, esperarMs: restante };
}

/**
 * Exponential delay: 30 s at the threshold, doubling per extra failure, capped.
 * Exported for the tests that pin the curve; the cap is what keeps the promise that
 * the block always expires.
 */
export function esperaParaIntentos(intentosFallidos: number): number {
  const nivel = intentosFallidos - UMBRAL_INTENTOS;
  if (nivel < 0) return 0;
  // 2 ** nivel stays an integer well past any realistic input; the cap below is what
  // bounds the value, and Math.min keeps an absurd `intentosFallidos` from producing
  // Infinity in the comparison.
  return Math.min(ESPERA_BASE_MS * 2 ** nivel, ESPERA_MAXIMA_MS);
}

/**
 * Normalizes the username into the counter key.
 *
 * Case-folded on purpose: the row lookup stays case-sensitive (ADR-014 — the
 * synthetic email must match byte for byte), but the COUNTER must not be resettable
 * by pressing shift. Someone attacking "Admin" after "admin" is the same attacker.
 */
export function normalizarClaveUsuario(nombreUsuario: string): string {
  return nombreUsuario.trim().toLowerCase();
}

/**
 * Extracts one bounded, storable IP from the header text.
 *
 * `x-forwarded-for` is client-supplied unless a trusted proxy rewrites it, so its
 * first hop is the best available signal, not proof: the control that matters is the
 * pair, and the pair survives a forged header because the username half is real.
 * Whatever arrives, the result is a single value that fits the column — an unbounded
 * provider string must never become a database error on the login path.
 *
 * The parsing distinguishes the three shapes that actually appear, because collapsing
 * them is how a per-IP control silently stops being per-anything: `[v6]:port`,
 * `v4:port`, and a bare address. A bare IPv6 address contains more than one colon and
 * has NO port to strip, so splitting it would truncate `2001:db8::1` to `2001` and put
 * every client in that hextet into one bucket.
 */
export function normalizarIp(cabecera: string | null | undefined): string {
  const primero = (cabecera ?? "").split(",")[0]?.trim() ?? "";
  if (primero === "") return IP_DESCONOCIDA;

  let direccion = primero;
  if (primero.startsWith("[")) {
    const cierre = primero.indexOf("]");
    direccion = cierre === -1 ? primero.slice(1) : primero.slice(1, cierre);
  } else if (primero.split(":").length > 2) {
    // Bare IPv6: keep the whole address, there is no port to remove.
    direccion = primero;
  } else if (primero.includes(":")) {
    // IPv4 with port.
    direccion = primero.split(":")[0] ?? "";
  }

  const limpia = direccion.trim();
  if (limpia === "") return IP_DESCONOCIDA;
  return limpia.slice(0, IP_MAXIMA);
}
