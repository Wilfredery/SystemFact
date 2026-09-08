# Design: Proveedor Module

## Technical Approach

Add `app/src/modules/proveedor/` as a four-layer modular-monolith module, mirroring the Categoria implementation without changing existing modules or the Prisma schema. The domain stays pure; application use cases orchestrate validation and business rules; infrastructure owns tenant-scoped Prisma access and audit writes; HTTP exposes four thin Server Actions. `TipoProveedor` and `TipoPersona` remain frozen fiscal classifications: `FORMAL`/`INFORMAL` and `FISICA`/`JURIDICA`.

## Architecture Decisions

| Decision | Choice | Alternatives considered | Rationale |
|---|---|---|---|
| Module shape | Clone Categoria's four layers and typed-result pattern. | Shared generic catalog framework. | Existing convention is proven; a generic abstraction would widen scope. |
| RNC identity | Normalize to digits only; blank becomes `null`; validate 9–11 digits; enforce active-per-company uniqueness with pre-check plus partial UK/P2002 mapping. | DGII lookup or application-only uniqueness. | Consistent comparisons, nullable informal suppliers, and race-safe persistence without external dependency. |
| Deactivation | Soft-deactivate only; block when `Compra.estado != CANCELADA`. | Hard delete or FK-error reliance. | Preserves history and gives an explicit business error before future purchase flows exist. |
| Concurrency and authorization | `version` in `UPDATE ... WHERE id AND empresaId AND version`; Admin+Operador for CRUD/list, Admin-only for deactivate. | Last-write-wins or UI-only authorization. | Matches project directives and Categoria precedent. |
| Audit and rollback | Append `CREAR`, `ACTUALIZAR`, `CANCELAR` in the same tenant transaction. | Separate audit transaction. | A rollback must remove both business mutation and audit event. |

## Data Flow

```text
Server Action → Zod parse → session/tenant context → withTenantTransaction
             → role check → application use case → Prisma repository + audit
             → typed result → public action DTO
```

Creation and editing normalize/validate fields before duplicate probing. Listing uses a bounded query (`page`, default 25, maximum 100), active-only by default, and an optional `buscar` OR filter over `nombre`/digits-only `rnc`. Deactivation reads the tenant row, checks non-cancelled purchases, then atomically flips `activo=false`.

## File Changes

| File | Action | Description |
|---|---|---|
| `app/src/modules/proveedor/domain/proveedor.ts` | Create | Pure entity, fiscal classification contracts, `ProveedorResult`, and RNC normalization. |
| `app/src/modules/proveedor/domain/errors.ts` | Create | Stable validation, duplicate, authorization, concurrency, purchase-guard, and lifecycle errors. |
| `app/src/modules/proveedor/application/crear-proveedor.ts` | Create | Typed create use case with normalized RNC and audit. |
| `app/src/modules/proveedor/application/listar-proveedores.ts` | Create | Bounded, searchable, tenant-scoped listing use case. |
| `app/src/modules/proveedor/application/actualizar-proveedor.ts` | Create | Partial edit use case with optimistic locking. |
| `app/src/modules/proveedor/application/desactivar-proveedor.ts` | Create | Guarded soft-deactivation use case. |
| `app/src/modules/proveedor/infrastructure/proveedor-repository.ts` | Create | Explicit Prisma selects, tenant filters, RNC/Compra guards, optimistic writes, role helper, and audit helper. |
| `app/src/modules/proveedor/http/actions.ts` | Create | Four thin Server Actions with session, tenant transaction, and role gates. |
| `app/src/modules/proveedor/http/validations.ts` | Create | Zod schemas for the four action inputs. |
| `app/src/modules/proveedor/application/crear-proveedor.test.ts` | Create | Create validation, duplicate RNC, and audit tests. |
| `app/src/modules/proveedor/application/listar-proveedores.test.ts` | Create | Pagination, search, and active-filter tests. |
| `app/src/modules/proveedor/application/actualizar-proveedor.test.ts` | Create | Partial update and stale-version tests. |
| `app/src/modules/proveedor/application/desactivar-proveedor.test.ts` | Create | Purchase guard, idempotency, and audit tests. |
| `app/src/modules/proveedor/http/actions.test.ts` | Create | Action parsing, roles, sessions, and DTO mapping tests. |
| `openspec/specs/proveedor/spec.md` | Create | Capability requirements and scenarios. |
| `app/prisma/schema.prisma` / migrations | No change | Existing model, enums, partial UK, FK, and RLS are sufficient. |

## Interfaces / Contracts

The domain exposes readonly fields: `id`, `empresaId`, `nombre`, `contacto`, `telefono`, nullable normalized `rnc`, `tipoProveedor`, `tipoPersona`, `activo`, and `version`. Runtime constants must use `as const` with extracted union types. Action DTOs return only required identifiers, version, classification, and paginated rows; Prisma models never cross HTTP boundaries. Every result is `{ ok: true, data }` or `{ ok: false, code, message }`.

## Testing Strategy

| Layer | What to Test | Approach |
|---|---|---|
| Unit | RNC normalization, 9–11 digit validation, fiscal enum validation, typed errors. | Pure Jest tests. |
| Application/infrastructure | Tenant filtering, nullable duplicate rules, P2002 mapping, stale version, non-cancelled purchase guard, transactional audit. | Mock Prisma/repository dependencies; scenario IDs `PRV-*`. |
| HTTP | Zod rejection, invalid session, role matrix, transaction wrapper, DTO mapping. | Mock Supabase, tenant context, wrapper, and use cases. |

## Threat Matrix

N/A — this change has no shell, subprocess, VCS/PR automation, executable-file classification, or process-integration boundary. Server Actions are application HTTP adapters, not routing/process orchestration.

## Migration / Rollout

No migration required. Rollback is pure addition: revert the single feature commit to remove the new module/spec; no existing files or data require cleanup. Since no schema changes are introduced, deployed database state remains compatible throughout rollback.

## Open Questions

- None blocking. Reactivation, bulk operations, autocomplete, purchase history, and DGII validation remain explicitly out of scope.
