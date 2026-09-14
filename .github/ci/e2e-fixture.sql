-- ============================================================
-- e2e-fixture.sql — fixture EXCLUSIVO de CI para el smoke de Playwright.
--
-- El smoke (app/e2e/confirm-venta.spec.ts) asume un entorno "dev-shaped":
-- Supabase Auth remoto + una base local con empresa, sucursal, rol, usuario y
-- un producto con stock. En la máquina de cada developer eso ya existe; en el
-- runner de GitHub la base arranca vacía, así que este archivo la prepara.
--
-- ¿Por qué SQL suelto y no un seed de app/tools/scripts? Porque es data
-- descartable que NUNCA debe poder apuntarse a una base real: vive junto al
-- workflow que la usa y solo se ejecuta contra el contenedor efímero de CI.
-- El guard de abajo aborta si la empresa fixture ya existe.
--
-- Nota de esquema: `updatedAt` (Prisma @updatedAt) NO tiene DEFAULT en el DDL,
-- por eso cada INSERT lo setea explícitamente con now().
--
-- Parámetros (psql -v):
--   e2e_user     → nombreUsuario del usuario E2E (coincide con el Auth de Supabase)
--   e2e_product  → nombre del producto que el smoke agrega al carrito
-- ============================================================

\set ON_ERROR_STOP on

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "EMPRESA" WHERE "rnc" = '131000001') THEN
    RAISE EXCEPTION 'e2e-fixture.sql ya fue aplicado en esta base. Usalo solo sobre la base descartable de CI.';
  END IF;
END $$;

BEGIN;

-- Empresa con emisión automática de NCF al confirmar (R-F1): sin esto el
-- confirm de la venta falla y el smoke no llega nunca al NCF.
INSERT INTO "EMPRESA" (
  "nombreComercial", "rnc", "razonSocial", "direccionFiscal",
  "telefono", "correo", "logo", "regimenFiscal", "facturaAutomatica", "updatedAt"
) VALUES (
  'E2E CI SRL', '131000001', 'E2E CI SRL', 'Av. CI 1',
  '8090000000', 'e2e-ci@systemfact.test', '', 'NORMAL', true, now()
);

INSERT INTO "SUCURSAL" ("empresaId", "nombre", "direccion", "telefono", "updatedAt")
SELECT id, 'Principal', 'Av. CI 1', '8090000000', now()
FROM "EMPRESA" WHERE "rnc" = '131000001';

-- El rol "Administrador" es el que buildTenantContext mapea a esAdmin.
INSERT INTO "ROL" ("nombre", "descripcion")
SELECT 'Administrador', 'Rol del fixture E2E de CI'
WHERE NOT EXISTS (SELECT 1 FROM "ROL" WHERE "nombre" = 'Administrador');

INSERT INTO "USUARIO" (
  "empresaId", "sucursalId", "nombre", "nombreUsuario", "passwordHash", "updatedAt"
)
SELECT e.id, s.id, :'e2e_user', :'e2e_user', 'ci-e2e-supabase-auth', now()
FROM "EMPRESA" e
JOIN "SUCURSAL" s ON s."empresaId" = e.id
WHERE e."rnc" = '131000001';

INSERT INTO "USUARIO_ROL" ("usuarioId", "rolId")
SELECT u.id, r.id
FROM "USUARIO" u, "ROL" r
WHERE u."nombreUsuario" = :'e2e_user' AND r."nombre" = 'Administrador';

INSERT INTO "CATEGORIA" ("empresaId", "nombre", "updatedAt")
SELECT id, 'CI', now() FROM "EMPRESA" WHERE "rnc" = '131000001';

-- ITBIS 18% vigente: la venta congela la tasa por línea.
INSERT INTO "PRODUCTO" (
  "empresaId", "categoriaId", "nombre", "codigo", "codigoBarras",
  "unidadMedida", "unidadEmpaque", "stockMinimo",
  "precioCompra", "precioVenta", "costoPromedio", "tasaItbis",
  "itbisVigenteDesde", "updatedAt"
)
SELECT e.id, c.id, :'e2e_product', :'e2e_product', :'e2e_product',
       'u', 'c', 0,
       100.00, 150.00, 100.00, 18.00, now(), now()
FROM "EMPRESA" e
JOIN "CATEGORIA" c ON c."empresaId" = e.id
WHERE e."rnc" = '131000001';

-- Stock en la sucursal del usuario: sin inventario la venta no se puede confirmar.
INSERT INTO "INVENTARIO" ("sucursalId", "productoId", "cantidad", "updatedAt")
SELECT s.id, p.id, 100.000, now()
FROM "SUCURSAL" s
JOIN "PRODUCTO" p ON p."empresaId" = s."empresaId"
WHERE s."nombre" = 'Principal' AND p."nombre" = :'e2e_product';

COMMIT;
