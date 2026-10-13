# Delta Spec — tenant (auth-tenant-selector, S1 + S2 Backend)

Admin-only branch listing and branch switch. Binding scope: proposal §S1, §S2.
Refs: doc 17 §5 (admin-only, no logout), doc 20 P6 (empresa immutable), doc 04 matrix
(server-side enforcement), `openspec/specs/tenant/with-tenant-transaction/spec.md`,
`openspec/specs/auth/spec.md` REQ-AUTH-AUD-001.

### Requirement: S1 — Admin-only "list my empresa's active branches" use case READS ONLY from session tenant context (P6)

`modules/tenant` SHALL expose a read use case `listarSucursalesDeEmpresa(ctx, deps)` that returns
ONLY the active branches (`activo = true`) of the caller's `empresaId`. The branch scope SHALL be
derived exclusively from the real `TenantCtx` resolved inside `withTenantTransaction` (NO
`app.is_login_flow`, R1.B stays pocket-sized). The use case signature SHALL accept NOEmpresa/branch
scope parameters from the caller: there is no `empresaId` argument and no client-provided filter —
P6 means the admin is permanently company-isolated and `empresaId` can never be influenced by
request input. The select SHALL be narrow (branch id, nombre, activo) — a pre-context read with no
deep tenant data.

#### Scenario: TEN-LIST-01-A — admin fetches only active branches of own empresa

- **GIVEN** an admin session resolved as `TenantCtx` with `empresaId = E`
- **AND** company E owns active branches B1, B2 and an inactive branch B3
- **WHEN** `listarSucursalesDeEmpresa` runs inside `withTenantTransaction`
- **THEN** the result contains exactly B1 and B2 with their `nombre` (no B3, no branch of any other empresa)
- **AND** the executed query where-clause is `{ empresaId: E, activo: true }` with a narrow select (id, nombre, activo)
- TEST: integration

#### Scenario: TEN-LIST-01-B — no empresa/sucursal scope is accepted from the client (P6)

- **GIVEN** any caller (admin or not) invoking the use case / its http adapter with extra input
  claiming a different `empresaId` (or a sucursal-filter payload)
- **WHEN** the use case executes
- **THEN** the query scope remains `ctx.empresaId` only — the extra input is ignored and never reaches the
  where-clause; ids from the client can never authorize a company-scoped list
- **AND** typecheck enforces it: the use case parameter surface has no empresa/sucursal scope field
- TEST: integration + typecheck

#### Scenario: TEN-LIST-01-C — non-admin denied server-side (deny-by-default, doc 04)

- **GIVEN** a session of despachador or cobrador (`esAdmin = false` from real roles)
- **WHEN** the use case is invoked directly (bypassing the UI)
- **THEN** it fails with a typed business error carrying a stable, catalog-registered deny code —
  no row data is ever returned
- TEST: integration

### Requirement: S1 — denial surfaces as a stable catalog code, never an ad-hoc error

Every authorization denial of S1/S2 SHALL return (not throw-to-client) a typed business error whose
stable code belongs to the module's versioned error catalog, following the existing per-module
catalog pattern (`auth/domain/errors.ts`, `venta/domain/errors.ts`): exported string constants, a
derived union type, a `messageFor` Spanish lookup. Adapters and components SHALL NOT inline codes.
The code is deny-by-default: any role not matching Administrador is rejected.

#### Scenario: TEN-CAT-02-A — denial carries a stable code and user-facing copy

- **GIVEN** a non-admin invocation of either use case
- **WHEN** the application layer converts the failure
- **THEN** the returned result is `{ ok: false, code: <STABLE_CATALOG_CODE>, message: <messageFor(code)> }`
- **AND** the message never leaks user ids, empresa ids, or stack/Prisma internals (19-directivas §9)
- TEST: unit

### Requirement: S1 — empty list returns success (no crash, no error)

An admin's empresa with zero `activo` branches SHALL resolve to `{ ok: true, data: [] }` — an empty
result is a valid read, not an error; no use-case-level exception is invented for it.

#### Scenario: TEN-LIST-03-A — empty active-branch set

- **GIVEN** empresa E where all branches are `activo = false`
- **WHEN** `listarSucursalesDeEmpresa` runs
- **THEN** the result is a success with an empty array
- TEST: unit

### Requirement: S2 — "Switch active branch" use case: behavior-level contract (persistence mechanism DEFERRED to design)

`modules/tenant` SHALL expose an admin-only switch use case (`cambiarSucursalActiva`). Its
persistence mechanism — session-scoped precedence vs rewriting `Usuario.sucursalId` — is an OPEN
design question (proposal §S2) and is deliberately NOT fixed by this spec. What IS fixed and
testable is the post-condition contract:

1. Server-side re-authorization re-verifies role (Administrador, doc 04) AND that the target
   branch belongs to the caller's `empresaId` (P6 invariant — never trust a client id alone).
2. The target branch MUST be `activo = true`.
3. Post-conditions: after a confirmed switch, every subsequent tenant resolution for this session
   (`getCurrentTenantContext` / `getCurrentTenantHeader` / RLS GUCs) resolves to the NEW
   `sucursalId`, and the previously current branch no longer applies.
4. Re-confirming the already-current branch is an idempotent NO-OP success, not an error.
5. The switch runs inside `withTenantTransaction` (concurrency-safe), under a real `TenantCtx`.
6. The switch MUST NOT mint LOGIN audit rows (branch change is NOT re-authentication;
   REQ-AUTH-AUD-001 untouched; no `app.is_login_flow` widening).
7. The path MUST NOT expose, transfer or consume synthetic emails — identity flows by `sub`/
   `nombreUsuario`, per ADR-014; no new signing token is minted by this path.
8. No new free strings or state enums (ADR-014/19; the result is a typed success/failure pair).

#### Scenario: TEN-SWITCH-04-A — happy path, context re-resolves to the target branch

- **GIVEN** admin U of empresa E currently operating on branch B1, with B2 active in E
- **WHEN** `cambiarSucursalActiva(ctx, { sucursalId: B2 })` succeeds
- **THEN** a subsequent request resolves session context with `sucursalId = B2` (header + GUCs)
- **AND** no audit row was written by this operation (the audit table gained no LOGIN row)
- TEST: integration

#### Scenario: TEN-SWITCH-04-B — target branch of another empresa is refused (P6)

- **GIVEN** admin U whose session `empresaId = E1`
- **WHEN** the switch is invoked targeting `sucursalId = B` (B belongs to E2)
- **THEN** the result is a denial with a stable catalog code (TEN-CAT-02 semantics)
- **AND** the branch context remains B1 unchanged
- TEST: integration

#### Scenario: TEN-SWITCH-04-C — non-admin denied (no input can authorize)

- **GIVEN** a despachador session for empresa E, branch B active and owned by E
- **WHEN** the switch targets B
- **THEN** the result is a denial with a stable catalog code; nothing changed
- TEST: integration

#### Scenario: TEN-SWITCH-04-D — inactive target branch refused

- **GIVEN** branch B3 with `activo = false` owned by the caller's empresa
- **WHEN** the switch targets B3
- **THEN** the result is a denial with a stable catalog code (consistent with the S1 filter that
  never lists it)
- TEST: integration

#### Scenario: TEN-SWITCH-04-E — idempotent no-op on the current branch

- **GIVEN** admin U already operating on B1
- **WHEN** the switch targets B1 again
- **THEN** the result is success, the context is unchanged, and no duplicate side effect (no extra
  write, no audit row) is produced
- TEST: integration

## Out of scope (testable anti-requirements)

- NO `app.is_login_flow` widening: R1.B stays the login bootstrap only; both S1/S2 run realTenantCtx.
- NO Login audit rows from the switch/list path (`REQ-AUTH-AUD-001` unchanged).
- NO Empresa selector of any kind: P6 — `empresaId` immutable at this layer.
- NO Plan model/schema, no premium persistence (the "(Version plan)" cut is static "free").
- NO new auth APIs, no new signing tokens, no free strings/enums.
- NO client business logic in the tenant module.
