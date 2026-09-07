# Design: Edit and Deactivate Product

## Technical Approach

Extend the existing `producto` modular-monolith flow with two independent use cases: `actualizarProducto` for partial edits and `desactivarProducto` for single-product soft deactivation. Server Actions remain thin adapters: validate with Zod, resolve the tenant context, authorize inside `withTenantTransaction`, then delegate to the application layer. Prisma access and append-only audit writes remain in `producto-repository.ts`. No schema or migration changes are required.

## Architecture Decisions

| Option | Tradeoff | Decision |
|---|---|---|
| Separate use-case files vs. one lifecycle service | Separate files add two modules but match the established create/list pattern and isolate tests. | Use `actualizar-producto.ts` and `desactivar-producto.ts`. |
| Partial patch vs. full replacement | Patch reduces payload and conflict surface; it requires changed-field construction. | Accept at least one editable field and update only supplied fields. |
| Optimistic locking vs. last-write-wins | Locking prevents silent data loss; stale clients must retry. | Read `version`, update with `WHERE id + empresaId + version`, increment `version`, map zero rows to `CONCURRENCIA_CONFLICTO`. |
| Database FK failure vs. explicit reference check | Soft-delete is an `UPDATE`, so `onDelete: Restrict` cannot protect it. | Explicitly check active `DetalleVenta`/`DetalleCompra` references in the repository and return `PRODUCTO_TIENE_MOVIMIENTOS`. |

## Data Flow

```text
Server Action
  -> Zod + session tenant context
  -> withTenantTransaction(ctx)
  -> role check (Admin+Operator edit; Admin deactivate)
  -> application use case
  -> tenant-filtered Prisma repository
  -> product UPDATE + audit INSERT in same transaction
  -> typed ActionResult
```

Edit loads the active, tenant-owned product, validates only supplied domain fields (price, ITBIS rate/window, and category ownership), checks code uniqueness only when `codigo` changes, then performs the versioned update. Deactivation loads the tenant-owned product, rejects missing/already inactive rows, checks active movement references, sets `activo=false`, and records the deactivation. The existing active-only code uniqueness index makes the code reusable after deactivation; no hard delete occurs.

## File Changes

| File | Action | Description |
|---|---|---|
| `app/src/modules/producto/domain/errors.ts` | Modify | Add four stable error codes/messages. |
| `app/src/modules/producto/application/actualizar-producto.ts` | Create | Partial validation, category/code checks, optimistic-lock orchestration, audit call. |
| `app/src/modules/producto/application/desactivar-producto.ts` | Create | Active-state/reference guards, soft-deactivation orchestration, audit call. |
| `app/src/modules/producto/infrastructure/producto-repository.ts` | Modify | Tenant-scoped fetch, active-reference query, versioned update, deactivation update, and audit helpers. |
| `app/src/modules/producto/http/validations.ts` | Modify | Add edit schema (at least one field) and deactivate schema. |
| `app/src/modules/producto/http/actions.ts` | Modify | Add two thin, authorized Server Actions using the existing transaction wrapper/result type. |
| `app/src/modules/producto/application/{actualizar-producto,desactivar-producto}.test.ts` | Create | Application behavior and error-path tests. |
| `app/src/modules/producto/http/actions.test.ts` | Modify | Action validation, authorization, transaction, success, and error mapping tests. |

## Interfaces / Contracts

```typescript
type ActualizarProductoInput = {
  readonly id: number;
  readonly version: number;
  readonly nombre?: string;
  readonly descripcion?: string | null;
  readonly precioVenta?: Prisma.Decimal;
  readonly itbisTasa?: TasaItbis;
  readonly itbisVigenteDesde?: Date;
  readonly itbisVigenteHasta?: Date | null;
  readonly itbisAplicaRetencionITBIS?: boolean;
  readonly codigo?: string;
  readonly categoriaId?: number;
};
```

Use cases return the established discriminated `{ ok: true } | { ok: false; code; message }` result. Repository methods accept `PrismaTx` and `TenantCtx`; every product/reference query includes `empresaId`.

## Testing Strategy

| Layer | What to Test | Approach |
|---|---|---|
| Unit/application | Partial fields, domain validation, category/code guards, not found, stale version, already inactive, active references, successful version bump and soft-delete. | Jest with mocked repository functions, matching existing tests. |
| Integration | Tenant predicates, `UPDATE ... version`, code release, atomic audit rollback/commit. | Existing Prisma integration harness if available; otherwise repository contract coverage. |
| E2E | Not added in this scoped change. | Existing product UI is not part of the proposal. |

## Threat Matrix

N/A — no routing, shell, subprocess, VCS/PR automation, executable-file classification, or process-integration boundary.

## Migration / Rollout

No migration required. Existing `version`, `activo`, tenant keys, and active-only code uniqueness are used as-is. Rollback is a code revert; existing soft-deactivations remain non-destructive.

## Open Questions

- None blocking. The repository must preserve the existing project definition of an active movement reference when implementing the explicit guard.
