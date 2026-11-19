-- Optional free-text payment reference on PAGO (board 03 S14).
--
-- The Cobros confirmation modal lets the collector attach a reference to a
-- collection (a transfer number, a cheque, a short note). The column is
-- NULLABLE by design: an absent or blank reference is stored as NULL, never "",
-- and every legacy payment row keeps NULL, so nothing reads as "referencia
-- vacía" versus "sin referencia".
--
-- Bounded to the transport grammar too: `zRegistrarCobroInput.referencia` trims
-- and caps at 80 characters, so the column width is enforced on both ends.
--
-- Same shape as 20260915000000_pago_idempotency_key (a single nullable column on
-- PAGO; no index — the reference is never a query key, only history display).

-- AlterTable
ALTER TABLE "PAGO" ADD COLUMN     "referencia" VARCHAR(80);

-- REVERSA: ALTER TABLE "PAGO" DROP COLUMN "referencia";
