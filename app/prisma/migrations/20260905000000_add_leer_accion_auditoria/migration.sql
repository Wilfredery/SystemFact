-- Add LEER action value to AccionAuditoria enum for audit rows of significant reads (REQ-PROD-010: producto.listed).
ALTER TYPE "AccionAuditoria" ADD VALUE IF NOT EXISTS 'LEER';