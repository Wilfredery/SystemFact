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
