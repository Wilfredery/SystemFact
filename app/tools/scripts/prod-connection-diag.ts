/**
 * Connection probe for the Supabase prod candidates.
 *
 * Reads DIRECT_URL from the process environment (set per candidate by the
 * prod-connection-diag.ps1 wrapper), opens ONE client as the role in the URL,
 * runs `SELECT 1` and prints a single line: OK or the failure CLASS.
 *
 * Failure classes (identifier first, then detail):
 *   AUTH            28P01/28000 — wrong password or wrong username shape
 *   NET             ENOTFOUND/ECONNREFUSED/ENETUNREACH/ETIMEDOUT — host/port blocked
 *   DBS             3D000 — database not visible to this role
 *   OTHER           anything else (we print the raw postgres code + trimmed message)
 *
 * NO connection string is ever printed, and error messages are scrubbed of
 * anything that looks like an embedded password/DSN fragment.
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

function fail(message: string): never {
  process.stdout.write(`DIAG: ${message}\n`);
  process.exit(1);
}

const url = process.env["DIRECT_URL"];
if (!url) fail("DIRECT_URL not set (must be provided by prod-connection-diag.ps1)");

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

function scrub(text: string): string {
  return text
    .replace(/password[^ \n]*/gi, "password=<scrubbed>")
    .replace(/postgresql:\/\/[^\s]+/g, "postgresql://<scrubbed>");
}

async function main(): Promise<void> {
  try {
    await prisma.$queryRaw`SELECT 1 AS probe`;
    process.stdout.write("CONNECT: OK\n");
  } catch (e) {
    const pg = e as { code?: string; message?: string; meta?: unknown };
    const code = pg.code ?? "";
    const isNet = ["ENOTFOUND", "ECONNREFUSED", "ENETUNREACH", "ETIMEDOUT", "ECONNRESET"].includes(code);
    const isAuth = code === "28P01" || code === "28000";
    const klass = isNet ? "NET" : isAuth ? "AUTH" : code === "3D000" ? "DBS" : "OTHER";
    const meta = pg.meta && typeof pg.meta === "object" ? JSON.stringify(pg.meta).slice(0, 300) : "";
    process.stdout.write(
      `CONNECT: ERROR(${klass}) code=${code || "(no-code)"} message=${scrub(String(pg.message ?? e)).slice(0, 300)}${meta ? ` meta=${scrub(meta)}` : ""}\n`,
    );
    process.exit(2);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((unhandled) => {
  process.stdout.write(`DIAG: unhandled ${scrub(String(unhandled))}\n`);
  process.exit(1);
});

