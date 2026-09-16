/**
 * Test-only stand-in for `@/generated/prisma/client` under the db-free unit
 * Jest config. The real generated client is ESM-flavored source
 * (`import.meta.url`) that the unit transform cannot execute; production code
 * (and the integration Jest config, which babel-transforms the real source)
 * uses the real client. This stub only re-exports the tiny surface a unit
 * import requires — the `Prisma` error classes so tests can construct a real
 * `PrismaClientKnownRequestError` — and nothing else.
 */
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
};

/** Mirrors the generated enum (same literals; prisma-accion.ts maps through it). */
export const AccionAuditoria = {
  CREAR: "CREAR",
  ACTUALIZAR: "ACTUALIZAR",
  CANCELAR: "CANCELAR",
  ANULAR: "ANULAR",
  PAGAR: "PAGAR",
  AJUSTAR: "AJUSTAR",
  LOGIN: "LOGIN",
  LOGOUT: "LOGOUT",
  LEER: "LEER",
} as const;
