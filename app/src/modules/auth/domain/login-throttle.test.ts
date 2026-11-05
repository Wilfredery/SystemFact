import {
  ESPERA_BASE_MS,
  ESPERA_MAXIMA_MS,
  UMBRAL_INTENTOS,
  VENTANA_INTENTOS_MS,
  evaluarThrottle,
  normalizarClaveUsuario,
  normalizarIp,
} from "./login-throttle";

/**
 * docs/22 T3 / odd/tasks/login-brute-force.md S3 + S6.
 *
 * The acceptance criterion is behavioral, not structural: "a test proving N failures
 * lock out that (ip, username) pair and that other users/IPs are unaffected". The
 * pair separation lives in the key, so it is proven once here (pure policy) and once
 * at the service seam with a fake repository — never by inspecting the table.
 */
describe("evaluarThrottle — sliding window (S6)", () => {
  const ahora = 1_800_000_000_000;

  it("does not block a pair below the threshold", () => {
    const intentos = Array.from({ length: UMBRAL_INTENTOS - 1 }, (_, i) => ahora - i * 1_000);
    expect(evaluarThrottle(intentos, ahora)).toEqual({
      bloqueado: false,
      intentosFallidos: UMBRAL_INTENTOS - 1,
    });
  });

  it("blocks the pair once the threshold is reached, for the base delay", () => {
    const intentos = Array.from({ length: UMBRAL_INTENTOS }, (_, i) => ahora - i * 1_000);
    expect(evaluarThrottle(intentos, ahora)).toEqual({
      bloqueado: true,
      intentosFallidos: UMBRAL_INTENTOS,
      esperarMs: ESPERA_BASE_MS,
    });
  });

  it("escalates exponentially with each further failure and never locks permanently", () => {
    const espera = (cantidad: number) =>
      evaluarThrottle(
        Array.from({ length: cantidad }, (_, i) => ahora - i * 1_000),
        ahora,
      );

    expect(espera(UMBRAL_INTENTOS + 1)).toEqual({
      bloqueado: true,
      intentosFallidos: UMBRAL_INTENTOS + 1,
      esperarMs: ESPERA_BASE_MS * 2,
    });
    expect(espera(UMBRAL_INTENTOS + 2)).toEqual({
      bloqueado: true,
      intentosFallidos: UMBRAL_INTENTOS + 2,
      esperarMs: ESPERA_BASE_MS * 4,
    });

    // 200 failures is an attacker, not a user: the answer is still a delay that
    // expires, capped far below any "permanent lockout" the spec forbids.
    const salvaje = espera(200);
    expect(salvaje).toEqual({
      bloqueado: true,
      intentosFallidos: 200,
      esperarMs: ESPERA_MAXIMA_MS,
    });
  });

  it("ignores attempts that already left the window", () => {
    // The threshold is met, but every attempt is older than the window: the pair
    // is free again, which is what makes the delay expire instead of accumulating.
    const viejos = Array.from(
      { length: UMBRAL_INTENTOS + 3 },
      (_, i) => ahora - VENTANA_INTENTOS_MS - 1 - i * 1_000,
    );
    expect(evaluarThrottle(viejos, ahora)).toEqual({
      bloqueado: false,
      intentosFallidos: 0,
    });
  });

  it("counts only the attempts inside the window when both kinds are present", () => {
    const mezcla = [
      ahora - 1_000,
      ahora - 2_000,
      ahora - VENTANA_INTENTOS_MS - 1,
      ahora - VENTANA_INTENTOS_MS - 2,
      ahora - VENTANA_INTENTOS_MS - 3,
      ahora - VENTANA_INTENTOS_MS - 4,
    ];
    expect(evaluarThrottle(mezcla, ahora)).toEqual({
      bloqueado: false,
      intentosFallidos: 2,
    });
  });

  it("is order-independent: timestamps need not arrive sorted", () => {
    const desordenados = [ahora - 5_000, ahora - 1_000, ahora - 3_000, ahora - 2_000, ahora];
    expect(evaluarThrottle(desordenados, ahora)).toEqual({
      bloqueado: true,
      intentosFallidos: 5,
      esperarMs: ESPERA_BASE_MS,
    });
  });
});

describe("normalizarClaveUsuario — the counter cannot be reset by typing", () => {
  it("folds case, tabs and surrounding spaces into one key", () => {
    expect(normalizarClaveUsuario("  Admin ")).toBe("admin");
    expect(normalizarClaveUsuario("ADMIN")).toBe("admin");
    expect(normalizarClaveUsuario("\tadmin\n")).toBe("admin");
  });

  it("keeps distinct usernames distinct", () => {
    expect(normalizarClaveUsuario("admin")).not.toBe(normalizarClaveUsuario("admin2"));
  });
});

describe("normalizarIp — x-forwarded-for is attacker-controlled text", () => {
  it("takes the first hop and drops the port", () => {
    expect(normalizarIp("203.0.113.7:51234, 10.0.0.1")).toBe("203.0.113.7");
  });

  it("keeps an IPv6 address and strips its brackets", () => {
    expect(normalizarIp("[2001:db8::1]:443")).toBe("2001:db8::1");
  });

  it("falls back to a sentinel instead of inserting an unbounded value", () => {
    expect(normalizarIp(null)).toBe("desconocida");
    expect(normalizarIp("   ")).toBe("desconocida");
  });

  it("never returns more than the column can hold", () => {
    const enorme = "9".repeat(500);
    expect(normalizarIp(enorme).length).toBeLessThanOrEqual(45);
  });
});
