import {
  registrarExitoDeLogin,
  registrarFalloDeLogin,
  verificarThrottleLogin,
  type AlmacenIntentosLogin,
} from "./verificar-throttle-login";
import {
  ESPERA_BASE_MS,
  UMBRAL_INTENTOS,
  VENTANA_INTENTOS_MS,
} from "../domain/login-throttle";

/**
 * docs/22 T3 / S3 at the application seam.
 *
 * The acceptance criterion is "N failures lock out that (ip, username) pair and other
 * users/IPs are unaffected". The pair IS the key, so the criterion is proven twice: as
 * pure policy (`domain/login-throttle.test.ts`) and here against a fake store, which is
 * what shows the key is actually built from both halves and normalized. No database:
 * this is a decision seam, and the Prisma query it hides is one indexed read.
 */
function crearAlmacenFalso() {
  const filas = new Map<string, number[]>();
  const clave = (ip: string, usuario: string) => `${ip}|${usuario}`;
  const almacen: AlmacenIntentosLogin & { filas: Map<string, number[]> } = {
    filas,
    async registrar(ip, usuario, momento) {
      const k = clave(ip, usuario);
      filas.set(k, [...(filas.get(k) ?? []), momento.getTime()]);
    },
    async listar(ip, usuario, desde) {
      return (filas.get(clave(ip, usuario)) ?? []).filter((m) => m >= desde.getTime());
    },
    async limpiar(ip, usuario) {
      filas.delete(clave(ip, usuario));
    },
    async barrer(corte) {
      let borradas = 0;
      for (const [k, momentos] of filas) {
        const vivas = momentos.filter((m) => m >= corte.getTime());
        borradas += momentos.length - vivas.length;
        if (vivas.length === 0) filas.delete(k);
        else filas.set(k, vivas);
      }
      return borradas;
    },
  };
  return almacen;
}

const ahora = 1_800_000_000_000;
const IP = "203.0.113.7";

async function fallarVeces(
  almacen: AlmacenIntentosLogin,
  veces: number,
  usuario: string,
  ip: string,
  desde = ahora,
) {
  for (let i = 0; i < veces; i += 1) {
    // Every failure is one millisecond apart, all inside the window.
    await registrarFalloDeLogin(usuario, ip, desde - i, almacen);
  }
}

describe("login throttle — the pair is the unit of protection (S3)", () => {
  it("delays that (ip, username) pair once it reaches the threshold", async () => {
    const almacen = crearAlmacenFalso();
    await fallarVeces(almacen, UMBRAL_INTENTOS, "admin", IP);

    expect(await verificarThrottleLogin("admin", IP, ahora, almacen)).toEqual({
      permitido: false,
      esperarMs: ESPERA_BASE_MS,
    });
  });

  it("leaves the same user from another IP unaffected", async () => {
    const almacen = crearAlmacenFalso();
    await fallarVeces(almacen, UMBRAL_INTENTOS, "admin", IP);

    expect(await verificarThrottleLogin("admin", "198.51.100.9", ahora, almacen)).toEqual({
      permitido: true,
    });
  });

  it("leaves another user on the same IP unaffected — the whole point of not being per-IP", async () => {
    const almacen = crearAlmacenFalso();
    await fallarVeces(almacen, UMBRAL_INTENTOS, "admin", IP);

    expect(await verificarThrottleLogin("vendedor", IP, ahora, almacen)).toEqual({
      permitido: true,
    });
  });

  it("does not delay below the threshold", async () => {
    const almacen = crearAlmacenFalso();
    await fallarVeces(almacen, UMBRAL_INTENTOS - 1, "admin", IP);

    expect(await verificarThrottleLogin("admin", IP, ahora, almacen)).toEqual({ permitido: true });
  });

  it("cannot be reset by changing case or surrounding spaces", async () => {
    const almacen = crearAlmacenFalso();
    await fallarVeces(almacen, UMBRAL_INTENTOS, "Admin", IP);

    expect(await verificarThrottleLogin("  ADMIN  ", IP, ahora, almacen)).toEqual({
      permitido: false,
      esperarMs: ESPERA_BASE_MS,
    });
  });

  it("expires once the attempts leave the window — a delay, never a lockout", async () => {
    const almacen = crearAlmacenFalso();
    await fallarVeces(almacen, UMBRAL_INTENTOS, "admin", IP);

    const masTarde = ahora + VENTANA_INTENTOS_MS + 1;
    expect(await verificarThrottleLogin("admin", IP, masTarde, almacen)).toEqual({
      permitido: true,
    });
  });

  it("clears the pair on a successful sign-in", async () => {
    const almacen = crearAlmacenFalso();
    await fallarVeces(almacen, UMBRAL_INTENTOS, "admin", IP);
    expect((await verificarThrottleLogin("admin", IP, ahora, almacen)).permitido).toBe(false);

    await registrarExitoDeLogin("admin", IP, almacen);

    expect(await verificarThrottleLogin("admin", IP, ahora, almacen)).toEqual({ permitido: true });
  });

  it("sweeps attempts that left the window when it records a failure", async () => {
    const almacen = crearAlmacenFalso();
    await fallarVeces(almacen, 2, "admin", IP, ahora - VENTANA_INTENTOS_MS - 60_000);

    await registrarFalloDeLogin("admin", IP, ahora, almacen);

    // Only the fresh failure survives; the expired pair history is gone from storage,
    // not merely ignored by the policy.
    expect([...almacen.filas.values()].flat()).toEqual([ahora]);
  });
});

describe("login throttle — an unhealthy counter never becomes a login outage", () => {
  const roto: AlmacenIntentosLogin = {
    async registrar() {
      throw new Error("db caída");
    },
    async listar() {
      throw new Error("db caída");
    },
    async limpiar() {
      throw new Error("db caída");
    },
    async barrer() {
      throw new Error("db caída");
    },
  };

  it("permits the attempt when the counter cannot be read (fail-open, ADR-020)", async () => {
    expect(await verificarThrottleLogin("admin", IP, ahora, roto)).toEqual({ permitido: true });
  });

  it("does not surface a storage error from the recording paths", async () => {
    await expect(registrarFalloDeLogin("admin", IP, ahora, roto)).resolves.toBeUndefined();
    await expect(registrarExitoDeLogin("admin", IP, roto)).resolves.toBeUndefined();
  });
});
