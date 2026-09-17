# Delta: auth

**Change**: foundational-patterns-fase-1-2
**Modified capabilities**: auth

## ADDED Requirements

### REQ-AUTH-SYN-001: Synthetic email encoding

The `auth/domain/synthetic-email.ts` module SHALL export `SYNTHETIC_EMAIL_SUFFIX = '@users.systemfact.internal'` (hardcoded constant per ADR-014, NOT env var).

### REQ-AUTH-SYN-002: Build synthetic email

The module SHALL export `buildSyntheticEmail(nombreUsuario: string): string`.

**Scenarios**:

#### Scenario AUTH-SYN-002-A: valid nombreUsuario

- Given `nombreUsuario = 'jdoe'`
- When `buildSyntheticEmail('jdoe')` is called
- Then it returns `'jdoe@users.systemfact.internal'`

### REQ-AUTH-SYN-003: Decode nombreUsuario

The module SHALL export `decodeNombreUsuario(email: string): string`.

**Behavior**: throws `InvalidSyntheticEmailError` if email doesn't end with `SYNTHETIC_EMAIL_SUFFIX`.

**Scenarios**:

#### Scenario AUTH-SYN-003-A: valid synthetic email

- Given `email = 'jdoe@users.systemfact.internal'`
- When `decodeNombreUsuario(email)` is called
- Then it returns `'jdoe'`

#### Scenario AUTH-SYN-003-B: non-synthetic email

- Given `email = 'jdoe@example.com'`
- When `decodeNombreUsuario(email)` is called
- Then it throws `InvalidSyntheticEmailError`

## REMOVED Requirements

### REQ-AUTH-SYN-REMOVED-001: Previous duplication in `auth/infrastructure/auth-service.ts`

- The exported `SYNTHETIC_EMAIL_SUFFIX` constant and `buildSyntheticEmail` function are removed.
- Import is rewritten to `import { SYNTHETIC_EMAIL_SUFFIX, buildSyntheticEmail } from '@/modules/auth/domain/synthetic-email'`.

### REQ-AUTH-SYN-REMOVED-002: Previous duplication in `tenant/infrastructure/tenant-runtime.ts`

- The private `SYNTHETIC_EMAIL_SUFFIX` constant and inline decode logic are removed.
- Import is rewritten to use the same `auth/domain/synthetic-email.ts` source.

## MODIFIED Requirements

(None — this is purely a refactor for single source of truth)

# Delta for auth

## ADDED Requirements

### Requirement: Successful login and logout are audited (REQ-AUTH-AUD-001)

A fully successful login (Supabase session established AND the mapped `USUARIO` row validated active) MUST append one audit row with `accion=LOGIN`; a logout MUST append one with `accion=LOGOUT` (activating the previously unused enum values). Both rows MUST carry the authenticated user's resolved `empresaId` and `usuarioId`, `sucursalId` null (company-wide action), and a UTC `fechaHora`. Only successful sessions are audited: failed credentials and inactive-user rejections MUST NOT write audit rows (no unauthenticated noise, no enumeration side-channel in the log).

Nuance (see auditoria spec, architectural note): the LOGIN write happens on the pre-`TenantCtx` path (`app.is_login_flow`); it MUST use only the single resolved company of the authenticating user and MUST NOT widen the login-flow RLS exception.

#### Scenario: Successful login writes a LOGIN row

- GIVEN valid credentials for active user U of company E
- WHEN login completes and the session is established
- THEN exactly one audit row with `accion=LOGIN`, `empresaId=E`, `usuarioId=U`, `sucursalId=null` exists
- TEST: integration

#### Scenario: Logout writes a LOGOUT row

- GIVEN user U holds an active session
- WHEN logout completes
- THEN exactly one audit row with `accion=LOGOUT` exists for U's company
- TEST: integration

#### Scenario: Failed login writes nothing

- GIVEN invalid credentials (or a disabled `USUARIO`)
- WHEN the login attempt is rejected
- THEN no `LOGIN` audit row is written
- TEST: integration
