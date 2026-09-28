/**
 * Test-only stand-in for `@/generated/prisma/client` under the db-free unit
 * Jest config. The real generated client is ESM-flavored source
 * (`import.meta.url`) that the unit transform cannot execute; production code
 * (and the integration Jest config, which babel-transforms the real source)
 * uses the real client. This stub only re-exports the tiny surface a unit
 * import requires — the `Prisma` error classes so tests can construct a real
 * `PrismaClientKnownRequestError`, `Prisma.Decimal` (the mandatory money type,
 * delegated to decimal.js exactly like the generated runtime does), and the
 * enums, re-exported from the generated `enums.ts` so the literals never drift
 * from the Prisma schema — and nothing else.
 */
import { Decimal } from "decimal.js";
import { AccionAuditoria } from "@/generated/prisma/enums";

export const Prisma = {
  /** Mirrors `Prisma.PrismaClientKnownRequestError` enough for `instanceof`. */
  PrismaClientKnownRequestError: class PrismaClientKnownRequestError extends Error {
    readonly code: string;
    readonly clientVersion: string;
    readonly meta: Record<string, unknown> | undefined;

    constructor(
      message: string,
      info: { code: string; clientVersion: string; meta?: Record<string, unknown> },
    ) {
      super(message);
      this.name = "PrismaClientKnownRequestError";
      this.code = info.code;
      this.clientVersion = info.clientVersion;
      this.meta = info.meta;
    }
  },
  /** Same class the generated runtime exposes as `Prisma.Decimal`. */
  Decimal,
};

// Re-exported from the generated enums rather than hand-duplicated, so schema
// additions surface here instead of silently drifting (see prisma/AccionAuditoria).
export { AccionAuditoria };