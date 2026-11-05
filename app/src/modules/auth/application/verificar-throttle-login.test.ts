import {
  descartarIntentoDeLogin,
  registrarExitoDeLogin,
  registrarIntentoDeLogin,
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
  const filas = new Map<number, { clave: string; momento: number }>();
  let siguienteId = 1;
  const clave = (ip: string, usuario: string) => `${ip}|${usuario}`;
  const almacen: AlmacenIntentosLogin & { filas: Map<number, { clave: string; momento: number }> } = {
    filas,
    async registrar(ip, usuario, momento) {
      const id = siguienteId;
      siguienteId += 1;
      filas.set(id, { clave: clave(ip, usuario), momento: momento.getTime() });
      return id;
    },
    async descartar(id) {
      filas.delete(id);
    },
    async listar(ip, usuario, desde) {
      const k = clave(ip, usuario);
      return [...filas.values()]
        .filter((fila) => fila.clave === k && fila.momento >= desde.getTime())
        .map((fila) => fila.momento);
    },
    async limpiar(ip, usuario) {
      const k = clave(ip, usuario);
      for (const [id, fila] of filas) if (fila.clave === k) filas.delete(id);
    },
    async barrer(corte) {
      let borradas = 0;
      for (const [id, fila] of filas) {
        if (fila.momento < corte.getTime()) {
          filas.delete(id);
          borradas += 1;
        }
      }
      return borradas;
    },
  };
  return almacen;
}

const ahora = 1_800_000_000_000;
const IP = "203.0.113.7";

async function intentarVeces(
  almacen: AlmacenIntentosLogin,
  veces: number,
  usuario: string,
  ip: string,
  desde = ahora,
) {
  for (let i = 0; i < veces; i += 1) {
    // Every attempt is one millisecond apart, all inside the window. Each recorded attempt
    // is what the NEXT check counts — that ordering is the throttle (R3-throttle-race).
    await registrarIntentoDeLogin(usuario, ip, desde - i, almacen);
  }
}

describe("login throttle — the pair is the unit of protection (S3)", () => {
  it("delays that (ip, username) pair once it reaches the threshold", async () => {
    const almacen = crearAlmacenFalso();
    await intentarVeces(almacen, UMBRAL_INTENTOS, "admin", IP);

    expect(await verificarThrottleLogin("admin", IP, ahora, almacen)).toEqual({
      permitido: false,
      esperarMs: ESPERA_BASE_MS,
    });
  });

  it("leaves the same user from another IP unaffected", async () => {
    const almacen = crearAlmacenFalso();
    await intentarVeces(almacen, UMBRAL_INTENTOS, "admin", IP);

    expect(await verificarThrottleLogin("admin", "198.51.100.9", ahora, almacen)).toEqual({
      permitido: true,
    });
  });

  it("leaves another user on the same IP unaffected — the whole point of not being per-IP", async () => {
    const almacen = crearAlmacenFalso();
    await intentarVeces(almacen, UMBRAL_INTENTOS, "admin", IP);

    expect(await verificarThrottleLogin("vendedor", IP, ahora, almacen)).toEqual({
      permitido: true,
    });
  });

  it("does not delay below the threshold", async () => {
    const almacen = crearAlmacenFalso();
    await intentarVeces(almacen, UMBRAL_INTENTOS - 1, "admin", IP);

    expect(await verificarThrottleLogin("admin", IP, ahora, almacen)).toEqual({ permitido: true });
  });

  it("cannot be reset by changing case or surrounding spaces", async () => {
    const almacen = crearAlmacenFalso();
    await intentarVeces(almacen, UMBRAL_INTENTOS, "Admin", IP);

    expect(await verificarThrottleLogin("  ADMIN  ", IP, ahora, almacen)).toEqual({
      permitido: false,
      esperarMs: ESPERA_BASE_MS,
    });
  });

  it("lets the pair through again once the delay elapsed, without waiting for the window", async () => {
    const almacen = crearAlmacenFalso();
    await intentarVeces(almacen, UMBRAL_INTENTOS, "admin", IP);

    // 1 s past the base delay: a delay, not a lockout, and not a 15-minute wait.
    const trasLaEspera = ahora + ESPERA_BASE_MS + 1_000;
    expect(await verificarThrottleLogin("admin", IP, trasLaEspera, almacen)).toEqual({
      permitido: true,
    });
  });

  it("expires once the attempts leave the window", async () => {
    const almacen = crearAlmacenFalso();
    await intentarVeces(almacen, UMBRAL_INTENTOS, "admin", IP);

    const masTarde = ahora + VENTANA_INTENTOS_MS + 1;
    expect(await verificarThrottleLogin("admin", IP, masTarde, almacen)).toEqual({
      permitido: true,
    });
  });

  it("clears the whole pair on a successful sign-in", async () => {
    const almacen = crearAlmacenFalso();
    await intentarVeces(almacen, UMBRAL_INTENTOS, "admin", IP);
    expect((await verificarThrottleLogin("admin", IP, ahora, almacen)).permitido).toBe(false);

    await registrarExitoDeLogin("admin", IP, almacen);

    expect(await verificarThrottleLogin("admin", IP, ahora, almacen)).toEqual({ permitido: true });
  });

  it("sweeps attempts that left the window when it records one", async () => {
    const almacen = crearAlmacenFalso();
    await intentarVeces(almacen, 2, "admin", IP, ahora - VENTANA_INTENTOS_MS - 60_000);

    await registrarIntentoDeLogin("admin", IP, ahora, almacen);

    expect([...almacen.filas.values()].map((fila) => fila.momento)).toEqual([ahora]);
  });
});

describe("login throttle — undoing an attempt that was not a guess", () => {
  it("returns the row id so the caller can undo exactly that attempt", async () => {
    const almacen = crearAlmacenFalso();

    const id = await registrarIntentoDeLogin("admin", IP, ahora, almacen);
    await registrarIntentoDeLogin("admin", IP, ahora, almacen);

    expect(id).not.toBeNull();
    expect(almacen.filas.size).toBe(2);

    await descartarIntentoDeLogin(id, almacen);

    // Only the discarded one is gone: an inactive-account refusal must not erase the
    // guesses that came before it.
    expect(almacen.filas.size).toBe(1);
    expect([...almacen.filas.keys()]).not.toContain(id);
  });

  it("does nothing when there was no id to undo", async () => {
    const almacen = crearAlmacenFalso();
    await expect(descartarIntentoDeLogin(null, almacen)).resolves.toBeUndefined();
  });
});

describe("login throttle — an unhealthy counter never becomes a login outage", () => {
  const roto: AlmacenIntentosLogin = {
    async registrar() {
      throw new Error("db caída");
    },
    async descartar() {
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

  it("returns no id instead of throwing when the attempt cannot be recorded", async () => {
    expect(await registrarIntentoDeLogin("admin", IP, ahora, roto)).toBeNull();
  });

  it("does not surface a storage error from the undo path", async () => {
    await expect(descartarIntentoDeLogin(7, roto)).resolves.toBeUndefined();
    await expect(registrarExitoDeLogin("admin", IP, roto)).resolves.toBeUndefined();
  });

  it("never fails open silently: each swallowed error is reported", async () => {
    // A security control that is silently OFF is worse than one that is visibly off.
    // Failing open is the right trade (see ADR-020); doing it without a trace is not,
    // because then a dropped table or a permissions mistake removes the throttle and
    // nobody — including the operator reading the logs — can tell.
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    try {
      await verificarThrottleLogin("admin", IP, ahora, roto);
      await registrarIntentoDeLogin("admin", IP, ahora, roto);
      await descartarIntentoDeLogin(7, roto);
      await registrarExitoDeLogin("admin", IP, roto);

      expect(errorSpy).toHaveBeenCalledTimes(4);
      expect(errorSpy.mock.calls.map(([linea]) => String(linea))).toEqual([
        expect.stringContaining("verificar"),
        expect.stringContaining("registrar"),
        expect.stringContaining("descartar"),
        expect.stringContaining("limpiar"),
      ]);
    } finally {
      errorSpy.mockRestore();
    }
  });
});
