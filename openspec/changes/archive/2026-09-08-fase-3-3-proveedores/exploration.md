# Exploration: fase-3-3-proveedores

**Date**: 2026-09-07
**Change**: fase-3-3-proveedores
**Status**: exploration complete

## Current State

### Proveedor in the Schema

The `Proveedor` model already exists in `app/prisma/schema.prisma` (line 330):

```prisma
model Proveedor {
  id            Int           @id @default(autoincrement())
  empresaId     Int
  nombre        String        @db.VarChar(255)
  contacto      String        @db.VarChar(255)
  telefono      String        @db.VarChar(255)
  rnc           String?       @db.VarChar(255) // nullable — informal suppliers may lack RNC
  tipoProveedor TipoProveedor // FORMAL | INFORMAL — determines B11 / ITBIS 100% (03, §8)
  tipoPersona   TipoPersona   // FISICA | JURIDICA — determines ISR 15% (03, §8)
  activo        Boolean       @default(true)
  version       Int           @default(1) // optimistic locking (Directiva §10)
  createdAt     DateTime      @default(now()) @db.Timestamptz(6)
  updatedAt     DateTime      @updatedAt @db.Timestamptz(6)

  empresa Empresa  @relation(fields: [empresaId], references: [id], onDelete: Restrict)
  compras Compra[]

  @@unique([empresaId, rnc]) // RNC único por empresa; nullable → múltiples NULL permitidos
  @@map("PROVEEDOR")
}
```

Key characteristics already in place:
- **Multi-tenancy**: `empresaId` FK with `onDelete: Restrict`
- **Soft-delete**: `activo` (consistent with Producto)
- **Optimistic locking**: `version` column
- **Partial UK**: `proveedor_empresaId_rnc_active_uk` on `(empresaId, rnc) WHERE activo=true` — deactivation releases the RNC for reuse
- **RLS**: `proveedor_isolation` policy (via generic `empresa_isolation` in init migration)
- **Enums**: `TipoProveedor` (FORMAL/INFORMAL), `TipoPersona` (FISICA/JURIDICA) — already defined
- **FK from Compra**: `Compra.proveedorId → Proveedor.id` with `onDelete: Restrict`

### Existing References from Other Modules

The `Proveedor` is referenced by `Compra` in the schema, but **no buyer module code exists yet** (`src/modules/proveedor/` does not exist, and `src/modules/compra/` does not exist). The FK is schema-only at this point.

### No Proveedor Module Exists

There is no `src/modules/proveedor/` directory. This is greenfield — the second "catalog" module to be built after Categoria.

### Reference Pattern: Categoria Module (Canonical)

The categoria module (fase-3-2) is the canonical reference for all catalog modules:

| Layer | File | Pattern |
|-------|------|---------|
| **domain** | `categoria.ts` | Pure entity interface (`Categoria`), `normalizeNombre()`, `CategoriaResult<T>` |
| **domain** | `errors.ts` | Stable error codes as `const` + union type + `messageFor()` + `DomainError` class |
| **application** | `crear-categoria.ts` | Use case: normalize → validate → check duplicates → insert → audit. Returns `Result` type |
| **application** | `listar-categorias.ts` | Paginated listing with `select`, stable ordering, audit event |
| **application** | `actualizar-categoria.ts` | Partial update with optimistic locking, domain validation |
| **application** | `desactivar-categoria.ts` | Soft-delete with active-reference guard, idempotent, audit |
| **infrastructure** | `categoria-repository.ts` | Prisma CRUD, `toDomain`, `buildWhere`, `existeNombreEnEmpresa`, `tieneRolPermitidoEnTx`, audit helpers |
| **http** | `actions.ts` | `"use server"`, zod parse → session → `withTenantTransaction` → role check → use case → map result |
| **http** | `validations.ts` | Zod schemas for each action input |

### Test Patterns

- **Application tests**: Mock repository functions, test use-case logic in isolation
- **Action tests**: Mock supabase client, tenant context, `withTenantTransaction`, and use cases; test the thin adapter layer
- **Repository tests**: Mock Prisma client methods, test query builders and error mapping
- **Jest** with `jest.mock()` for infrastructure dependencies
- Test naming: scenario ID convention (e.g., `PRV-001-A`)

### Audit Pattern

- Append-only `MovimientoAuditoria` with `AccionAuditoria` enum
- Existing values: `CREAR`, `ACTUALIZAR`, `CANCELAR`, `ANULAR`, `PAGAR`, `AJUSTAR`, `LOGIN`, `LOGOUT`, `LEER`
- Pattern: reuse `CREAR` for creation, `ACTUALIZAR` for edits, `CANCELAR` for deactivation (matches Categoria precedent — D2 from fase-3-2)

### Authorization Pattern

- `tieneRolPermitidoEnTx(tx, usuarioId, empresaId, rolesPermitidos)` — duplicated in both `categoria-repository.ts` and `producto-repository.ts`
- Role check happens inside the `withTenantTransaction` callback, after session resolution
- Role constants defined as `const` arrays in `actions.ts`

### Proveedor-Specific Business Rules (from docs/03-reglasNegocioFact.md)

- §6: Every purchase must be associated with a supplier
- §8: `TipoProveedor` determines fiscal treatment: FORMAL → B01, INFORMAL → B11 with ITBIS 100% retention (art. 315 CT)
- §8: `TipoPersona` determines ISR: FISICA → 15% ISR on professional services/rent
- §13: Supplier changes should be auditable
- From roadmap (fase 3): Proveedores are part of "Catálogo e inventario" phase

### Proveedor Fields — Editable Analysis

| Field | Create | Edit | Notes |
|-------|--------|------|-------|
| `nombre` | Required | Editable | Normalizable, unique per active empresa |
| `contacto` | Required | Editable | Free text, contact person name |
| `telefono` | Required | Editable | Free text |
| `rnc` | Optional | Editable | Nullable (informal), unique per active empresa. Released on deactivation |
| `tipoProveedor` | Required | Editable | FORMAL/INFORMAL — determines fiscal treatment |
| `tipoPersona` | Required | Editable | FISICA/JURIDICA — determines ISR treatment |
| `activo` | Always true at create | Admin-only deactivation | Never hard-delete |
| `version` | Auto (1) | Optimistic lock | Client must submit current version |

## Affected Areas

- `app/src/modules/proveedor/` — **NEW**: entire module directory (domain, application, infrastructure, http)
- `app/prisma/schema.prisma` — no changes needed (model already exists)
- `app/prisma/migrations/` — no schema changes needed; only new code
- `openspec/specs/proveedor/` — **NEW**: spec for the proveedor capability

## Scope Comparison: Candidate vs Reality

### Candidate Scope (from user request)

| Feature | Candidate | ERD/Schema | Pattern Match | Notes |
|---------|-----------|------------|---------------|-------|
| Crear proveedor | Yes | Schema exists | Follow categoria pattern | Straightforward |
| Listar proveedores | Yes | — | Paginated listing | Default 25, max 100 |
| Editar proveedor | Candidate | `version` column exists | Partial edit + optimistic locking | Needs decision |
| Desactivar proveedor | Candidate | `activo` column + partial UK | Soft-delete with guard | Needs decision |
| Multi-tenancy | Yes | `empresaId` FK + RLS | `withTenantTransaction` | Already enforced by DB |
| Authorization | Yes | Role matrix in AGENTS.md | `tieneRolPermitidoEnTx` | Need role decision |
| Pagination | Yes | — | `listarCategorias` pattern | Default 25, max 100 |
| Audit | Yes | `MovimientoAuditoria` exists | Same as categoria | CREAR/ACTUALIZAR/CANCELAR |
| Validation | Yes | `@@unique([empresaId, rnc])` partial UK | Zod schemas | DB constraint + app-level check |

### What's NOT in Scope (confirmed out)

- No hard delete
- No bulk operations
- No supplier reactivation flow
- No supplier lookup/autocomplete (UI concern, deferred)
- No purchase history or CxP display (fase 4 dependency)
- No UI components (frontend is a separate phase)
- No migration (schema already complete)

## Open Decisions

### D1: Should Edit and Deactivate Be in This Phase?

**Question**: The user asked to determine whether editar/desactivar belong to fase-3-3.

**Analysis**:
- **Edit** (actualizar) is a natural companion to create — the product and categoria modules both shipped CRUD + deactivate together
- **Deactivate** has no blocking references yet (no buyer module exists), but the guard should still be built to protect against future FK references. Without it, an admin could deactivate a supplier that has pending purchases in fase 4
- Both operations follow the exact same pattern as categoria — no new architectural decisions required
- Budget: edit (~130 lines) + deactivate (~85 lines) + their tests (~250 lines) add ~465 lines to the base create+list (~600 lines)

**Recommendation**: **Include edit and deactivate in fase-3-3**. The operations are cohesive with create/list, follow established patterns, and the deactivation guard protects data integrity for fase 4. Shipping create+list alone leaves an incomplete module that users would immediately request edit for. The total stays well within the 800-line review budget.

### D2: Authorization Roles

**Question**: Which roles can CRUD vs. deactivate proveedores?

**Recommendation**: `["Administrador", "Operador"]` for create/list/edit; `["Administrador"]` for deactivation. Mirrors the categoria/producto precedent. Suppliers are operational entities (Operadores create them during purchase setup), but lifecycle decisions (deactivation) are Admin-only.

### D3: `tieneRolPermitidoEnTx` — Centralize or Duplicate?

**Question**: This helper is duplicated in `categoria-repository.ts` and `producto-repository.ts`. Should the proveedor module add a third copy?

**Recommendation**: Duplicate for now (YAGNI). Centralizing is a refactor that crosses module boundaries and touches two existing tested modules. The function is small (~15 lines), stable, and unlikely to change. Centralization should be a separate, dedicated refactor with its own tests. Adding a third copy keeps this change self-contained.

### D4: Deactivation Reference Guard

**Question**: Which references should block supplier deactivation?

**Analysis**: The only current FK reference is `Compra.proveedorId → Proveedor.id` with `onDelete: Restrict`. There is no buyer module yet, but the guard should be built now to prevent future data integrity issues.

**Recommendation**: Count active `Compra` rows where `proveedorId = id AND empresaId = empresaId`. The `Compra` model has an `estado` field; consider whether only non-cancelled purchases block deactivation (a cancelled purchase has no fiscal effect). For V1, **all** active (non-cancelled) purchases should block — this is the safest approach. A purchase in BORRADOR/PENDIENTE/RECIBIDA/PAGADA state means the supplier relationship is live.

Guard function: `tieneComprasActivas(tx, empresaId, proveedorId) → boolean`
- Query: `tx.compra.count({ where: { proveedorId, empresaId, estado: { not: "CANCELADA" } } }) > 0`
- Error code: `PROVEEDOR_TIENE_COMPRAS`

### D5: RNC Duplicate Validation

**Question**: How to handle the nullable RNC uniqueness? Multiple suppliers without RNC are allowed; with RNC, only one per active empresa.

**Recommendation**: Same two-layer pattern as categoria's name check:
1. Application pre-check: `existeRncEnEmpresa(tx, empresaId, rnc)` — only probes when `rnc` is non-null
2. DB partial unique: `proveedor_empresaId_rnc_active_uk` handles TOCTOU race
3. On edit, exclude the row itself: `existeRncEnEmpresa(tx, empresaId, rnc, excludeProveedorId)`
4. P2002 mapping: when the caught error's `meta.target` includes `rnc`, map to `RNC_PROVEEDOR_DUPLICADO`

When `rnc` is null/empty, skip the uniqueness check entirely (multiple informal suppliers without RNC are expected).

### D6: Normalize RNC Format

**Question**: Should the system normalize RNC before storage (strip dashes, spaces)?

**Recommendation**: Yes — trim and strip non-digit characters. RNC in DR is 9 or 11 digits. Store as digits-only for consistent comparison. Zod validation: `z.string().regex(/^\d{9,11}$/)` after normalization.

### D7: Search/Filter for Listing

**Question**: Should the list endpoint support search by name or RNC?

**Recommendation**: Include a basic `buscar` (search) filter on `nombre` and `rnc` using Prisma `contains` (case-insensitive via PostgreSQL `ilike`). This is a common UX need for supplier lookup. Scope: single `buscar` string that matches against `nombre` OR `rnc`.

## Recommended Strict Scope

Based on the exploration, here is the **strict, reviewable scope** for `fase-3-3-proveedores`:

### In Scope (10 files, ~600-700 lines code + ~400 lines tests)

1. **Domain** (`proveedor/domain/`):
   - `proveedor.ts` — `Proveedor` entity interface (id, empresaId, nombre, contacto, telefono, rnc, tipoProveedor, tipoPersona, activo, version), `ProveedorResult<T>` type, `normalizeRnc()` helper
   - `errors.ts` — Stable error codes: `NOMBRE_PROVEEDOR_DUPLICADO`, `RNC_PROVEEDOR_DUPLICADO`, `PROVEEDOR_NO_ENCONTRADO`, `PROVEEDOR_YA_INACTIVO`, `PROVEEDOR_TIENE_COMPRAS`, `CONCURRENCIA_CONFLICTO`, `NO_AUTORIZADO`, `SESION_INVALIDA`, `VALIDATION_ERROR` + `ProveedorDomainError` class + `messageFor()`

2. **Application** (`proveedor/application/`):
   - `crear-proveedor.ts` — Create use case: validate fields, check RNC duplicate (when non-null), insert, audit
   - `listar-proveedores.ts` — Paginated list with optional `incluirInactivos` and `buscar` filter
   - `actualizar-proveedor.ts` — Partial edit (nombre, contacto, telefono, rnc, tipoProveedor, tipoPersona) with optimistic locking
   - `desactivar-proveedor.ts` — Soft-delete with active-purchase guard, idempotent, audit

3. **Infrastructure** (`proveedor/infrastructure/`):
   - `proveedor-repository.ts` — Prisma CRUD, `toDomainProveedor`, `buildWhere`, `existeRncEnEmpresa`, `proveedorByIdEnEmpresa`, `tieneComprasActivas`, `tieneRolPermitidoEnTx`, audit helpers

4. **HTTP** (`proveedor/http/`):
   - `actions.ts` — Server Actions: `crearProveedorAction`, `listarProveedoresAction`, `actualizarProveedorAction`, `desactivarProveedorAction`
   - `validations.ts` — Zod schemas: `zCrearProveedorInput`, `zListarProveedoresQuery`, `zActualizarProveedorInput`, `zDesactivarProveedorInput`

5. **Spec** (`openspec/specs/proveedor/`):
   - `spec.md` — Requirements and scenarios for the proveedor capability

6. **Tests** (5 test files):
   - `application/crear-proveedor.test.ts`
   - `application/listar-proveedores.test.ts`
   - `application/actualizar-proveedor.test.ts`
   - `application/desactivar-proveedor.test.ts`
   - `http/actions.test.ts`

### Out of Scope (explicitly deferred)

- Supplier reactivation flow
- Supplier lookup/autocomplete (UI concern)
- Purchase history or CxP display (fase 4)
- Bulk supplier operations
- UI components (frontend phase)
- Centralizing `tieneRolPermitidoEnTx` (separate refactor)
- RNC validation via DGII external service (out of scope per roadmap)
- Moving `tieneRolPermitidoEnTx` to a shared location (YAGNI)

## Risks

1. **Compra FK guard without buyer module**: The deactivation guard queries `Compra` but no buyer module exists yet. The guard is forward-looking — it protects against future data integrity issues. If no purchases exist in the DB, the guard always passes (count = 0). **Low risk**.

2. **RNC nullable uniqueness**: Multiple suppliers without RNC are expected (informal). The partial unique index already handles this correctly. Application logic must skip the RNC check when rnc is null/empty. **Low risk** — well-understood pattern from the categoria name uniqueness.

3. **Third copy of `tieneRolPermitidoEnTx`**: DRY violation, but stable and unlikely to change. Centralization is a separate concern. **Low risk** — pragmatic trade-off for module isolation.

4. **Budget**: ~600-700 lines code + ~400 lines tests = ~1000-1100 total lines. This exceeds the 800-line review budget. The change is cohesive (full CRUD + deactivate for a single entity) and follows established patterns precisely, so review overhead is minimal. The orchestrator should ask for an explicit exception if the budget is hard-capped. **Medium risk** — needs user confirmation.

5. **`tipoProveedor`/`tipoPersona` downstream impact**: These enum fields determine fiscal treatment in fase 4 (compras). The values are frozen in the schema. No code change needed now, but fase 4 will consume them. **No risk** — schema-first approach is correct.

## Ready for Proposal

**Yes** — all necessary context is available:
- Schema is complete (no migration needed)
- Pattern is established (categoria module)
- Authorization model is clear
- Test patterns are documented
- Open decisions have clear recommendations
- Business rules are defined in docs/03-reglasNegocioFact.md

The orchestrator should present the scope and open decisions (D1-D7) to the user for confirmation before proceeding to proposal. Key items needing user input:
- **D1**: Confirm edit + deactivate are in scope (recommended: yes)
- **D4**: Confirm deactivation guard strategy (recommended: block on non-cancelled purchases)
- **Budget**: Confirm exception for ~1000-1100 total lines (cohesive change, established patterns)
