-- R-C3 — Refund idempotency key on PAGO.
--
-- A client-generated key gates REEMBOLSO de-duplication. The column is NULLABLE
-- so every COBRO row and every legacy row keeps NULL; Postgres permits multiple
-- NULLs in a UNIQUE index, therefore only non-NULL keys participate in
-- uniqueness (design.md: "nullable unique semantics permit multiple legacy NULLs").
--
-- The application checks the key INSIDE the transaction BEFORE insert and BEFORE
-- the receipt number is burned (task 2.5); this constraint is the durable
-- race guard for the first-submit case (task 2.6).

-- AlterTable
ALTER TABLE "PAGO" ADD COLUMN     "idempotencyKey" VARCHAR(255);

-- CreateIndex
CREATE UNIQUE INDEX "PAGO_empresaId_idempotencyKey_key" ON "PAGO"("empresaId", "idempotencyKey");
