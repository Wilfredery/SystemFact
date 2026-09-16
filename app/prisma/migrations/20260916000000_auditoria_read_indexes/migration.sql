-- fase-7a (auditoria): read indexes for the admin-only /auditoria consultation.
--
-- MOVIMIENTO_AUDITORIA is append-only and write-heavy (ADR-016). Without a
-- tenant-scoped index, every consultation degrades into an unbounded per-company
-- scan (AGENTS.md: multi-tenancy + "lists always paginated"). These four targeted
-- indexes cover exactly the access patterns this change ships, each leading with
-- empresaId so tenant isolation is index-served, and ending with (fechaHora, id)
-- to match the fixed ORDER BY fechaHora DESC, id DESC (AC-2):
--   1. (empresaId, fechaHora, id)      -> default newest-first page, no filters
--   2. (empresaId, sucursalId, fechaHora, id) -> optional branch filter (company-wide
--      consultation still uses #1; sucursalId IS NULL rows are reachable for the
--      nullable-branch RLS policy)
--   3. (empresaId, accion, fechaHora, id)     -> selective `accion` equality filter
--   4. (empresaId, usuarioId, fechaHora, id)  -> selective `usuarioId` equality filter
-- No index is created over valorAnterior/valorNuevo: free-text search never targets
-- the JSON payload (AC-3), and no speculative (entidad, idEntidad) index ships in V1
-- (design.md YAGNI). Additive only: rollback drops these four indexes and never the
-- table or its rows.

-- CreateIndex
CREATE INDEX "MOVIMIENTO_AUDITORIA_empresaId_fechaHora_id_idx" ON "MOVIMIENTO_AUDITORIA"("empresaId", "fechaHora", "id");

-- CreateIndex
CREATE INDEX "MOVIMIENTO_AUDITORIA_empresaId_sucursalId_fechaHora_id_idx" ON "MOVIMIENTO_AUDITORIA"("empresaId", "sucursalId", "fechaHora", "id");

-- CreateIndex
CREATE INDEX "MOVIMIENTO_AUDITORIA_empresaId_accion_fechaHora_id_idx" ON "MOVIMIENTO_AUDITORIA"("empresaId", "accion", "fechaHora", "id");

-- CreateIndex
CREATE INDEX "MOVIMIENTO_AUDITORIA_empresaId_usuarioId_fechaHora_id_idx" ON "MOVIMIENTO_AUDITORIA"("empresaId", "usuarioId", "fechaHora", "id");
