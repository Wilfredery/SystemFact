-- AlterTable
ALTER TABLE "CATEGORIA" ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "CLIENTE" ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "CONFIGURACION_EMPRESA" ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "PRODUCTO" ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "PROVEEDOR" ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "USUARIO" ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- RenameIndex
ALTER INDEX "categoria_empresaId_nombre_active_uk" RENAME TO "CATEGORIA_empresaId_nombre_key";

-- RenameIndex
ALTER INDEX "cliente_empresaId_identificacionFiscal_active_uk" RENAME TO "CLIENTE_empresaId_identificacionFiscal_key";

-- RenameIndex
ALTER INDEX "producto_empresaId_codigo_active_uk" RENAME TO "PRODUCTO_empresaId_codigo_key";

-- RenameIndex
ALTER INDEX "proveedor_empresaId_rnc_active_uk" RENAME TO "PROVEEDOR_empresaId_rnc_key";
