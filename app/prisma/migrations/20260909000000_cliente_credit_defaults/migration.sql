-- ADR / fase-5a-clientes R3: apply documented credit defaults at the DDL level.
-- `limiteCredito` DEFAULT 0.00 (Decimal 12,2) and `plazoCreditoDias` DEFAULT 30
-- mirror the use-case-level defaults so a row created without credit fields
-- lands at limit 0.00 / term 30 regardless of the writer path.
-- Own migration commit (D3 + repo Git-workflow rule): DDL defaults only, no
-- other schema change, no feature code in this transaction.

ALTER TABLE "CLIENTE"
  ALTER COLUMN "limiteCredito" SET DEFAULT 0.00,
  ALTER COLUMN "plazoCreditoDias" SET DEFAULT 30;
