import {
  descartarIntentoDeLogin,
  intentarAccesoDeLogin,
  registrarExitoDeLogin,
  type AlmacenIntentosLogin,
} from "./verificar-throttle-login";

/**
 * docs/22 T3 at the application seam.
 *
 * What lives here now: turning the username into the counter key, passing the store's verdict
 * through unchanged, and the fail-open / undo paths. What does NOT live here any more is the
 * count-vs-insert decision: it has to run inside the storage transaction to be atomic
 * (finding `R4-002`), so it is implemented by the repository and proven by its own suite plus
 * the integration tests. Pair separation is proven there and in the pure domain policy — a
 * fake store would only prove that the fake agrees with itself.
 */
function crearAlmacen(overrides: Partial<AlmacenIntentosLogin> = {}) {
  const almacen: AlmacenIntentosLogin & {
    intentar: jest.Mock;
    descartar: jest.Mock;
    limpiar: jest.Mock;
  } = {
    intentar: jest.fn().mockResolvedValue({ permitido: true, id: 11 }),
    descartar: jest.fn().mockResolvedValue(undefined),
    limpiar: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  } as never;
  return almacen;
}

const AHORA = 1_800_000_000_000;
const IP = "203.0.113.7";

describe("intentarAccesoDeLogin — wiring", () => {
  it("normalizes the username into the counter key and passes the moment through", async () => {
    const almacen = crearAlmacen();

    const veredicto = await intentarAccesoDeLogin("  ADMIN  ", IP, AHORA, almacen);

    expect(almacen.intentar).toHaveBeenCalledWith(IP, "admin", AHORA);
    expect(veredicto).toEqual({ permitido: true, intentoId: 11 });
  });

  it("passes a refusal through with its remaining wait", async () => {
    const almacen = crearAlmacen({
      intentar: jest.fn().mockResolvedValue({ permitido: false, esperarMs: 30_000 }),
    });

    await expect(intentarAccesoDeLogin("admin", IP, AHORA, almacen)).resolves.toEqual({
      permitido: false,
      esperarMs: 30_000,
    });
  });

  it("permits the attempt with nothing to undo when the counter is unavailable", async () => {
    // Fail-open (ADR-020): a broken counter must not become a login outage.
    const almacen = crearAlmacen({ intentar: jest.fn().mockRejectedValue(new Error("db caída")) });

    await expect(intentarAccesoDeLogin("admin", IP, AHORA, almacen)).resolves.toEqual({
      permitido: true,
      intentoId: null,
    });
  });

  it("does not fail open silently", async () => {
    // A control that is silently OFF is worse than one that is visibly off.
    const almacen = crearAlmacen({ intentar: jest.fn().mockRejectedValue(new Error("db caída")) });
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    try {
      await intentarAccesoDeLogin("admin", IP, AHORA, almacen);
      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(String(errorSpy.mock.calls[0][0])).toContain("intentar");
    } finally {
      errorSpy.mockRestore();
    }
  });
});

describe("undo and clear", () => {
  it("undoes the attempt by id, with nothing to do when there is no id", async () => {
    const almacen = crearAlmacen();

    await descartarIntentoDeLogin(11, almacen);
    expect(almacen.descartar).toHaveBeenCalledWith(11);

    await descartarIntentoDeLogin(null, almacen);
    expect(almacen.descartar).toHaveBeenCalledTimes(1);
  });

  it("clears the pair with the NORMALIZED key and the exact ip", async () => {
    const almacen = crearAlmacen();

    await registrarExitoDeLogin("  Admin ", IP, almacen);

    expect(almacen.limpiar).toHaveBeenCalledWith(IP, "admin");
  });

  it("never throws from the undo or clear paths", async () => {
    const roto = crearAlmacen({
      descartar: jest.fn().mockRejectedValue(new Error("db caída")),
      limpiar: jest.fn().mockRejectedValue(new Error("db caída")),
    });
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    try {
      await expect(descartarIntentoDeLogin(11, roto)).resolves.toBeUndefined();
      await expect(registrarExitoDeLogin("admin", IP, roto)).resolves.toBeUndefined();
      expect(errorSpy).toHaveBeenCalledTimes(2);
    } finally {
      errorSpy.mockRestore();
    }
  });
});
