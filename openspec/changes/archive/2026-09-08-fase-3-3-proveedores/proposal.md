# Proposal: Proveedores Module (fase-3-3)

## Intent

The `Proveedor` Prisma model exists but has zero module code. Fase 4 purchases require supplier management with fiscal-critical classification: `TipoProveedor` (FORMAL → B01, INFORMAL → B11 + ITBIS 100% retention) and `TipoPersona` (FISICA → ISR 15%). This change delivers the tenant-scoped supplier catalog following the categoria module pattern, with full CRUD including edit and admin-only deactivation.

## Scope

### In Scope

- `src/modules/proveedor/` full 4-layer module (domain, application, infrastructure, http)
- 4 Server Actions: create, paginated list (`buscar` on nombre/RNC + `incluirInactivos`, default 25 / max 100), edit with optimistic locking, deactivate (Admin-only)
- RNC normalization (strip separators → digits-only) + 9–11 digit validation; duplicate check via app pre-check + DB partial UK, skipped when null
- Deactivation guard: blocked by non-cancelled `Compra` references (`PROVEEDOR_TIENE_COMPRAS`)
- Role matrix: Administrador+Operador for CRUD/list; Administrador only for deactivate
- Audit rows (CREAR/ACTUALIZAR/CANCELAR) inside the tenant transaction
- 5 test files; capability spec at `openspec/specs/proveedor/spec.md`

### Out of Scope

- Reactivation flow, bulk operations, UI components, autocomplete lookup
- Purchase history / CxP display (fase 4); DGII external RNC validation
- Centralizing `tieneRolPermitidoEnTx` (third copy kept — YAGNI, authorized)
- Schema or migration changes (model already complete)

## Capabilities

### New Capabilities

- `proveedor`: Tenant-scoped supplier catalog with fiscal classification, nullable RNC uniqueness (released on deactivation), guarded soft deactivation, optimistic locking, paginated search, and transactional audit.

### Modified Capabilities

None

## Approach

Clone the categoria module structure across all 4 layers. Domain holds the pure entity, `ProveedorResult<T>`, `normalizeRnc()`, and stable error codes as `const` + union type. Infrastructure keeps its own `tieneRolPermitidoEnTx` copy plus `existeRncEnEmpresa` (excludes self on edit, skips null), `tieneComprasActivas` (`estado != CANCELADA`), and audit helpers. Use cases return typed results with stable business-error codes. Actions flow: zod parse → session → `withTenantTransaction` → role check → use case. RNC uniqueness defense-in-depth: pre-check → partial UK `proveedor_empresaId_rnc_active_uk` (TOCTOU) → P2002 mapped to `RNC_PROVEEDOR_DUPLICADO`.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `app/src/modules/proveedor/**` | New | Entire module: 9 source files + 5 test files |
| `openspec/specs/proveedor/spec.md` | New | Capability spec (created in spec phase) |
| `app/prisma/schema.prisma` | None | Model already complete, no migration |

## Risks

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Compra guard queries a not-yet-existing buyer module | Low | Count query only; returns 0 today; forward-looking integrity for fase 4 |
| Third `tieneRolPermitidoEnTx` copy (DRY violation) | Low | Authorized decision; stable ~15 lines; centralization as separate refactor |
| Size ~1000–1100 lines exceeds 800-line budget | Medium | User-authorized exception: cohesive single-entity CRUD, established patterns |
| RNC nullable uniqueness edge cases | Low | Skip check on null; partial UK handles races; P2002 mapped |

## Rollback Plan

Pure addition: one new module directory + one new spec file, no migrations, no edits to existing files. A single `git revert` of the feature commit restores the green state; no data cleanup required.

## Dependencies

- None external. Schema (`Proveedor`, enums `TipoProveedor`/`TipoPersona`, partial UK, RLS) shipped in prior migrations.

## Success Criteria

- [ ] 4 Server Actions follow zod → session → `withTenantTransaction` → role check → use case
- [ ] RNC stored digits-only with 9–11 digit validation; null RNC skips uniqueness check
- [ ] Deactivation returns `PROVEEDOR_TIENE_COMPRAS` when non-cancelled purchases exist
- [ ] Role matrix enforced server-side (Admin+Operador CRUD/list; Admin deactivate)
- [ ] Audit rows appended for every mutation inside the transaction
- [ ] 5 test files cover all scenarios; `pnpm test` green including existing suites
