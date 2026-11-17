# CSP reporting leftovers + mechanical version-bump guard

Owner decision (2026-11-16): "Focus on 2,4... The rest we're not available and in this version
we're not doing it." Items 1 (T8 MFA), 3 (Pro-gated security) and 5 (card payments) are OUT.

## Specs

- **S1 (CSP reporting endpoint)** — a violation-reporting endpoint exists and the enforced policy
  reports to it, closing the csp-nonce.md gap "no violation-reporting endpoint". POST-only, non-tenant
  (reachable pre-auth like login), validates the report shape, writes NOTHING to the database
  (CSP reports are an observability signal, not audit data; the audit log is append-only tenant data),
  and surfaces violations as structured server logs (visible in Vercel logs). 204 No Content both ways
  (browsers ignore the body); malformed/oversized bodies must not crash or log unbounded.
- **S2 (prod smoke page coverage)** — the production session smoke visits EVERY authenticated page
  under `(app)` read-only, closing the csp-nonce.md gap "the 7 other authenticated pages are not
  covered by the production smoke". Hard rules preserved: NO fiscal writes, no NCF consumption, no
  voids, no mutating action POSTs; the least-privilege Operador identity stays; deny-by-default pages
  assert the access message (an Operador seeing restricted data is a security failure); the
  no-skip rule (`assert-no-skips.mjs`-style) and the existing CSP violation watcher stay binding.
- **S3 (version-bump guard)** — a mechanical CI check, per AGENTS.md (2026-11-04 amendment):
  "a step that fails when a non-exempt path changed and the three version files did not". Exempt:
  `docs/**`, `odd/**`, `**/*.md`, `README*`, `LICENSE*`, `**/*.test.ts`, `**/*.test.tsx`,
  `**/*.spec.ts`, `**/*.spec.tsx`, `app/tools/**`. Version files: `app/package.json`,
  `.release-please-manifest.json`, `app/CHANGELOG.md`. Applies to PRs targeting `master`; runs as
  part of the aggregate `CI gate`. Non-failure of an exempt-only PR must be provable by test.
- **S4 (policy stays intact)** — the enforced CSP keeps nonce-only scripts, `'unsafe-eval'` never
  emitted, `style-src 'unsafe-inline'` by owner decision (csp-nonce.md S2); adding reporting must
  not loosen any directive.

## Allowed edit surfaces

Worker A (T1):
`app/src/lib/security/**`
`app/src/app/api/security/**`
`app/src/proxy.ts`

Worker A2 (T2):
`app/e2e-prod/**`

Worker B (T3):
`app/tools/scripts/**`
`.github/workflows/ci.yml`
`.github/actions/**`

## Tasks

| ID | S#  | Route   | Work                                                                 |
|----|-----|---------|----------------------------------------------------------------------|
| T1 | S1,S4 | worker | `report-uri` in `buildContentSecurityPolicy` + `/api/security/csp-report` route + tests |
| T2 | S2  | worker  | session smoke covers every `(app)` page read-only                    |
| T3 | S3  | worker  | `check-version-bump.mjs` script + tests + `ci.yml` job inside `ci-gate` |
| T4 | S1-S3 | inline | work-unit commits, version bumps (both slices touch `.github/**`/`app/src/**` → bump required), two PRs |

Delivery: one PR per feature (CSP+smoke together as one CSP-feature PR; the bump guard as its own
PR). Production deploy after the CSP PR needs the owner's explicit approval naming the commit, then
`prod-smoke.yml` counts, then ONE prod-demo lane run (touches login/CSP-serving paths).

## Log (Judgment Day, T3 slice)

- Round 1 (2026-11-16), target `feature/ci-version-bump-guard` @ a82967f, blind judges A+B:
  no CRITICAL, no contradiction. INFO (both judges, later work): (a) `.test.tsx`/`.spec.tsx` are
  exempt beyond AGENTS.md's literal list while the comment claims "exactamente"; (b) diff paths are
  split+trimmed without `-z`, so git C-quoted paths could misclassify; (c) `README*`/`LICENSE*` are
  root-anchored unlike gitignore's slash-less semantics (comment misstates it). SUSPECT (single
  judge, recorded): A-MEDIUM — a PR touching only `app/package.json` runtime fields passes without
  a bump (VERSION_FILES are excluded from release-affecting paths); A-WARNING — the bump check is
  presence-only (one version file touching satisfies it); B-WARNING — the job diffs the event-pinned
  `pull_request.base.sha`, so a base that advances mid-run can false-block (the sibling `commits`
  job diffs `origin/<base_ref>` instead). Round 1 verdict: JUDGMENT: APPROVED ✅

## Log

- L1 (2026-11-16): owner picked items 2 and 4 from the open list; quoted verbatim in the header.
  T8/Pro-gated/card work explicitly not done in this version.
- L2 (2026-11-16): T3 slice committed on `feature/ci-version-bump-guard` in its own worktree
  (`C:/SystemFact-bump-guard`): 9881123 (guard + 42 node:test cases + ci.yml `version-bump` job in
  `ci-gate`) + a82967f (bump 0.35.1 -> 0.35.2, changelog entry; guard run on its own PR: exit 0).
  Native RDD review consent declined (owner: no model available in RDD), so the slice goes through
  Judgment Day blind dual review (judges A/B) instead, per the skill's standalone contract.
- L4 (2026-11-16): T2 done by the second worker on the shared worktree:
  `app/e2e-prod/session-smoke.spec.ts` now walks all 18 `(app)` routes read-only from a declarative
  PAGES table, with a filesystem coverage test that fails when a new page ships uncovered; dynamic
  cobros routes use sentinel ids only. Verified on the local lane: 4 passed / 1 failed — the
  failure is the pre-existing Secure-cookie assertion, environmental to the http local stack.
  **Local stack note:** the worker reset `systemfact_app` and `e2e-operador` passwords to run the
  lane, so the local e2e stack env file no longer matches — re-provision (wipe first) before the
  next local lane run. Lint + tsc clean; the no-skips guard reports 0 skipped.
- L5 (2026-11-16): integration on `feature/csp-reporting`: T1 commit (CSP endpoint + report-uri),
  T2 commit (smoke coverage), then the branch was SPLIT for review-load protection (942 lines >
  ~400): PR 1 = endpoint + policy + bump 0.36.0 (feat → MINOR); PR 2 = the smoke test commit on a
  stacked branch `feature/csp-prod-smoke` (base = PR 1; spec-only → bump-exempt). Full validation:
  tsc 0 errors, eslint clean, jest 27/27 (security module). JD dual review running on PR 1's slice.
- L6 (2026-11-16): JD on the PR 1 slice (05d646d..293d339): round 1 found ONE both-judge-confirmed
  finding — a deeply nested (≈5,000 arrays, far under the 32 KB cap) report made JSON.stringify
  throw outside the logger, so the pre-auth endpoint answered 500 instead of 204. Owner chose the
  fix round. Fix commit 3e6d3f2: serializeViolation wraps the per-report stringify and degrades to
  a flat marker line (reportSerialization: failed); regression test reproduces the asymmetry by
  concatenating the wire body. Scoped re-judgment (both judges, fix delta only): clean, no
  fix-caused defects. **JUDGMENT: APPROVED ✅ (round 2).** 28/28 security-module tests, tsc 0,
  eslint clean. Suspects/info remain recorded: declared-length branch untested; no rate limit on
  log volume (per-request caps only); changelog wording vs the 20-line batch cap.
- L3 (2026-11-16): T1 implemented by worker on the shared `feature/csp-reporting` worktree
  (27/27 tests, lint clean, RED observed first): `report-uri /api/security/csp-report` added to the
  enforced policy, new bounded Edge-safe normalizer `app/src/lib/security/csp-report.ts`, POST/GET
  route, and the report path exempted from the auth gate in `proxy.ts`. Deliberate deviations:
  no `'self'` inside `report-uri` (URLs, not source expressions) and no `report-to` (would need the
  `Reporting-Endpoints` header the proxy does not advertise; a silent half-wire). Version bump owed
  at integration.
- L7 (2026-11-16): delivered. PR #243 = feature/csp-reporting (endpoint + policy + bump 0.36.0 + fix 3e6d3f2, ~570 lines; JD APPROVED round 2). PR #244 = feature/csp-prod-smoke stacked on #243 (367-line smoke coverage, bump-exempt). Both branches force-pushed with owner approval to split the 980-line slice. Prod deploy after #243 merge needs owner approval naming the commit; then prod smoke counts + ONE prod-demo lane run.
