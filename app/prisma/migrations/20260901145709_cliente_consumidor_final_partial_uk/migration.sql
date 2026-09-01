-- Partial unique index: un solo Consumidor Final por empresa
-- Fuentes:
--   - docs/erd-guia.md §6.3 (línea 110): "UK parcial no expresable en Prisma DSL: SQL crudo requerido"
--   - docs/erd-guia.md (línea 62): "Existe un solo 'Consumidor Final' por empresa"
--   - docs/21-evaluacion_por_fases_prisma.md §6 H2: bug estructural detectado en la auditoría 2026-09-01
--
-- Contexto:
--   El TODO en schema.prisma (líneas 320-321) documentaba este índice pero nunca se
--   materializó en la migración inicial 20260828184924_init_erd_v47. Sin este índice,
--   la BD NO garantiza la invariante "un solo Consumidor Final por empresa": dos
--   inserciones simultáneas con esConsumidorFinal=true para la misma empresaId
--   serían aceptadas, y la regla de negocio quedaría delegada solo al código de
--   aplicación (con riesgo de race condition).
--
-- Esta migración crea el índice parcial para que la invariante quede enforced
-- por la BD. El código de Fase 1.2 (CRUD Cliente) podrá confiar en este
-- constraint y solo necesitará atrapar el UniqueViolation de Prisma.

CREATE UNIQUE INDEX "cliente_consumidor_final_uk"
ON "CLIENTE" ("empresaId")
WHERE "esConsumidorFinal" = true;
