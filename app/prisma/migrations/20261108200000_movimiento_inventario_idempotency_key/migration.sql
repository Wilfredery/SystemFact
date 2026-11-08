-- Idempotency key on MOVIMIENTO_INVENTARIO (manual stock adjustment).
--
-- The Inventario adjust form sends a client-generated key with every adjustment.
-- The application looks the key up INSIDE the transaction, after it has locked
-- the INVENTARIO row, and BEFORE it changes the stock: a repeat of the same
-- request returns the first result instead of applying the delta again
-- (AGENTS.md: "Every action that CONFIRMS or mutates money/inventory/NCF is
-- idempotent: retrying does not duplicate effects"). This constraint is the
-- durable race guard behind that check.
--
-- The column is NULLABLE: every existing movement, and every movement written by
-- a sale, a purchase, a cancellation or a return, keeps NULL. Postgres permits
-- several NULLs in a UNIQUE index, so only non-NULL keys take part in uniqueness.
-- The key is unique PER INVENTORY ROW (not global): this table has no empresaId,
-- so a global key would let one company probe another company's keys.
--
-- Same shape as 20260915000000_pago_idempotency_key (refund idempotency).

-- AlterTable
ALTER TABLE "MOVIMIENTO_INVENTARIO" ADD COLUMN     "idempotencyKey" VARCHAR(255);

-- CreateIndex
CREATE UNIQUE INDEX "MOVIMIENTO_INVENTARIO_inventarioId_idempotencyKey_key" ON "MOVIMIENTO_INVENTARIO"("inventarioId", "idempotencyKey");

-- REVERSA: DROP INDEX "MOVIMIENTO_INVENTARIO_inventarioId_idempotencyKey_key";
--          ALTER TABLE "MOVIMIENTO_INVENTARIO" DROP COLUMN "idempotencyKey";
