/**
 * Integration — the login throttle counter through the APP ROLE (real Postgres, RLS on).
 *
 * Two things only a real database can prove:
 *
 * 1. REACHABILITY. The first version of the `LOGIN_INTENTO` migration created a RESTRICTIVE
 *    `USING (false)` policy. Restrictive policies are ANDed with every permissive one, so it
 *    denied `systemfact_app` too — and because the throttle fails open, a broken policy became
 *    a SILENTLY DISABLED control: reads returned nothing, inserts raised an RLS violation that
 *    was swallowed. The unit suite could not see it (fake store) and `rls:verify` could not
 *    see it either (it demanded RLS plus a policy, without checking the role).
 *
 * 2. ATOMICITY. The count and the insert are one locked decision (finding `R4-002`). As two
 *    statements, a concurrent burst all read the same count and all proceeded.
 */
import { almacenIntentosPrisma } from "@/modules/auth/infrastructure/login-attempt-repository";
import { ESPERA_BASE_MS, UMBRAL_INTENTOS } from "@/modules/auth/domain/login-throttle";

const IP = "198.51.100.77";
const USUARIO_A = "rls-probe-a";
const USUARIO_B = "rls-probe-b";

afterEach(async () => {
  await almacenIntentosPrisma.limpiar(IP, USUARIO_A);
  await almacenIntentosPrisma.limpiar(IP, USUARIO_B);
});

describe("LOGIN_INTENTO — the runtime role can actually use the counter", () => {
  it("records an attempt and reports it as allowed with a real id", async () => {
    const resultado = await almacenIntentosPrisma.intentar(IP, USUARIO_A, Date.now());

    // A number, not null: with a restrictive-only policy the insert is rejected and the
    // fail-open wrapper reports nothing to undo.
    expect(resultado.permitido).toBe(true);
    if (resultado.permitido) {
      expect(typeof resultado.id).toBe("number");
      expect(resultado.id).toBeGreaterThan(0);
    }
  });

  it("refuses at the threshold with the base delay, and clearing frees the pair", async () => {
    const ahora = Date.now();
    for (let i = 0; i < UMBRAL_INTENTOS; i += 1) {
      const r = await almacenIntentosPrisma.intentar(IP, USUARIO_A, ahora - i);
      expect(r.permitido).toBe(true);
    }

    const bloqueado = await almacenIntentosPrisma.intentar(IP, USUARIO_A, ahora);
    expect(bloqueado).toEqual({ permitido: false, esperarMs: ESPERA_BASE_MS });

    await almacenIntentosPrisma.limpiar(IP, USUARIO_A);
    await expect(almacenIntentosPrisma.intentar(IP, USUARIO_A, ahora)).resolves.toMatchObject({
      permitido: true,
    });
  });

  it("keeps one pair apart from another on real SQL", async () => {
    const ahora = Date.now();
    for (let i = 0; i < UMBRAL_INTENTOS; i += 1) {
      await almacenIntentosPrisma.intentar(IP, USUARIO_A, ahora);
    }

    // Same IP, different user — the whole reason the key is not per-IP.
    await expect(almacenIntentosPrisma.intentar(IP, USUARIO_B, ahora)).resolves.toMatchObject({
      permitido: true,
    });
  });

  it("serializes a CONCURRENT burst instead of letting it through (R4-002)", async () => {
    const ahora = Date.now();
    const intentos = 8;

    const resultados = await Promise.all(
      Array.from({ length: intentos }, () => almacenIntentosPrisma.intentar(IP, USUARIO_A, ahora)),
    );

    const permitidos = resultados.filter((r) => r.permitido).length;

    // Exactly the threshold, never more: the per-pair advisory lock makes "count then insert"
    // a single decision, so no two concurrent attempts can both read the same count.
    expect(permitidos).toBe(UMBRAL_INTENTOS);
    expect(resultados.length - permitidos).toBe(intentos - UMBRAL_INTENTOS);
  });
});
