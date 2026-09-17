-- fase-7b (reportes, slice B): aggregation read indexes for the operational reports.
--
-- The operational reports (ventas por período, productos vendidos, inventario
-- valorizado, estado de facturas) all filter by tenant (`empresaId`) plus a time
-- window and aggregate/GROUP BY over that range (OP-1, OP-3, OP-4). Without a
-- tenant-scoped index each consultation degrades into an unbounded per-company
-- scan (AGENTS.md: multi-tenancy + "measure before optimizing"; proposal risk
-- "Slow aggregations (no indexes) → Index migration ships with slice B").
--
-- These three indexes lead with `empresaId` so tenant isolation is index-served,
-- then the report's range column, matching the canonical predicates in
-- `reportes/infrastructure/operacional-repository.ts`:
--   1. VENTA(empresaId, fecha)             -> confirmed-sales period grouping (OP-1, OP-2)
--   2. FACTURA(empresaId, fechaEmision)    -> estado-de-facturas issuance-window (OP-4)
--   3. COMPRA(empresaId, fecha)            -> purchase-window reads (later slices reuse)
--
-- Additive ONLY: no table/data change, no drop/recreate, `$transaction`-friendly
-- plain SQL. Rollback drops exactly these three indexes and never the tables or
-- their rows (proposal Rollback Plan: "Index migration is additive-only").

-- CreateIndex
CREATE INDEX "VENTA_empresaId_fecha_idx" ON "VENTA"("empresaId", "fecha");

-- CreateIndex
CREATE INDEX "FACTURA_empresaId_fechaEmision_idx" ON "FACTURA"("empresaId", "fechaEmision");

-- CreateIndex
CREATE INDEX "COMPRA_empresaId_fecha_idx" ON "COMPRA"("empresaId", "fecha");
