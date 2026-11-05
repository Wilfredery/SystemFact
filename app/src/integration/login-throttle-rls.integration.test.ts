/**
 * Integration — the login throttle counter through the APP ROLE (real Postgres, RLS on).
 *
 * WHY THIS TEST EXISTS. The first version of the `LOGIN_INTENTO` migration created a
 * RESTRICTIVE `USING (false)` policy. Restrictive policies are ANDed with every permissive
 * one, so they deny `systemfact_app` as well — and because the throttle fails open, that
 * turned a broken policy into a *silently disabled control*: reads returned zero rows and
 * inserts raised an RLS violation that the fail-open path swallowed and logged. The unit
 * suite could not see it (it uses a fake store) and `pnpm rls:verify` could not see it either
 * (it only demanded RLS plus at least one policy). This test exercises the three operations
 * the throttle actually performs, through the same role production uses, so the class of
 * defect cannot ship again.
 */
import { almacenIntentosPrisma } from "@/modules/auth/infrastructure/login-attempt-repository";

const IP = "198.51.100.77";
const USUARIO = "rls-probe-throttle";
const VENTANA_MS = 2 * 60 * 60_000;

describe("LOGIN_INTENTO — the runtime role can actually use the counter", () => {
  afterEach(async () => {
    await almacenIntentosPrisma.limpiar(IP, USUARIO);
  });

  it("records an attempt, reads it back, and clears the pair on success", async () => {
    const id = await almacenIntentosPrisma.registrar(IP, USUARIO, new Date());

    // A number, not null: with a restrictive-only policy the insert is rejected and the
    // fail-open wrapper returns null, which is exactly the silent failure this pins.
    expect(typeof id).toBe("number");
    expect(id).toBeGreaterThan(0);

    const intentos = await almacenIntentosPrisma.listar(IP, USUARIO, new Date(Date.now() - VENTANA_MS));
    expect(intentos).toHaveLength(1);

    await almacenIntentosPrisma.limpiar(IP, USUARIO);
    await expect(
      almacenIntentosPrisma.listar(IP, USUARIO, new Date(Date.now() - VENTANA_MS)),
    ).resolves.toEqual([]);
  });

  it("undoes exactly one attempt without touching the rest of the pair", async () => {
    const primero = await almacenIntentosPrisma.registrar(IP, USUARIO, new Date());
    const segundo = await almacenIntentosPrisma.registrar(IP, USUARIO, new Date());

    await almacenIntentosPrisma.descartar(segundo);

    const quedan = await almacenIntentosPrisma.listar(IP, USUARIO, new Date(Date.now() - VENTANA_MS));
    expect(quedan).toHaveLength(1);
    expect(primero).toBeGreaterThan(0);
  });

  it("sweeps rows that left the window and keeps the fresh ones", async () => {
    const viejo = new Date(Date.now() - 60 * 60_000);
    await almacenIntentosPrisma.registrar(IP, USUARIO, viejo);
    await almacenIntentosPrisma.registrar(IP, USUARIO, new Date());

    const borradas = await almacenIntentosPrisma.barrer(new Date(Date.now() - 15 * 60_000));

    expect(borradas).toBeGreaterThanOrEqual(1);
    const quedan = await almacenIntentosPrisma.listar(IP, USUARIO, new Date(Date.now() - VENTANA_MS));
    expect(quedan).toHaveLength(1);
  });
});
