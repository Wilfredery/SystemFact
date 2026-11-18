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

import {
  esConflictoIdempotencia,
  registrarReembolso,
  registrarReembolsoAutomatico,
} from "./registrar-reembolso";
import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";

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

describe("reserved DEVOLUCION: idempotency prefix", () => {
  const ctx: TenantCtx = { empresaId: 1, sucursalId: 2, usuarioId: 3, esAdmin: true };

  /** A tx that fails LOUD on any property access: the reservation must reject
   *  BEFORE any database work, not after a lookup. */
  const txProhibido = new Proxy({}, {
    get() { throw new Error("no debe tocar la base de datos"); },
  }) as unknown as PrismaTx;

  it.each([
    "DEVOLUCION:B04000000001",
    "DEVOLUCION:",
    " devolucion:B04000000001 ",
  ])("rejects the reserved prefix before any lookup (key %j)", async (key) => {
    // A STABLE business code (JD-A-005): typed result, no DB touch.
    const r = await registrarReembolso(txProhibido, ctx, {
      facturaId: 80,
      monto: "10.00",
      idempotencyKey: key,
    });
    expect(r).toEqual({
      ok: false,
      code: "PAGO_IDEMPOTENCIA_RESERVADA",
      message: expect.any(String),
    });
  });

  it("the AUTOMATIC entry point accepts the DEVOLUCION: key and proceeds to the DB", async () => {
    // The devolucion auto-refund MINTS DEVOLUCION:<ncf> keys — it must reach
    // the lookup (our prohibitive tx proxy surfaces it), never the reservation.
    await expect(
      registrarReembolsoAutomatico(txProhibido, ctx, {
        facturaId: 80,
        monto: "10.00",
        idempotencyKey: "DEVOLUCION:B04000000001",
      }),
    ).rejects.toThrow("no debe tocar la base de datos");
  });

  it("accepts a normal manual key (does not hit the reservation)", async () => {
    // A non-reserved key passes the reservation gate and proceeds to the DB
    // lookup, which our prohibitive proxy surfaces as its own error — proving
    // the reservation did not reject it.
    await expect(
      registrarReembolso(txProhibido, ctx, {
        facturaId: 80,
        monto: "10.00",
        idempotencyKey: "manual-normal-key-1",
      }),
    ).rejects.toThrow("no debe tocar la base de datos");
  });
});
