/**
 * Integration — the SHAPE of the `LOGIN_INTENTO` policy, not just its existence.
 *
 * `rls:verify` proves the table has RLS on and a permissive policy that applies to the
 * runtime role. It cannot prove WHICH role or WHICH predicate, and both are load-bearing:
 * the first version of this migration shipped a restrictive deny-all that made the throttle
 * inert, and a policy written `TO authenticated` (the shape a Supabase habit produces) would
 * do the same thing again while every guard read green. These assertions close that gap by
 * reading the catalog directly.
 */
import { prisma } from "@/lib/prisma";
import { closeHarnessDb } from "./setup/fixtures";

type PoliticaRow = { polname: string; polpermissive: boolean; roles: string[] | null; qual: string };

const TABLA = `public."LOGIN_INTENTO"`;

afterAll(async () => {
  await closeHarnessDb();
});

describe("LOGIN_INTENTO — policy shape", () => {
  it("has exactly one policy, permissive, and it applies to systemfact_app", async () => {
    const politicas = await prisma.$queryRawUnsafe<PoliticaRow[]>(
      `SELECT p.polname,
              p.polpermissive,
              ARRAY(SELECT r.rolname::text FROM pg_roles r WHERE r.oid = ANY (p.polroles)) AS roles,
              COALESCE(pg_get_expr(p.polqual, p.polrelid), '') AS qual
         FROM pg_policy p
        WHERE p.polrelid = '${TABLA}'::regclass`,
    );

    expect(politicas).toHaveLength(1);
    expect(politicas[0]?.polpermissive).toBe(true);
    // The assertion `rls:verify` cannot make: the policy must name the runtime role, or be
    // PUBLIC (empty polroles).
    const roles = politicas[0]?.roles ?? [];
    expect(roles.length === 0 || roles.includes("systemfact_app")).toBe(true);
    expect(politicas[0]?.qual).toBe("true");
  });

  it("gives the app role the four verbs the throttle needs", async () => {
    for (const privilegio of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
      const [fila] = await prisma.$queryRawUnsafe<{ ok: boolean }[]>(
        `SELECT has_table_privilege('systemfact_app', '${TABLA}', '${privilegio}') AS ok`,
      );
      expect(fila?.ok).toBe(true);
    }
  });

  it("grants no policy to anon or authenticated", async () => {
    // On the hosted project those roles exist and are the ones PostgREST uses; a policy that
    // named them would open the counter to the data API.
    const [fila] = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT count(*) AS n
         FROM pg_policy p
        WHERE p.polrelid = '${TABLA}'::regclass
          AND EXISTS (
            SELECT 1 FROM pg_roles r
             WHERE r.oid = ANY (p.polroles)
               AND r.rolname IN ('anon', 'authenticated')
          )`,
    );
    expect(Number(fila?.n ?? 0)).toBe(0);
  });
});
