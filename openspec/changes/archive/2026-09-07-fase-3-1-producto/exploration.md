# Exploration: fase-3-1-producto — Edit & Deactivate Products

## Current State

The product module (`src/modules/producto/`) implements **create** and **list** use cases following ADR-013 layering (domain/application/infrastructure/http). The spec (`openspec/specs/producto/spec.md`) explicitly marks "Full CRUD (update/delete) for Producto" as **out of scope** for the foundational change.

### What Exists

| Layer | File | Coverage |
|-------|------|----------|
| **domain** | `producto.ts` — `Producto` interface, `ProductoItbis`, `buildProductoItbis`, `TasaItbis`, `esProductoExento`, `TASAS_ITBIS_VALIDAS`, `esTasaItbisValida` | Entity shape + ITBIS value object |
| **domain** | `errors.ts` — `ProductoDomainError`, 11 error codes, `messageFor` | Error catalog |
| **domain** | `calcular-itbis.ts` — `calcularItbisProducto` (pure) | ITBIS math |
| **application** | `crear-producto.ts` — `crearProducto(tx, ctx, input)` | Create use case with domain validation, duplicate check, category cross-tenant guard, TOCTOU race mapping |
| **application** | `listar-productos.ts` — `listarProductos(tx, ctx, query)` | List with pagination, filter, audit |
| **infrastructure** | `producto-repository.ts` — `CrearProductoInput`, `ListarProductosQuery`, `toDomainProducto`, `buildWhere`, `existeCodigoEnEmpresa`, `categoriaPerteneceAEmpresa`, `crearProductoEnTx`, `contarProductos`, `listarProductosEnTx`, audit helpers | Prisma data access, role check |
| **http** | `actions.ts` — `crearProductoAction`, `listarProductosAction`, `ActionResult<T>` | Server Actions, zod validation, auth |
| **http** | `validations.ts` — `zCrearProductoInput`, `zListarProductosQuery` | Zod schemas |

### What's Missing (fase-3-1 scope)

1. **Editar producto** — `actualizarProducto` use case + Server Action
2. **Desactivar producto** — soft-delete (set `activo = false`) use case + Server Action
3. **Tests** for both new use cases (domain + application + http layers)

### Prisma Schema — Key Fields for Edit/Deactivate

```prisma
model Producto {
  id            Int      @id @default(autoincrement())
  empresaId     Int
  categoriaId   Int
  codigo        String   @db.VarChar(255)
  nombre        String   @db.VarChar(255)
  descripcion   String?  @db.VarChar(255)
  precioVenta   Decimal  @db.Decimal(12, 2)
  tasaItbis     Decimal  @db.Decimal(12, 2)
  itbisVigenteDesde        DateTime @db.Timestamptz(6)
  itbisVigenteHasta        DateTime? @db.Timestamptz(6)
  itbisAplicaRetencionITBIS Boolean @default(false)
  activo        Boolean  @default(true)
  version       Int      @default(1)  // optimistic locking
  // ... other fields: codigoBarras, unidadMedida, unidadEmpaque, stockMinimo,
  //     precioCompra, costoPromedio, createdAt, updatedAt
  @@unique([empresaId, codigo])
}
```

**Critical observations:**
- `version` column exists for optimistic locking (Directiva §10) — edit MUST use it
- `activo` is the soft-delete marker — deactivate sets it to `false`
- `@@unique([empresaId, codigo])` with partial unique (WHERE activo = true) — deactivating releases the `codigo` for reuse
- The entity `Producto` interface in domain already exposes `activo: boolean`

---

## Affected Areas

- `app/src/modules/producto/domain/producto.ts` — may need `ProductoEditInput` type
- `app/src/modules/producto/domain/errors.ts` — new error codes: `PRODUCTO_NO_ENCONTRADO`, `CONCURRENCIA_CONFLICTO`, `PRODUCTO_YA_INACTIVO`, `PRODUCTO_TIENE_MOVIMIENTOS`
- `app/src/modules/producto/application/actualizar-producto.ts` — **NEW** edit use case
- `app/src/modules/producto/application/desactivar-producto.ts` — **NEW** deactivate use case
- `app/src/modules/producto/infrastructure/producto-repository.ts` — new repo functions: `obtenerProductoPorId`, `actualizarProductoEnTx`, `desactivarProductoEnTx`, `registrarProductoActualizadoEnTx`, `registrarProductoDesactivadoEnTx`
- `app/src/modules/producto/http/actions.ts` — new Server Actions: `actualizarProductoAction`, `desactivarProductoAction`
- `app/src/modules/producto/http/validations.ts` — new zod schemas: `zActualizarProductoInput`, `zDesactivarProductoInput`
- Test files for each new file above

---

## Approaches

### Approach 1: Separate use cases (editar + desactivar as independent functions)

**Description:** Create `actualizarProducto` and `desactivarProducto` as two separate use case files, each with its own input type, validation logic, and repository calls. Follows the existing `crear-producto.ts` / `listar-productos.ts` pattern exactly.

- **Pros:**
  - Matches existing pattern perfectly (one file per use case)
  - Each use case is independently testable
  - Clear single responsibility
  - Easy to reason about and review
- **Cons:**
  - Slightly more files (but the module already has this pattern)
  - Shared validation logic (tasa, precio, vigencia) is duplicated between create and edit
- **Effort:** Low

### Approach 2: Shared validation helpers + thin use cases

**Description:** Extract shared domain validation (tasa check, precio check, vigencia check) into a `domain/validar-producto.ts` helper module. Both create and edit use cases call these helpers. Deactivate is a separate thin use case.

- **Pros:**
  - DRY — validation logic shared between create and edit
  - Domain purity maintained (helpers are pure functions)
- **Cons:**
  - Adds a new file to an already well-structured module
  - Requires refactoring existing `crear-producto.ts` to use shared helpers (scope creep for this change)
  - The current duplication is minimal (3 checks) and the checks are slightly different (create validates all fields, edit validates only changed fields)
- **Effort:** Medium

### Approach 3: Edit as "replace product" (full entity replacement)

**Description:** Edit replaces the entire product entity rather than patching fields. The input is the full `Producto` shape minus read-only fields (`id`, `empresaId`, `activo`, `version`).

- **Pros:**
  - Simpler mental model — no partial update complexity
  - No need to track which fields changed
- **Cons:**
  - Client must send all fields every time (UX burden)
  - More data transfer
  - Doesn't match typical ERP edit patterns (partial updates)
  - Optimistic locking still needed but the "conflict" surface is larger
- **Effort:** Low

---

## Recommendation

**Approach 1: Separate use cases** — it matches the existing pattern, keeps each use case independently testable, and the duplication is minimal (3 validation checks that differ slightly between create and edit). The existing code is clean and well-structured; adding a shared validation module would be YAGNI at this stage.

### Key Design Decisions

1. **Edit input:** Partial update — only changed fields are sent. Use `Partial<Omit<Producto, 'id' | 'empresaId' | 'activo' | 'version'>>` in domain, with zod schema enforcing at least one field is present.

2. **Optimistic locking:** The edit use case reads `version` from the current row, includes it in the `UPDATE ... WHERE version = ?` clause, and returns `CONCURRENCIA_CONFLICTO` if 0 rows affected. The client must refetch and retry.

3. **Codigo uniqueness on edit:** If `codigo` is being changed, the use case must check uniqueness within `empresaId` (same as create). If `codigo` is NOT being changed, skip the check.

4. **Deactivation guard:** A product with active `DetalleVenta` or `DetalleCompra` references in the current period should NOT be deactivatable. However, the Prisma schema uses `onDelete: Restrict` on those FKs, so the DB will block the operation if there are child rows. The use case should catch the Prisma error and map it to `PRODUCTO_TIENE_MOVIMIENTOS`.

5. **Deactivation is soft-delete:** `activo = false`. No hard delete. The partial unique on `(empresaId, codigo)` means deactivating releases the `codigo` for reuse.

6. **Audit events:** `producto.updated` (with changed fields as `valorAnterior`/`valorNuevo`) and `producto.deactivated` (with `codigo`).

7. **Roles:** Same as create — `Administrador` and `Operador` for edit; `Administrador` only for deactivate (deactivation is a higher-privilege operation).

---

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| **Optimistic locking race** — two admins edit the same product simultaneously | Medium | `version` column + `UPDATE WHERE version = ?` pattern. Client receives `CONCURRENCIA_CONFLICTO` and must refetch. |
| **Codigo release on deactivation** — deactivating a product frees its `codigo` for reuse by another product; a concurrent create could claim it | Low | The partial unique constraint handles this at DB level. The create use case already maps P2002 to `CODIGO_PRODUCTO_DUPLICADO`. |
| **FK restrict on deactivation** — product has `DetalleVenta` or `DetalleCompra` children | Low | `onDelete: Restrict` in Prisma will throw; use case catches and maps to `PRODUCTO_TIENE_MOVIMIENTOS`. But in the current schema, `DetalleVenta.productoId` has `onDelete: Restrict`, so the DB blocks deletion. For soft-delete (`activo = false`), there's no FK issue — soft-delete doesn't touch children. |
| **Scope creep** — temptation to add category edit, bulk deactivate, etc. | Medium | Strict YAGNI. Only edit (partial update) and single-product deactivate. No bulk operations. |
| **Test coverage for optimistic locking** — hard to test concurrency in unit tests | Low | Test the version-mismatch path (read version X, update where version X, verify 0 rows → conflict). Real concurrency is an integration/E2E concern. |

---

## Test Strategy (TDD-aligned)

Following the project's testing priority: domain tests first (pure, no DB), then application tests (mocked infrastructure), then http tests (mocked everything).

### Domain Layer Tests

| File | Tests |
|------|-------|
| `domain/producto.ts` (existing) | No new tests needed — entity shape unchanged |
| `domain/errors.ts` (existing) | No new tests needed — error catalog extended with new codes |

### Application Layer Tests

| File | Tests |
|------|-------|
| `application/actualizar-producto.test.ts` | Happy path, `PRODUCTO_NO_ENCONTRADO`, `CODIGO_PRODUCTO_DUPLICADO` on codigo change, `CONCURRENCIA_CONFLICTO` on version mismatch, invalid tasa, invalid precio, invalid vigencia, cross-tenant category guard |
| `application/desactivar-producto.test.ts` | Happy path, `PRODUCTO_NO_ENCONTRADO`, `PRODUCTO_YA_INACTIVO`, `PRODUCTO_TIENE_MOVIMIENTOS` on FK restrict |

### HTTP Layer Tests

| File | Tests |
|------|-------|
| `http/actions.test.ts` (extend) | `actualizarProductoAction` happy path, validation error, ctx fail, use case error, unauthorized role; `desactivarProductoAction` happy path, ctx fail, use case error, unauthorized role |

---

## Ready for Proposal

**Yes.** The exploration is complete. The orchestrator should tell the user:

- The product module has a solid foundation (create + list with full test coverage)
- Edit and deactivate are well-scoped additions that follow the established patterns
- Optimistic locking via the existing `version` column is the right approach for concurrent edits
- Soft-delete (`activo = false`) is consistent with AGENTS.md (master entities are NEVER deleted)
- The change is within the 400-line review budget (estimated ~350 lines of new code + tests)
- No blocking risks identified

## Key Learnings

1. The Producto entity already has a `version` column for optimistic locking that was unused until now — edit must leverage it.
2. The partial unique constraint on `(empresaId, codigo) WHERE activo = true` means deactivation automatically releases the codigo for reuse.
3. The existing `toDomainProducto` mapper in the repository already handles the `activo` flag — deactivation is a simple `UPDATE SET activo = false`.
4. The `ActionResult<T>` type in `http/actions.ts` is already generic and reusable for new Server Actions.
5. The test pattern (mock infrastructure, test application logic) is well-established and should be followed exactly for new use cases.
