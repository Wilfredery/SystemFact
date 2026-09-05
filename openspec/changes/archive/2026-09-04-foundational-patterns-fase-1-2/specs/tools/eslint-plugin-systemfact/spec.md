# Spec: tools/eslint-plugin-systemfact

**Capability ID**: tools/eslint-plugin-systemfact
**Change**: foundational-patterns-fase-1-2
**Status**: draft

## Purpose

Provides a project-local ESLint plugin with a custom rule that requires every Server Action to wrap its body in `withTenantTransaction`. The rule is the defense-in-depth layer that prevents developers from forgetting tenant isolation when the wrapper is available.

## Requirements

### Requirement: REQ-LINT-001: Plugin exports the rule

The plugin SHALL export a rule named `server-action-must-wrap-tenant`.

**Rationale**: A locally distributed rule keeps the tenant-isolation convention self-documenting and versioned with the codebase.

**Acceptance criteria**:
- `tools/eslint-plugin-systemfact/index.ts` exports the rule under the name `server-action-must-wrap-tenant`.
- The rule is importable by `eslint.config.mjs`.

**Scenarios**:

#### Scenario: LINT-001-A: import works

- Given a consumer imports `tools/eslint-plugin-systemfact`
- When it accesses `plugin.rules['server-action-must-wrap-tenant']`
- Then the rule object is defined and has `meta.type === 'problem'`

#### Scenario: LINT-001-B: rule appears in config

- Given the plugin is registered in `eslint.config.mjs`
- When `eslint --print-config app/src/modules/producto/http/actions.ts` runs
- Then the config contains `systemfact/server-action-must-wrap-tenant: 'error'`

### Requirement: REQ-LINT-002: Rule targets exported Server Actions

The rule SHALL target exported `FunctionDeclaration` and `ExportNamedDeclaration â†’ FunctionDeclaration` in files matching `app/**/actions/*.ts` and `app/**/actions/*.tsx`.

**Rationale**: Server Actions are Next.js functions exported from files under `actions/`. Only exported functions are callable from the client; unexported helpers and files outside `actions/` must not be flagged.

**Acceptance criteria**:
- An exported function in `app/**/actions/*.ts` is checked.
- A function outside the `actions/` glob is NOT checked.
- A non-exported function in an actions file is NOT checked.

**Scenarios**:

#### Scenario: LINT-002-A: function in action file is checked

- Given a file at `app/src/modules/producto/http/actions.ts`
- And an exported function `export async function crearProductoAction(...) { ... }`
- When ESLint runs the rule
- Then the function declaration is visited

#### Scenario: LINT-002-B: function outside action file is NOT checked

- Given a file at `app/src/lib/utils.ts`
- And an exported function `export async function helper(...) { ... }`
- When ESLint runs the rule
- Then the function is ignored

#### Scenario: LINT-002-C: non-exported function is NOT checked

- Given a file at `app/src/modules/producto/http/actions.ts`
- And a local function `async function internalHelper(...) { ... }`
- When ESLint runs the rule
- Then the function is ignored

### Requirement: REQ-LINT-003: First statement must call `withTenantTransaction`

The rule SHALL report an error with `messageId: 'missingTenantWrap'` when the first statement of the function body is NOT a `ReturnStatement` or `AwaitExpression` whose argument is a `CallExpression` to `withTenantTransaction`.

**Rationale**: The wrapper must be the first thing executed so every subsequent statement inside the Server Action runs inside a tenant-scoped transaction.

**Acceptance criteria**:
- `return withTenantTransaction(ctx, async (tx) => {...})` â†’ no error.
- `return await withTenantTransaction(ctx, async (tx) => {...})` â†’ no error.
- `await withTenantTransaction(ctx, async (tx) => {...})` as first statement â†’ no error.
- Any other first statement â†’ error reported.

**Scenarios**:

#### Scenario: LINT-003-A: action without wrapper reports error

- Given a Server Action whose first statement is `const data = await parseInput(input)`
- When ESLint runs the rule
- Then it reports `missingTenantWrap`

#### Scenario: LINT-003-B: action with `return withTenantTransaction(...)` passes

- Given a Server Action whose body is `return withTenantTransaction(ctx, async (tx) => {...})`
- When ESLint runs the rule
- Then no error is reported

#### Scenario: LINT-003-C: action with `return await withTenantTransaction(...)` passes

- Given a Server Action whose body is `return await withTenantTransaction(ctx, async (tx) => {...})`
- When ESLint runs the rule
- Then no error is reported

#### Scenario: LINT-003-D: action with `await withTenantTransaction(...)` as first stmt passes

- Given a Server Action whose first statement is `await withTenantTransaction(ctx, async (tx) => {...})`
- When ESLint runs the rule
- Then no error is reported

#### Scenario: LINT-003-E: action with wrapper after other statements reports error

- Given a Server Action whose first statement is `const x = ...; return withTenantTransaction(...)`
- When ESLint runs the rule
- Then it reports `missingTenantWrap`

### Requirement: REQ-LINT-004: Error message names `withTenantTransaction`

The rule's error message SHALL name `withTenantTransaction` explicitly so developers see exactly what to do.

**Rationale**: Self-documenting errors reduce onboarding friction and eliminate ambiguity about which wrapper to call.

**Acceptance criteria**:
- The message contains the literal string `withTenantTransaction`.
- The message contains the function name being linted.

**Scenarios**:

#### Scenario: LINT-004-A: message is self-documenting

- Given a Server Action named `crearProductoAction`
- When the rule reports `missingTenantWrap`
- Then the message is: `Server Action "crearProductoAction" must call withTenantTransaction(ctx, async (tx) => {...}) as its first statement to enforce tenant isolation.`

### Requirement: REQ-LINT-005: Plugin is wired into the project ESLint config

The plugin SHALL be wired into `app/eslint.config.mjs` under the existing typescript-eslint plugin chain.

**Rationale**: A rule that is not enabled in CI will be ignored. The plugin must be part of the standard lint run.

**Acceptance criteria**:
- `pnpm lint` (or equivalent) executes the rule.
- CI fails when a new Server Action violates the rule.
- The rule can be disabled per-line with `// eslint-disable-next-line systemfact/server-action-must-wrap-tenant` for documented exceptions.

**Scenarios**:

#### Scenario: LINT-005-A: lint runs with rule active

- Given the plugin is registered and the rule is enabled
- When `pnpm lint` runs
- Then no configuration error occurs
- AND violations in `actions.ts` files are reported

#### Scenario: LINT-005-B: per-line disable works

- Given a documented exception marked with `// eslint-disable-next-line systemfact/server-action-must-wrap-tenant`
- When ESLint runs
- Then the next line is not flagged

### Requirement: REQ-LINT-006: Rule has unit tests

The plugin SHALL have a unit test (Vitest or Jest with typescript-eslint's `RuleTester`) covering at least 6 positive/negative cases.

**Rationale**: Custom rules regress easily during refactors; automated tests prevent silent false positives/negatives.

**Acceptance criteria**:
- At least 3 valid cases pass without errors.
- At least 3 invalid cases produce `missingTenantWrap`.
- Tests exercise `ReturnStatement`, `AwaitExpression`, and non-first-statement patterns.

**Scenarios**:

#### Scenario: LINT-006-A: rule tests pass

- Given a `RuleTester` configuration with valid and invalid code samples
- When the test suite runs
- Then all 6+ cases pass

## Edge cases

- Server Action with no body (abstract/ambient declaration) â†’ rule ignores it.
- Arrow-function export (`export const action = async () => ...`) â†’ not covered by v1 (documented limitation); no false positive.
- Function renamed to something other than `withTenantTransaction` â†’ rule reports an error.
- Wrapper imported from a path other than `@/modules/tenant/infrastructure/with-tenant-transaction` â†’ rule still matches by callee identifier name (heuristic; acceptable for v1).
- Empty function body â†’ rule ignores it.
- `use server` directive only file with no exported functions â†’ rule ignores it.

## Out of scope

- Auto-fix for violations (too risky for AST rewriting).
- Linting Server Actions defined as arrow-function exports.
- Tracking `withTenantTransaction` import source precisely (v1 matches by identifier name).
- Rules other than `server-action-must-wrap-tenant`.

## Dependencies

- `@typescript-eslint/utils` for `RuleCreator` and `RuleTester`.
- `app/eslint.config.mjs` registration.
- `withTenantTransaction` existing and stable in `tenant/infrastructure/withTenantTransaction.ts`.
