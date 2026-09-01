-- Migración W1/H1: UKs parciales sobre `activo = true` para liberar códigos al desactivar
-- (Directiva §12 + decisión de negocio 2026-09-01).
--
-- Fuentes:
--   - docs/19-directivas_desarrollo.md §12: "La unicidad de código/nombre aplica SOLO sobre registros
--     activos, vía índice único parcial (SQL crudo en migración, como la UK de Consumidor Final —
--     erd-guia §6.3): desactivar LIBERA el código para reuso."
--   - docs/21-evaluacion_por_fases_prisma.md §6 H1 + W1
--   - docs/erd-guia.md §6.3 línea 110: "UK parcial no expresable en Prisma DSL: SQL crudo"
--
-- Patrón: mismo enfoque aplicado en H2 (Consumidor Final, migración
-- 20260901145709_cliente_consumidor_final_partial_uk). Prisma DSL no soporta
-- índices únicos parciales, por lo que se implementa con SQL crudo.
--
-- Alcance: 4 entidades (Cliente, Proveedor, Categoria, Producto).
-- Note: CATEGORIA usa `activa` (femenino), los otros 3 usan `activo` (masculino).
--       Ver SUGGESTION S4 del doc 21 §6 (inconsistencia cosmética, fuera de alcance).
--
-- Comportamiento:
--   ANTES: dos clientes con mismo RNC para la misma empresa -> UK completa lo rechaza,
--          incluso si uno está activo=false.
--   DESPUÉS: dos clientes con mismo RNC para la misma empresa -> aceptado si uno está
--            activo=false (código "liberado" para reuso). El código de Fase 1.2 debe
--            filtrar `activo=true` en queries operativas (Directiva §12: "Toda query
--            operativa filtra `activo=true` por defecto").

-- Drop existing complete UKs (creadas en la migración inicial 20260828184924_init_erd_v47)
DROP INDEX IF EXISTS "CLIENTE_empresaId_identificacionFiscal_key";
DROP INDEX IF EXISTS "PROVEEDOR_empresaId_rnc_key";
DROP INDEX IF EXISTS "CATEGORIA_empresaId_nombre_key";
DROP INDEX IF EXISTS "PRODUCTO_empresaId_codigo_key";

-- Create partial UKs: solo registros activos (activo=true) participan del constraint
CREATE UNIQUE INDEX "cliente_empresaId_identificacionFiscal_active_uk"
ON "CLIENTE" ("empresaId", "identificacionFiscal")
WHERE "activo" = true;

CREATE UNIQUE INDEX "proveedor_empresaId_rnc_active_uk"
ON "PROVEEDOR" ("empresaId", "rnc")
WHERE "activo" = true;

CREATE UNIQUE INDEX "categoria_empresaId_nombre_active_uk"
ON "CATEGORIA" ("empresaId", "nombre")
WHERE "activa" = true;

CREATE UNIQUE INDEX "producto_empresaId_codigo_active_uk"
ON "PRODUCTO" ("empresaId", "codigo")
WHERE "activo" = true;
