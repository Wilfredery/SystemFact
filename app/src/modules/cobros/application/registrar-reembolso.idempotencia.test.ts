/**
 * Unit — `esConflictoIdempotencia` matcher (no DB; the unit Jest config maps
 * `@/generated/prisma/client` to `src/test-support/prisma-client-stub.ts`, so
 * the error class here is the real `instanceof` path against the stub).
 * Locks BOTH error shapes it must recognize as the `(empresaId,
 * idempotencyKey)` unique clash:
 *
 *   1. the classic `meta.target` shape (array of columns or a single embedded
 *      constraint/index name), and
 *   2. the Prisma 7 + `@prisma/adapter-pg` driver-adapter shape, where the
 *      constraint lives at `meta.driverAdapterError.cause.constraint.index`
 *      and `meta.target` is ABSENT (the real-DB race regression that had the
 *      `cobros-reembolso` concurrency test failing on fase-6).
 */

import { Prisma } from "@/generated/prisma/client";

import { esConflictoIdempotencia } from "./registrar-reembolso";

function knownRequestError(
  code: string,
  meta?: Record<string, unknown>,
): InstanceType<typeof Prisma.PrismaClientKnownRequestError> {
  return new Prisma.PrismaClientKnownRequestError("unique constraint", {
    code,
    clientVersion: "7.10.0",
    meta,
  });
}

function knownError(meta: Record<string, unknown>) {
  return knownRequestError("P2002", meta);
}

describe("esConflictoIdempotencia", () => {
  it("classic shape: meta.target array of columns naming the idempotency column", () => {
    expect(
      esConflictoIdempotencia(knownError({ target: ["empresaId", "idempotencyKey"] })),
    ).toBe(true);
  });

  it("classic shape: meta.target single embedded constraint name", () => {
    expect(
      esConflictoIdempotencia(
        knownError({ target: ["PAGO_empresaId_idempotencyKey_key"] }),
      ),
    ).toBe(true);
  });

  it("driver-adapter shape: meta.target absent, constraint under driverAdapterError.cause", () => {
    expect(
      esConflictoIdempotencia(
        knownError({
          driverAdapterError: {
            name: "DriverAdapterError",
            cause: {
              originalCode: "23505",
              kind: "UniqueConstraintViolation",
              constraint: { index: "PAGO_empresaId_idempotencyKey_key" },
              table: "PAGO",
            },
          },
        }),
      ),
    ).toBe(true);
  });

  it("other unique constraints are NOT the idempotency clash", () => {
    expect(
      esConflictoIdempotencia(
        knownError({
          driverAdapterError: {
            cause: { constraint: { index: "PAGO_empresaId_correlativoRecibo_key" } },
          },
        }),
      ),
    ).toBe(false);
  });

  it("non-P2002 and non-Prisma errors are rejected", () => {
    expect(
      esConflictoIdempotencia(knownRequestError("P2025")),
    ).toBe(false);
    expect(esConflictoIdempotencia(new Error("plain"))).toBe(false);
  });
});
