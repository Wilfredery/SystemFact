-- ITBIS rate list, slice 2 (odd/tasks/itbis-tasas-config.md S2, S5, S11): provision the
-- TASA_ITBIS key for every existing empresa, so the application can read the allowed
-- rates from the database (slice 3) instead of a hardcoded set.
--
-- Data migration only, no schema change, own migration commit (repo Git-workflow rule).
-- Idempotent by construction: the frozen compound unique index
-- ("empresaId", "clave", "vigenciaInicio") is the ON CONFLICT target, so a rerun (or a
-- run where `pnpm seed:venta` already provisioned the canonical row) is a no-op.
--
-- Value: exactly the rates allowed today, a comma list in percent with the default rate
-- first (owner decision: "Keep exactly 18, 16 and 0"). It is the same SET as the shared
-- domain constant TASAS_ITBIS_PERMITIDAS (a unit test pins that), and it equals
-- TASA_ITBIS_SEED_VALOR in tools/scripts/seed-venta-config.ts. Window: the same canonical
-- span every other seeded key uses (2000-01-01 to 2099-12-31). Nothing reads this row
-- until slice 3, so applying it changes no behavior.
--
-- Runs as the owner's migrate role, which must bypass row-level security (production `postgres` has
-- rolbypassrls = true; the local Supabase CLI `postgres` does NOT, so locally run it as
-- supabase_admin). Under forced RLS without a tenant context the SELECT would see zero empresas and
-- insert nothing SILENTLY, so verify after applying: the TASA_ITBIS row count must equal the empresa
-- count.
--
-- Scoped to the new key only: it never updates or demotes an existing TASA_ITBIS row.
-- A new empresa created later gets the key from `pnpm seed:venta`.

INSERT INTO "CONFIGURACION_EMPRESA"
    ("empresaId", "clave", "valor", "vigenciaInicio", "vigenciaFin", "activa")
SELECT "id", 'TASA_ITBIS', '18,16,0',
       '2000-01-01 00:00:00+00', '2099-12-31 23:59:59+00', true
FROM "EMPRESA"
ON CONFLICT ("empresaId", "clave", "vigenciaInicio") DO NOTHING;
