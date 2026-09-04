-- Migration: add ITBIS validity and retention columns to PRODUCTO
-- Work unit: WU3 (foundational-patterns-fase-1-2)

ALTER TABLE "PRODUCTO"
  ADD COLUMN "descripcion" VARCHAR(255) NULL DEFAULT '',
  ADD COLUMN "itbisVigenteDesde" TIMESTAMPTZ NOT NULL DEFAULT '2012-01-01 00:00:00+00',
  ADD COLUMN "itbisVigenteHasta" TIMESTAMPTZ NULL,
  ADD COLUMN "itbisAplicaRetencionITBIS" BOOLEAN NOT NULL DEFAULT false;

-- Backfill: existing rows already receive defaults above. This UPDATE makes
-- the backfill explicit and idempotent in case the defaults are ever removed.
UPDATE "PRODUCTO"
SET
  "descripcion" = COALESCE("descripcion", ''),
  "itbisVigenteDesde" = COALESCE("itbisVigenteDesde", '2012-01-01 00:00:00+00'::timestamptz),
  "itbisAplicaRetencionITBIS" = COALESCE("itbisAplicaRetencionITBIS", false);

-- Down migration
-- Drops the added columns only when reversing this migration. Data in these
-- columns is lost; this is acceptable for pre-production rollback only.
-- ALTER TABLE "PRODUCTO"
--   DROP COLUMN IF EXISTS "descripcion",
--   DROP COLUMN IF EXISTS "itbisVigenteDesde",
--   DROP COLUMN IF EXISTS "itbisVigenteHasta",
--   DROP COLUMN IF EXISTS "itbisAplicaRetencionITBIS";
