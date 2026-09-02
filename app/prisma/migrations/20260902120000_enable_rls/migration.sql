-- ============================================================
-- Migration: enable_rls
-- Date: 2026-09-02
-- ADR-019: Multi-tenancy defensa en profundidad (App-layer + RLS)
-- Doc: docs/12-decisiones_de_arquitectura.md (ADR-019)
--      docs/20-Respreguntas_jefe_seguridad_auth.md (P5 cerrada)
--
-- Esta migración habilita Row Level Security en las tablas operativas del
-- ERD v4.7 y crea las policies que leen el contexto de tenant seteado por
-- `setTenantContext()` desde la aplicación (capa B de ADR-019).
--
-- CONVENCIONES:
--   - IDs son Int (autoincrement) — NO UUID. Cast `::int` en policies.
--   - `current_setting('app.x', true)` devuelve NULL o '' cuando no se setea
--     (verificado empíricamente con `pnpm probe:set-local` R1.A). Las policies
--     usan `COALESCE(NULLIF(...), '0'::text)::int` o equivalente para tratarlos
--     igual. Sin esto, `''::int` lanza error en runtime.
--   - `app.is_login_flow='true'`: desactiva filtro en USUARIO/USUARIO_ROL para
--     el `findUnique` del path de auth (gallina-huevo resuelto). Solo lo usa
--     `auth-service.ts` dentro de `$transaction`.
--   - `app.is_bootstrap='true'`: desactiva filtro en EMPRESA/USUARIO/USUARIO_ROL
--     durante el seed inicial (crear primera Empresa + Admin).
--
-- REVERSA:
--   ALTER TABLE <tabla> DISABLE ROW LEVEL SECURITY;
--   DROP POLICY <nombre> ON <tabla>;
--   (Para desactivar todo: ver script de rollback en runbook — no incluido aquí.)
-- ============================================================

-- ============================================================
-- HELPER MACRO (no aplica en SQL puro de Postgres — referencia visual)
-- ============================================================
-- Las policies repiten este patrón. La macro mental:
--
--   match_empresa(row):
--     COALESCE(NULLIF(current_setting('app.current_empresa_id', true), ''), '0')::int
--     = row."empresaId"
--
--   match_sucursal(row):
--     COALESCE(NULLIF(current_setting('app.current_sucursal_id', true), ''), '') = ''
--     OR row."sucursalId" = COALESCE(NULLIF(current_setting('app.current_sucursal_id', true), ''), '0')::int
--
--   is_bootstrap(): COALESCE(NULLIF(current_setting('app.is_bootstrap', true), ''), '') = 'true'
--   is_login_flow(): COALESCE(NULLIF(current_setting('app.is_login_flow', true), ''), '') = 'true'

-- ============================================================
-- TIER 0: AUTH / DIMENSIÓN / RAÍZ
-- ============================================================

-- ─── EMPRESA ───────────────────────────────────────────────────────────
-- Raíz multi-tenant. Lectura solo de tu propia empresa. INSERT/UPDATE solo
-- en modo bootstrap.
ALTER TABLE "EMPRESA" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS empresa_select ON "EMPRESA";
CREATE POLICY empresa_select ON "EMPRESA"
  FOR SELECT
  USING (
    COALESCE(NULLIF(current_setting('app.current_empresa_id', true), ''), '0')::int = id
    OR COALESCE(NULLIF(current_setting('app.is_bootstrap', true), ''), '') = 'true'
  );

DROP POLICY IF EXISTS empresa_modify ON "EMPRESA";
CREATE POLICY empresa_modify ON "EMPRESA"
  FOR ALL
  USING (
    COALESCE(NULLIF(current_setting('app.is_bootstrap', true), ''), '') = 'true'
    OR COALESCE(NULLIF(current_setting('app.current_empresa_id', true), ''), '0')::int = id
  )
  WITH CHECK (
    COALESCE(NULLIF(current_setting('app.is_bootstrap', true), ''), '') = 'true'
    OR COALESCE(NULLIF(current_setting('app.current_empresa_id', true), ''), '0')::int = id
  );

-- ─── SUCURSAL ──────────────────────────────────────────────────────────
-- Dimensión de tenant. Solo sucursales de tu empresa.
ALTER TABLE "SUCURSAL" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sucursal_isolation ON "SUCURSAL";
CREATE POLICY sucursal_isolation ON "SUCURSAL"
  FOR ALL
  USING (
    COALESCE(NULLIF(current_setting('app.current_empresa_id', true), ''), '0')::int = "empresaId"
    OR COALESCE(NULLIF(current_setting('app.is_bootstrap', true), ''), '') = 'true'
  )
  WITH CHECK (
    COALESCE(NULLIF(current_setting('app.current_empresa_id', true), ''), '0')::int = "empresaId"
    OR COALESCE(NULLIF(current_setting('app.is_bootstrap', true), ''), '') = 'true'
  );

-- ─── USUARIO ───────────────────────────────────────────────────────────
-- Auth. Lectura normal por tenant. Excepción para login flow y bootstrap.
ALTER TABLE "USUARIO" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS usuario_select ON "USUARIO";
CREATE POLICY usuario_select ON "USUARIO"
  FOR SELECT
  USING (
    -- Normal: tu empresa y (sucursal o admin empresa-wide)
    (
      COALESCE(NULLIF(current_setting('app.current_empresa_id', true), ''), '0')::int = "empresaId"
      AND (
        COALESCE(NULLIF(current_setting('app.current_sucursal_id', true), ''), '') = ''
        OR "sucursalId" = COALESCE(NULLIF(current_setting('app.current_sucursal_id', true), ''), '0')::int
      )
    )
    -- Login flow: el findUnique post-signInWithPassword no tiene tenant todavía.
    OR COALESCE(NULLIF(current_setting('app.is_login_flow', true), ''), '') = 'true'
    -- Bootstrap: crear el primer Admin.
    OR COALESCE(NULLIF(current_setting('app.is_bootstrap', true), ''), '') = 'true'
  );

DROP POLICY IF EXISTS usuario_modify ON "USUARIO";
CREATE POLICY usuario_modify ON "USUARIO"
  FOR ALL
  USING (
    COALESCE(NULLIF(current_setting('app.current_empresa_id', true), ''), '0')::int = "empresaId"
    AND (
      COALESCE(NULLIF(current_setting('app.current_sucursal_id', true), ''), '') = ''
      OR "sucursalId" = COALESCE(NULLIF(current_setting('app.current_sucursal_id', true), ''), '0')::int
    )
    OR COALESCE(NULLIF(current_setting('app.is_bootstrap', true), ''), '') = 'true'
  )
  WITH CHECK (
    COALESCE(NULLIF(current_setting('app.current_empresa_id', true), ''), '0')::int = "empresaId"
    AND (
      COALESCE(NULLIF(current_setting('app.current_sucursal_id', true), ''), '') = ''
      OR "sucursalId" = COALESCE(NULLIF(current_setting('app.current_sucursal_id', true), ''), '0')::int
    )
    OR COALESCE(NULLIF(current_setting('app.is_bootstrap', true), ''), '') = 'true'
  );

-- ─── ROL ───────────────────────────────────────────────────────────────
-- Catálogo global. Lectura libre para todos. Escritura solo en bootstrap
-- (los 3 roles seedeados una vez).
ALTER TABLE "ROL" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rol_global_read ON "ROL";
CREATE POLICY rol_global_read ON "ROL"
  FOR SELECT
  USING (true);

DROP POLICY IF EXISTS rol_bootstrap_write ON "ROL";
CREATE POLICY rol_bootstrap_write ON "ROL"
  FOR ALL
  USING (
    COALESCE(NULLIF(current_setting('app.is_bootstrap', true), ''), '') = 'true'
  )
  WITH CHECK (
    COALESCE(NULLIF(current_setting('app.is_bootstrap', true), ''), '') = 'true'
  );

-- ─── USUARIO_ROL ───────────────────────────────────────────────────────
-- Junction sin tenant directo. Tenant via JOIN a USUARIO.
ALTER TABLE "USUARIO_ROL" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS usuariorol_isolation ON "USUARIO_ROL";
CREATE POLICY usuariorol_isolation ON "USUARIO_ROL"
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM "USUARIO" u
      WHERE u.id = "USUARIO_ROL"."usuarioId"
      AND COALESCE(NULLIF(current_setting('app.current_empresa_id', true), ''), '0')::int = u."empresaId"
      AND (
        COALESCE(NULLIF(current_setting('app.current_sucursal_id', true), ''), '') = ''
        OR u."sucursalId" = COALESCE(NULLIF(current_setting('app.current_sucursal_id', true), ''), '0')::int
      )
    )
    OR COALESCE(NULLIF(current_setting('app.is_bootstrap', true), ''), '') = 'true'
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "USUARIO" u
      WHERE u.id = "USUARIO_ROL"."usuarioId"
      AND COALESCE(NULLIF(current_setting('app.current_empresa_id', true), ''), '0')::int = u."empresaId"
    )
    OR COALESCE(NULLIF(current_setting('app.is_bootstrap', true), ''), '') = 'true'
  );

-- ============================================================
-- TIER 1: OPERATIVAS CON empresaId (sin sucursalId)
-- ============================================================

-- ─── CLIENTE ───────────────────────────────────────────────────────────
ALTER TABLE "CLIENTE" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cliente_isolation ON "CLIENTE";
CREATE POLICY cliente_isolation ON "CLIENTE"
  FOR ALL
  USING (
    COALESCE(NULLIF(current_setting('app.current_empresa_id', true), ''), '0')::int = "empresaId"
  )
  WITH CHECK (
    COALESCE(NULLIF(current_setting('app.current_empresa_id', true), ''), '0')::int = "empresaId"
  );

-- ─── PROVEEDOR ─────────────────────────────────────────────────────────
ALTER TABLE "PROVEEDOR" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS proveedor_isolation ON "PROVEEDOR";
CREATE POLICY proveedor_isolation ON "PROVEEDOR"
  FOR ALL
  USING (
    COALESCE(NULLIF(current_setting('app.current_empresa_id', true), ''), '0')::int = "empresaId"
  )
  WITH CHECK (
    COALESCE(NULLIF(current_setting('app.current_empresa_id', true), ''), '0')::int = "empresaId"
  );

-- ─── CATEGORIA ─────────────────────────────────────────────────────────
ALTER TABLE "CATEGORIA" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS categoria_isolation ON "CATEGORIA";
CREATE POLICY categoria_isolation ON "CATEGORIA"
  FOR ALL
  USING (
    COALESCE(NULLIF(current_setting('app.current_empresa_id', true), ''), '0')::int = "empresaId"
  )
  WITH CHECK (
    COALESCE(NULLIF(current_setting('app.current_empresa_id', true), ''), '0')::int = "empresaId"
  );

-- ─── PRODUCTO ──────────────────────────────────────────────────────────
ALTER TABLE "PRODUCTO" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS producto_isolation ON "PRODUCTO";
CREATE POLICY producto_isolation ON "PRODUCTO"
  FOR ALL
  USING (
    COALESCE(NULLIF(current_setting('app.current_empresa_id', true), ''), '0')::int = "empresaId"
  )
  WITH CHECK (
    COALESCE(NULLIF(current_setting('app.current_empresa_id', true), ''), '0')::int = "empresaId"
  );

-- ─── CONFIGURACION_EMPRESA ─────────────────────────────────────────────
ALTER TABLE "CONFIGURACION_EMPRESA" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS configempresa_isolation ON "CONFIGURACION_EMPRESA";
CREATE POLICY configempresa_isolation ON "CONFIGURACION_EMPRESA"
  FOR ALL
  USING (
    COALESCE(NULLIF(current_setting('app.current_empresa_id', true), ''), '0')::int = "empresaId"
  )
  WITH CHECK (
    COALESCE(NULLIF(current_setting('app.current_empresa_id', true), ''), '0')::int = "empresaId"
  );

-- ─── NCF_SECUENCIA ─────────────────────────────────────────────────────
ALTER TABLE "NCF_SECUENCIA" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ncfsecuencia_isolation ON "NCF_SECUENCIA";
CREATE POLICY ncfsecuencia_isolation ON "NCF_SECUENCIA"
  FOR ALL
  USING (
    COALESCE(NULLIF(current_setting('app.current_empresa_id', true), ''), '0')::int = "empresaId"
  )
  WITH CHECK (
    COALESCE(NULLIF(current_setting('app.current_empresa_id', true), ''), '0')::int = "empresaId"
  );

-- ─── ANULACION ─────────────────────────────────────────────────────────
ALTER TABLE "ANULACION" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS anulacion_isolation ON "ANULACION";
CREATE POLICY anulacion_isolation ON "ANULACION"
  FOR ALL
  USING (
    COALESCE(NULLIF(current_setting('app.current_empresa_id', true), ''), '0')::int = "empresaId"
  )
  WITH CHECK (
    COALESCE(NULLIF(current_setting('app.current_empresa_id', true), ''), '0')::int = "empresaId"
  );

-- ============================================================
-- TIER 2: OPERATIVAS CON empresaId + sucursalId
-- ============================================================

-- ─── VENTA ─────────────────────────────────────────────────────────────
ALTER TABLE "VENTA" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS venta_isolation ON "VENTA";
CREATE POLICY venta_isolation ON "VENTA"
  FOR ALL
  USING (
    COALESCE(NULLIF(current_setting('app.current_empresa_id', true), ''), '0')::int = "empresaId"
    AND (
      COALESCE(NULLIF(current_setting('app.current_sucursal_id', true), ''), '') = ''
      OR "sucursalId" = COALESCE(NULLIF(current_setting('app.current_sucursal_id', true), ''), '0')::int
    )
  )
  WITH CHECK (
    COALESCE(NULLIF(current_setting('app.current_empresa_id', true), ''), '0')::int = "empresaId"
    AND (
      COALESCE(NULLIF(current_setting('app.current_sucursal_id', true), ''), '') = ''
      OR "sucursalId" = COALESCE(NULLIF(current_setting('app.current_sucursal_id', true), ''), '0')::int
    )
  );

-- ─── FACTURA ───────────────────────────────────────────────────────────
ALTER TABLE "FACTURA" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS factura_isolation ON "FACTURA";
CREATE POLICY factura_isolation ON "FACTURA"
  FOR ALL
  USING (
    COALESCE(NULLIF(current_setting('app.current_empresa_id', true), ''), '0')::int = "empresaId"
    AND (
      COALESCE(NULLIF(current_setting('app.current_sucursal_id', true), ''), '') = ''
      OR "sucursalId" = COALESCE(NULLIF(current_setting('app.current_sucursal_id', true), ''), '0')::int
    )
  )
  WITH CHECK (
    COALESCE(NULLIF(current_setting('app.current_empresa_id', true), ''), '0')::int = "empresaId"
    AND (
      COALESCE(NULLIF(current_setting('app.current_sucursal_id', true), ''), '') = ''
      OR "sucursalId" = COALESCE(NULLIF(current_setting('app.current_sucursal_id', true), ''), '0')::int
    )
  );

-- ─── NOTA_CREDITO ──────────────────────────────────────────────────────
ALTER TABLE "NOTA_CREDITO" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notacredito_isolation ON "NOTA_CREDITO";
CREATE POLICY notacredito_isolation ON "NOTA_CREDITO"
  FOR ALL
  USING (
    COALESCE(NULLIF(current_setting('app.current_empresa_id', true), ''), '0')::int = "empresaId"
    AND (
      COALESCE(NULLIF(current_setting('app.current_sucursal_id', true), ''), '') = ''
      OR "sucursalId" = COALESCE(NULLIF(current_setting('app.current_sucursal_id', true), ''), '0')::int
    )
  )
  WITH CHECK (
    COALESCE(NULLIF(current_setting('app.current_empresa_id', true), ''), '0')::int = "empresaId"
    AND (
      COALESCE(NULLIF(current_setting('app.current_sucursal_id', true), ''), '') = ''
      OR "sucursalId" = COALESCE(NULLIF(current_setting('app.current_sucursal_id', true), ''), '0')::int
    )
  );

-- ─── NOTA_DEBITO ───────────────────────────────────────────────────────
ALTER TABLE "NOTA_DEBITO" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notadebito_isolation ON "NOTA_DEBITO";
CREATE POLICY notadebito_isolation ON "NOTA_DEBITO"
  FOR ALL
  USING (
    COALESCE(NULLIF(current_setting('app.current_empresa_id', true), ''), '0')::int = "empresaId"
    AND (
      COALESCE(NULLIF(current_setting('app.current_sucursal_id', true), ''), '') = ''
      OR "sucursalId" = COALESCE(NULLIF(current_setting('app.current_sucursal_id', true), ''), '0')::int
    )
  )
  WITH CHECK (
    COALESCE(NULLIF(current_setting('app.current_empresa_id', true), ''), '0')::int = "empresaId"
    AND (
      COALESCE(NULLIF(current_setting('app.current_sucursal_id', true), ''), '') = ''
      OR "sucursalId" = COALESCE(NULLIF(current_setting('app.current_sucursal_id', true), ''), '0')::int
    )
  );

-- ─── PAGO ──────────────────────────────────────────────────────────────
ALTER TABLE "PAGO" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pago_isolation ON "PAGO";
CREATE POLICY pago_isolation ON "PAGO"
  FOR ALL
  USING (
    COALESCE(NULLIF(current_setting('app.current_empresa_id', true), ''), '0')::int = "empresaId"
    AND (
      COALESCE(NULLIF(current_setting('app.current_sucursal_id', true), ''), '') = ''
      OR "sucursalId" = COALESCE(NULLIF(current_setting('app.current_sucursal_id', true), ''), '0')::int
    )
  )
  WITH CHECK (
    COALESCE(NULLIF(current_setting('app.current_empresa_id', true), ''), '0')::int = "empresaId"
    AND (
      COALESCE(NULLIF(current_setting('app.current_sucursal_id', true), ''), '') = ''
      OR "sucursalId" = COALESCE(NULLIF(current_setting('app.current_sucursal_id', true), ''), '0')::int
    )
  );

-- ─── PAGO_PROVEEDOR ────────────────────────────────────────────────────
ALTER TABLE "PAGO_PROVEEDOR" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pagoproveedor_isolation ON "PAGO_PROVEEDOR";
CREATE POLICY pagoproveedor_isolation ON "PAGO_PROVEEDOR"
  FOR ALL
  USING (
    COALESCE(NULLIF(current_setting('app.current_empresa_id', true), ''), '0')::int = "empresaId"
    AND (
      COALESCE(NULLIF(current_setting('app.current_sucursal_id', true), ''), '') = ''
      OR "sucursalId" = COALESCE(NULLIF(current_setting('app.current_sucursal_id', true), ''), '0')::int
    )
  )
  WITH CHECK (
    COALESCE(NULLIF(current_setting('app.current_empresa_id', true), ''), '0')::int = "empresaId"
    AND (
      COALESCE(NULLIF(current_setting('app.current_sucursal_id', true), ''), '') = ''
      OR "sucursalId" = COALESCE(NULLIF(current_setting('app.current_sucursal_id', true), ''), '0')::int
    )
  );

-- ─── COMPRA ────────────────────────────────────────────────────────────
ALTER TABLE "COMPRA" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS compra_isolation ON "COMPRA";
CREATE POLICY compra_isolation ON "COMPRA"
  FOR ALL
  USING (
    COALESCE(NULLIF(current_setting('app.current_empresa_id', true), ''), '0')::int = "empresaId"
    AND (
      COALESCE(NULLIF(current_setting('app.current_sucursal_id', true), ''), '') = ''
      OR "sucursalId" = COALESCE(NULLIF(current_setting('app.current_sucursal_id', true), ''), '0')::int
    )
  )
  WITH CHECK (
    COALESCE(NULLIF(current_setting('app.current_empresa_id', true), ''), '0')::int = "empresaId"
    AND (
      COALESCE(NULLIF(current_setting('app.current_sucursal_id', true), ''), '') = ''
      OR "sucursalId" = COALESCE(NULLIF(current_setting('app.current_sucursal_id', true), ''), '0')::int
    )
  );

-- ─── MOVIMIENTO_AUDITORIA ──────────────────────────────────────────────
-- Append-only por ADR-016. RLS: SELECT por tenant, INSERT por tenant,
-- sin policy de UPDATE/DELETE → denegados por defecto (alineado con append-only).
ALTER TABLE "MOVIMIENTO_AUDITORIA" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS audit_select ON "MOVIMIENTO_AUDITORIA";
CREATE POLICY audit_select ON "MOVIMIENTO_AUDITORIA"
  FOR SELECT
  USING (
    COALESCE(NULLIF(current_setting('app.current_empresa_id', true), ''), '0')::int = "empresaId"
    AND (
      COALESCE(NULLIF(current_setting('app.current_sucursal_id', true), ''), '') = ''
      OR "sucursalId" IS NULL
      OR "sucursalId" = COALESCE(NULLIF(current_setting('app.current_sucursal_id', true), ''), '0')::int
    )
  );

DROP POLICY IF EXISTS audit_insert ON "MOVIMIENTO_AUDITORIA";
CREATE POLICY audit_insert ON "MOVIMIENTO_AUDITORIA"
  FOR INSERT
  WITH CHECK (
    COALESCE(NULLIF(current_setting('app.current_empresa_id', true), ''), '0')::int = "empresaId"
  );

-- ============================================================
-- TIER 3: OPERATIVAS CON sucursalId (sin empresaId directo)
-- ============================================================

-- ─── INVENTARIO ────────────────────────────────────────────────────────
-- Tenant via JOIN a SUCURSAL.
ALTER TABLE "INVENTARIO" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS inventario_isolation ON "INVENTARIO";
CREATE POLICY inventario_isolation ON "INVENTARIO"
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM "SUCURSAL" s
      WHERE s.id = "INVENTARIO"."sucursalId"
      AND COALESCE(NULLIF(current_setting('app.current_empresa_id', true), ''), '0')::int = s."empresaId"
      AND (
        COALESCE(NULLIF(current_setting('app.current_sucursal_id', true), ''), '') = ''
        OR s.id = COALESCE(NULLIF(current_setting('app.current_sucursal_id', true), ''), '0')::int
      )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "SUCURSAL" s
      WHERE s.id = "INVENTARIO"."sucursalId"
      AND COALESCE(NULLIF(current_setting('app.current_empresa_id', true), ''), '0')::int = s."empresaId"
    )
  );

-- ============================================================
-- TIER 4: TABLAS HIJAS (tenant via FK al padre)
-- ============================================================

-- ─── DETALLE_VENTA ─────────────────────────────────────────────────────
ALTER TABLE "DETALLE_VENTA" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS detalleventa_isolation ON "DETALLE_VENTA";
CREATE POLICY detalleventa_isolation ON "DETALLE_VENTA"
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM "VENTA" v
      WHERE v.id = "DETALLE_VENTA"."ventaId"
      AND COALESCE(NULLIF(current_setting('app.current_empresa_id', true), ''), '0')::int = v."empresaId"
      AND (
        COALESCE(NULLIF(current_setting('app.current_sucursal_id', true), ''), '') = ''
        OR v."sucursalId" = COALESCE(NULLIF(current_setting('app.current_sucursal_id', true), ''), '0')::int
      )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "VENTA" v
      WHERE v.id = "DETALLE_VENTA"."ventaId"
      AND COALESCE(NULLIF(current_setting('app.current_empresa_id', true), ''), '0')::int = v."empresaId"
    )
  );

-- ─── DETALLE_NOTA_CREDITO ──────────────────────────────────────────────
ALTER TABLE "DETALLE_NOTA_CREDITO" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS detallemnc_isolation ON "DETALLE_NOTA_CREDITO";
CREATE POLICY detallemnc_isolation ON "DETALLE_NOTA_CREDITO"
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM "NOTA_CREDITO" nc
      WHERE nc.id = "DETALLE_NOTA_CREDITO"."notaCreditoId"
      AND COALESCE(NULLIF(current_setting('app.current_empresa_id', true), ''), '0')::int = nc."empresaId"
      AND (
        COALESCE(NULLIF(current_setting('app.current_sucursal_id', true), ''), '') = ''
        OR nc."sucursalId" = COALESCE(NULLIF(current_setting('app.current_sucursal_id', true), ''), '0')::int
      )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "NOTA_CREDITO" nc
      WHERE nc.id = "DETALLE_NOTA_CREDITO"."notaCreditoId"
      AND COALESCE(NULLIF(current_setting('app.current_empresa_id', true), ''), '0')::int = nc."empresaId"
    )
  );

-- ─── DETALLE_COMPRA ────────────────────────────────────────────────────
ALTER TABLE "DETALLE_COMPRA" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS detallecompra_isolation ON "DETALLE_COMPRA";
CREATE POLICY detallecompra_isolation ON "DETALLE_COMPRA"
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM "COMPRA" c
      WHERE c.id = "DETALLE_COMPRA"."compraId"
      AND COALESCE(NULLIF(current_setting('app.current_empresa_id', true), ''), '0')::int = c."empresaId"
      AND (
        COALESCE(NULLIF(current_setting('app.current_sucursal_id', true), ''), '') = ''
        OR c."sucursalId" = COALESCE(NULLIF(current_setting('app.current_sucursal_id', true), ''), '0')::int
      )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "COMPRA" c
      WHERE c.id = "DETALLE_COMPRA"."compraId"
      AND COALESCE(NULLIF(current_setting('app.current_empresa_id', true), ''), '0')::int = c."empresaId"
    )
  );

-- ─── MOVIMIENTO_INVENTARIO ─────────────────────────────────────────────
-- Tenant via FK → INVENTARIO → SUCURSAL → EMPRESA (doble JOIN).
ALTER TABLE "MOVIMIENTO_INVENTARIO" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS movinventario_isolation ON "MOVIMIENTO_INVENTARIO";
CREATE POLICY movinventario_isolation ON "MOVIMIENTO_INVENTARIO"
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM "INVENTARIO" i
      JOIN "SUCURSAL" s ON s.id = i."sucursalId"
      WHERE i.id = "MOVIMIENTO_INVENTARIO"."inventarioId"
      AND COALESCE(NULLIF(current_setting('app.current_empresa_id', true), ''), '0')::int = s."empresaId"
      AND (
        COALESCE(NULLIF(current_setting('app.current_sucursal_id', true), ''), '') = ''
        OR s.id = COALESCE(NULLIF(current_setting('app.current_sucursal_id', true), ''), '0')::int
      )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "INVENTARIO" i
      JOIN "SUCURSAL" s ON s.id = i."sucursalId"
      WHERE i.id = "MOVIMIENTO_INVENTARIO"."inventarioId"
      AND COALESCE(NULLIF(current_setting('app.current_empresa_id', true), ''), '0')::int = s."empresaId"
    )
  );
