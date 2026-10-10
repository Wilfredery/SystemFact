/**
 * Sets the production password for the runtime role `systemfact_app`.
 *
 * SystemFact security policy (AGENTS.md / ADR-019): role passwords are ALWAYS
 * out-of-band — never committed, never echoed, never logged. This script is
 * invoked by `supabase-prod-migrate.ps1 -SetRolPassword`, which reads the
 * password with hidden input and exports:
 *
 *   DIRECT_URL            operator `postgres` connection (same var the
 *                         Prisma config and the other tool scripts read)
 *   APP_ROLE_PASSWORD     the new password for `systemfact_app`
 *
 * It connects to the database with the OPERATOR connection (the three columns
 * of the app duty are irrelevant here), runs `ALTER ROLE systemfact_app WITH
 * PASSWORD '<pw>'` and exits. The password is filtered through a conservative
 * character policy so it can NEVER introduce SQL injection through the
 * unalterable-by-parameter `ALTER ROLE` grammar (no quotes, semicolons,
 * backslashes or spaces allowed). Nothing about the password is printed.
 *
 * Not intended to be run standalone.
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

const operatorUrl = process.env["DIRECT_URL"];
const pw = process.env["APP_ROLE_PASSWORD"];

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

if (!operatorUrl || !/^postgresql?:\/\//.test(operatorUrl)) {
  fail("DIRECT_URL is not set or is not a postgres URL — run via supabase-prod-migrate.ps1.");
}
if (!pw) {
  fail("APP_ROLE_PASSWORD is not set — run via supabase-prod-migrate.ps1 -SetRolPassword.");
}
if (!/^[A-Za-z0-9!_.~^-]{12,120}$/.test(pw)) {
  fail(
    "APP_ROLE_PASSWORD failed the character policy: only letters, digits and . ! _ ~ ^ - , 12-120 chars, no quotes/semicolons/spaces. Aborting WITHOUT connecting.",
  );
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: operatorUrl }) });

// Top-level await is NOT supported under tsx's CJS output format, so the async
// work runs as a promise chain on a named entry function (no top-level await).
async function main(): Promise<void> {
  try {
    // The password has already been whitelisted to a no-injection charset
    // (see above): quotes, backslashes and semicolons are impossible, so the
    // string-literal interpolation cannot carry a second statement or a
    // quote-escape. ALTER ROLE has no parameterized form.
    await prisma.$executeRawUnsafe(`ALTER ROLE systemfact_app WITH PASSWORD '${pw}'`);
    process.stdout.write("ALTER ROLE systemfact_app: password set.\n");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((unhandled) => {
  process.stderr.write(`FAIL: ${unhandled instanceof Error ? unhandled.message : String(unhandled)}\n`);
  process.exit(1);
});

