-- F5 / audit v2r-11 (2026-09-29): provision RETROACTIVO_FECHA_VENTA_DIAS for every
-- empresa at the schema/deploy step so the sale-date band never depends on a manual
-- `pnpm seed:venta` run after deploy.
--
-- Data migration only, no schema change, own migration commit (repo Git-workflow
-- rule). Idempotent by construction: the frozen compound unique index
-- ("empresaId", "clave", "vigenciaInicio") is the ON CONFLICT target, so a rerun
-- (or a run on an environment where `pnpm seed:venta` already provisioned the
-- canonical row) is a no-op.
--
-- The canonical window and the business-confirmed default `7` are the same
-- constants `seed-venta-config.ts` uses (CLAVE_SEED_VIGENCIA /
-- RETROACTIVO_FECHA_VENTA_SEED_VALOR): one source of truth. The runtime reads the
-- stored value, so adjusting the horizon later needs no deploy. Scoped to the new
-- key only: DESC_MAX / PLAZO_DEVOLUCION keep the seed script's R-V17 demote +
-- fail-fast repair, which a plain INSERT cannot replicate safely.

INSERT INTO "CONFIGURACION_EMPRESA"
    ("empresaId", "clave", "valor", "vigenciaInicio", "vigenciaFin", "activa")
SELECT "id", 'RETROACTIVO_FECHA_VENTA_DIAS', '7',
       '2000-01-01 00:00:00+00', '2099-12-31 23:59:59+00', true
FROM "EMPRESA"
ON CONFLICT ("empresaId", "clave", "vigenciaInicio") DO NOTHING;