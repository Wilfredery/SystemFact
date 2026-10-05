# Changelog

## [0.11.29](https://github.com/Wilfredery/SystemFact/compare/v0.11.28...v0.11.29) (2026-10-05)

### Bug Fixes

* **eslint:** enforce tenant wrapper on split server action files ([#84](https://github.com/Wilfredery/SystemFact/pull/84)) ([d80bd3f](https://github.com/Wilfredery/SystemFact/commit/d80bd3fbcf0374092da9f6be05491af0ee52d9c1))

### Code Refactoring

* **http:** split inventario and categoria actions into lectura/escritura with shared helpers (slices 1, 2a) ([#84](https://github.com/Wilfredery/SystemFact/pull/84)) ([3c7c63f](https://github.com/Wilfredery/SystemFact/commit/3c7c63f048a1cd8d581765dca7d3ceed098f9cbc))

## [0.11.28](https://github.com/Wilfredery/SystemFact/compare/v0.11.27...v0.11.28) (2026-10-02)

### Code Refactoring

* **http:** split backend-pure Server Actions (auth, devolucion) into operation/shared files with barrel re-exports; behavior preserved. Fix Next.js build by making shared helpers async under Server Actions context. tsc --noEmit OK, production build OK.
## [0.11.27](https://github.com/Wilfredery/SystemFact/compare/v0.11.26...v0.11.27) (2026-10-01)

### Bug Fixes

* **auth:** close run-2 security audit finding `v2r-01` MEDIUM (ADR-014 binding hardening) -- the per-request identity no longer trusts the mutable synthetic email. `getCurrentTenantContext`, `getCurrentUser` and `resolverUsuarioDeSesion` previously decoded `nombreUsuario` back OUT of the JWT email and looked `USUARIO` up by it; because an Auth admin can change a user's email, whoever controls that attribute controlled which `USUARIO` row (and therefore which `empresa`) a request resolved to. Resolution is now keyed on the immutable Auth `sub`: bound lazily on first login by `enlazarAuthSub` (compare-and-set, idempotent, refuses both conflict directions without overwriting, translates the `P2002` violation to `AUTH_ENLACE_DUPLICADO`). `normalizarAuthSub` (pure, `auth/domain`) validates the claim is a canonical UUID before any query reaches Postgres, so a malformed claim returns `null` instead of surfacing as an opaque cast error. The synthetic email now survives only as the login-flow bootstrap, and even there it is not email-trusting: `buscarUsuarioPorNombreUsuario` receives `nombreUsuario` as an already-validated argument rather than decoding it from the session. Also removes `decodeNombreUsuario` -- the synthetic email is now built but never parsed -- and updates the module README to match the `sub`-keyed identity model. **Error taxonomy by inspection:** an absent row and a cross-tenant row are INDISTINGUISHABLE by construction (the `empresaId` filter plus RLS make both invisible), and that indistinguishability IS the defense, so both map to the single tenant-blind code `AUTH_ENLACE_NO_RESUELTO`; a row already held by a concurrent login under a different `sub` is NOT distinguishable from the different-`sub` case and stays `AUTH_ENLACE_CONFLICTO`. **`enlazarAuthSub` pins `app.current_empresa_id`** to the anchor's company before its UPDATE because the `usuario_modify` RLS policy does NOT honor `app.is_login_flow` (only `usuario_select` does), which is what makes the bind RLS-authorized for the pinned company alone. **Operational notes:** every session issued before this deploy is asked to log in exactly once (the binding is written at that login); this is not worked around with a silent email fallback, which is precisely the vulnerability being removed. A stale-session user who logs out BEFORE that re-login resolves no identity, so that single LOGOUT writes no audit row -- a transient, self-closing gap inside an already transient window, not a behavioural regression. Verified `tsc --noEmit` exit 0, lint 0 errors, `prisma validate` clean, 119/119 suites and 1154/1154 unit tests green (including the new `auth-sub`, `errors` and `auth-identity` suites, which assert the `REQ-AUTH-AUD-001` audit contract and the exact `app.current_empresa_id` GUC pin on the auth write path); CI applies the migration with `prisma migrate deploy` against real Postgres 16 before the integration suite.