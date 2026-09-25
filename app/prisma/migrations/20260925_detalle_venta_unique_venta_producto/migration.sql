-- v2r-04 (2026-09-25): a product may appear at most ONCE per sale.
--
-- A sale's detail rows are single cells per product: quantity, unit price,
-- line discount and ITBIS are frozen PER PRODUCT. Until now nothing at the
-- storage layer stopped a duplicated productoId within one VENTA; the
-- guarantee relied only on the application pipeline. This unique constraint
-- closes the loop at the schema level so any future write path that forgets
-- the invariant (HTTP zod refine + prepararLineasVenta already enforce it)
-- fails loudly instead of silently writing ambiguous rows.
--
-- Safe to apply: verified on 2026-09-25 that neither local database holds a
-- duplicate (ventaId, productoId) pair — dev `postgres` has 1 DETALLE_VENTA
-- row, test `systemfact_test` has 0 — so this is a pure additive constraint.

ALTER TABLE "DETALLE_VENTA"
  ADD CONSTRAINT "DETALLE_VENTA_ventaId_productoId_key"
  UNIQUE ("ventaId", "productoId");