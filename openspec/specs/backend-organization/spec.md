# Delta Spec: Selective backend-pure reorganization

## 1. Problem statement
Files with 1000+ lines reduce maintainability and reuse. Need safe, incremental reorganization limited to backend-pure areas (ADR-013), deferring UI-crossing until after frontend work.

## 2. Requirements
### Requirement 1: Behavior-preserving refactor only
- No logic changes to business rules, fiscal calculations, inventory/NCF semantics, or RLS/GUC behavior.
- All moves preserve public behavior and error semantics.

### Requirement 2: Scope boundaries
- Allowed: `http/actions.ts` split by use-case (preserve `withTenantTransaction` + server authorization), `application/*` 1-per-use-case, `infrastructure/*` cohesion splits, `domain/*` internal-only extraction.
- Forbidden (postpone): `src/app/*`, UI/components/features, shared UI hooks/utils/types, broad barrels.

### Requirement 3: Incremental delivery
- Strangler + temporary re-exports when public surface changes.
- PRs <= 250 lines preferred, chained if >400. 1 cohesive change/commit.
- Map first (CodeGraph + explore if >=4 files). 1 low-risk candidate first.

### Requirement 4: Verification
- `tsc --noEmit`, ESLint, affected tests green, build passes per PR.
- Critical flows: light smoke on medium/high blast radius.

## 3. Scenarios
### Scenario 1: Split actions by use-case
Given actions.ts grows large, When extracted into cohesive use-case files, Then same Server Actions remain callable and tenant/authorization unchanged.

### Scenario 2: 1-per-file use cases
Given a monolithic use-case file, When split by operation, Then behavior identical, imports updated, re-exports added if needed.

### Scenario 3: Domain internal extraction
Given domain file with helpers, When extracting internal helpers, Then domain remains pure (no framework deps), no logic changes.

## 4. Acceptance criteria
- No behavior diffs introduced by moves (structure-only).
- Imports updated, no circulars, types pass.
- CI green per small PR.
- OpenSpec proposal+spec committed before implementation.
