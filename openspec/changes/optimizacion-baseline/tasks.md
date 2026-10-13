# Tasks: optimizacion-baseline — server-side pagination & deduplication cycle

Store: **hybrid** — this file + Engram `sdd/optimizacion-baseline/tasks` (type `architecture`).
Dependencies: `proposal.md`, 9 delta specs under `specs/`, `design.md` (D1–D8, ORDER-BY pins, 12-site audit map, validation checklist design.md:359–373, 9 carried risks design.md:391–401).

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines total | ~820–1230L across 5 PRs (per-slice below) |
| 400-line budget risk | Medium (no single slice breaches 400; PR3 at 200–300L is the widest) |
| Chained PRs recommended | Yes — the proposal already resolves 5 chained slices |
| Suggested split | PR1 M1+M3 → PR2 H1 → PR3 H2 → PR4 M2+M4 → PR5 M5 (each merges to `master` with its own version bump) |
| Delivery strategy | stacked-to-main (imposed by the per-PR version-bump convention: each slice merges to `master` and carries its own `vX.Y.Z` tag) |
| Chain strategy | stacked-to-main |
| Any PR risking 400 lines | No — largest slice (PR3) targets ≤300L; budget-risks only if order-pin integration tests feed each other's fixtures (keep suites scoped per slice) |

```text
Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: Medium
```

`Decision needed before apply: No` — the 5-slice stacked-to-main plan is already resolved in `proposal.md` (Approach table) and the per-PR bump convention makes every other chain strategy unworkable (release tags follow each PR to `master`). Orchestrator's Review Workload Guard still gates each slice start.

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | M1 batched inventory ownership guard + M3 shared pagination helper absorbed | PR1 | `pnpm test -- inventario --run` then `pnpm test -- pagination --run` | Jest (unit) + Postgres 16 integration (RLS GUCs via `withTenantTransaction`) | revert PR1 merge commit: guard reverts to per-product `findFirst`, helper callers revert to local copies |
| 2 | H1 CxC board server-side pagination (R-C9) | PR2 | `pnpm test -- saldo-cxc --run` + `pnpm test -- cobros --run` | Postgres 16 (RLS, `systemfact_app`) + Playwright board screen (secrets-gated) | revert PR2 merge commit; PR1's helper stays valid |
| 3 | H2 aging + rentabilidad + estadoFacturas data-layer cuts (FIN-6/OP-6/REN-4) | PR3 | `pnpm test -- reportes --run` and `pnpm test -- aging --run` | Postgres 16 (order-pin page-walk, 500+ aging fixtures) | revert PR3 merge commit; exports and full-read paths untouched locals proof |
| 4 | M2 audit-writer consolidation (12 sites) + M4 product-listing dedupe | PR4 | `pnpm test -- auditoria --run` and `pnpm test -- producto --run` | Postgres 16 (recording-tx replay + in-tx window integration) | revert PR4 merge commit: per-site appends resume; no audit-semantic corruption |
| 5 | M5 shared ConfiguracionEmpresa active-window reader seam | PR5 | `pnpm test -- config --run` and `pnpm test -- venta-config --run` | Postgres 16 (4 modules' existing suites unchanged) | revert PR5 merge commit; readers re-inline the predicate |

Per-slice size forecast: PR1 ~150–230L · PR2 ~180–260L · PR3 ~200–300L · PR4 ~180–260L (M2 net-negative: deletions ≥ additions) · PR5 ~110–180L.

### Version-bump classification per slice (AGENTS.md semver, pre-1.0: `feat`→MINOR, `fix`/`perf`/`refactor`→PATCH)

| PR | Dominant unit type | Bump | Reasoning |
|----|--------------------|------|-----------|
| PR1 | `refactor` | **PATCH** | Pure refactor: N+1 root-cause fix + helper absorption with zero behavior change. |
| PR2 | `feat` | **MINOR** | New observable server behavior: the board action gains a paging contract (`page`/`pageSize`/metadata) and the accepted UI change (page-scoped bucket counts, risk #3) is a product-facing behavior change — not a pure perf optimization. |
| PR3 | `feat` | **MINOR** | Same class as PR2: three report screens gain server-computed paging; order-pinned, but page/service surface changes (grid ORDER BY added per D2). |
| PR4 | `fix` | **PATCH** | Corrective: M2 is mechanical refactor, M4 fixes the per-render audit-row inflation defect per RESOLVED owner decision (REQ-PROD-010); `fix` carries the PR because the payload contract change (`{count: total}`) is remediation, not capability. |
| PR5 | `refactor` | **PATCH** | Deduplication seam; all behavior unchanged (existing suites pass unchanged). |

Each bump is its own conventional commit and the FINAL task of its slice: edit `app/package.json` + `.release-please-manifest.json` + `app/CHANGELOG.md` with BOM-free writes only.

---

## PR1 — M1 batched ownership guard + M3 shared pagination contract (`refactor` → PATCH)

Rules for every slice: each task = one coherent work unit = one commit (code + its tests); branch `feature/optimizacion-pr1-pagination-baseline`; no task alone implements 300+ lines; versioning files are written byte-verified BOM-free (risk #9).

Carried risks enforced in this slice: **#9 BOM-free writes** (all three files), **order-pin discipline deferred to PR2/PR3** (helper ships with unit clamp matrix now), **ADR-017 untouched** (PR1 diff must not touch `saldo-cxc.repository.ts`).

- [x] 1.1 RED-then-GREEN unit test (colocated `app/src/shared/domain/pagination.test.ts` — the repo convention is colocated `src/**/*.test.ts`, not a separate `app/tests/` root; deviation recorded in apply-progress): pins the full normalize/clamp matrix — `normalizarTamanoPagina(0)→25`, `(25)→25`, `(250)→100`, `normalizarPagina(0)→1`, `(-1)→1`, `(2.7)→2`; `calcularOffset(page,pageSize)`; `calcularTotalPages(0,25)→0` (audited semantics, not min-1), `(70,25)→3`; for the asserted API exactly as design D3. Pure module — no DB, no imports of Next/React/Prisma/Supabase (R-QC-07).
- [x] 1.2 Create `app/src/shared/domain/pagination.ts`: constants `TAMANO_PAGINA_POR_DEFECTO=25`, `TAMANO_PAGINA_MAXIMO=100` + the 4 functions from D3, signatures over `(page, pageSize)` numbers only, no delegating wrappers, no exported types (R-QC-07; D3).
- [x] 1.3 M1 integration test (new `app/src/integration/inventario-guard-batched.integration.test.ts`): 40-product listing-guard batch executes exactly ONE ownership `findMany` and ZERO ownership `findFirst` (assertion via a call-recording tx lens on `tx.producto`); foreign-tenant id denies by default naming ONLY the missing id, no foreign data leaked, zero writes (R-INV-B1 scenarios 1–2).
- [x] 1.4 Rewrite `app/src/modules/inventario/infrastructure/inventario-repository.ts` `guardarPertenenciaProductosEnTx` (L172–182): one batched tenant query (`where: {ids, empresaId}`) + pure set-difference naming the missing ids; deny-first rule preserved; branch GUC untouched; **FOR UPDATE lock loops must show zero diff** (locking invariant; R-INV-B1). Tests from 1.3 green; all existing ownership suites pass unchanged (scenario 3).
- [x] 1.5 Absorb `auditoria/domain/auditoria.ts:69,71,137–234` local pagination helpers into shared imports; keep its min-1 `totalPages` UI-shape composition where the audited variant differs (D3 note; AU-4). Delete local copies — grep must count 0 afterward.  ← ABSORBED by PR2 (commit 6c102c9): local caps/normalizers/object-shape `calcularOffset` deleted; call sites import the shared contract; uniform clamp fold-to-25 documented (transport-blind, audit zod already rejects sizes < 1).
- [x] 1.6 Absorb `reportes/domain/reporte-filtro.ts:91–301` pagination mutation helpers into the shared module; the local filter keeps only its domain (SD-date filter) work (R-QC-07; D3).
- [x] 1.7 Move `pagina<T>` assembler → `app/src/modules/reportes/domain/reporte-resultado.ts` (ONE reportes-local copy beside `Pagina<T>`, per D3/D7); update `application/operacional.ts:202` and `application/financiero.ts:144` to import it; delete both duplicated assemblers (fixtures-equivalence Jest test: former 2 copies → byte-equal `Pagina<T>` across `{filas,total,page,pageSize,totalPages,resumen}`).  ← ABSORBED by PR2 (commit c844f44, equivalence test `reporte-resultado.test.ts`).
- [x] 1.8 Replace `app/src/modules/cobros/ui/board.ts` `paginar<T>` with shared-helper imports; `clasificarTableroCxc` and `TAMANO_PAGINA_CXC` handling adjusted to consume the shared contract (board page cut itself stays in-memory this slice — H1 lands in PR2; R-QC-07 scope member per proposal M3).
- [x] 1.9 Guard greps green: duplicated pagination helpers = 0 in scope (`pagina<`, `calcularOffset`, `calcularTotalPages` defined only in shared/reportes-resultado); `movimientoAuditoria.create` count untouched (PR1 must not touch audit paths); `FOR UPDATE` diff in inventario-repository = none.  ← FULLY GREEN after PR2: auditoria.ts copies (1.5) and the `pagina<T>` dups (1.7) absorbed; final grep evidence recorded in PR #114's description.
- [x] 1.10 Slice verification (adapted): `pnpm exec prisma validate` · `pnpm lint` (0 errors) · `pnpm exec tsc --noEmit` · `pnpm test -i` (full unit: 123 suites/1204 tests) · inventario + guard-consumer + auditoria integration suites on Postgres 16 (14 suites/71 tests) · commit sequence 7 conventional commits (not the original 8 — the narrowed slice + two review-fixup commits).
- [x] 1.11 Version bump commit `chore: bump version 0.14.8 PATCH` — edit `app/package.json`, `.release-please-manifest.json`, `app/CHANGELOG.md` (PR1 changelog entry: `refactor`-class notes; BOM verified: `bytes[0] -ne 0xEF` after write).

**PR1 rollback boundary**: `git revert` of the PR1 merge commit — no other slice's state changed; no schema/data touched.

---

## PR2 — H1 CxC board server-side pagination (`feat` → MINOR)

Branch `feature/optimizacion-pr2-cxc-board-paging`, based on post-PR1 master. Depends on PR1's shared helper (soft).

Carried risks enforced here: **risk #1** (ORDER-BY pin red→green shipped with the diff), **risk #3** (page-scoped buckets stated in PR description), **risk #4** (PAGADA boundary SQL parity test), **ADR-017 byte-identical** (invariant scenario).

- [x] 2.1 RED order-pin + clamp tests (`cobros` integration): 70 VIGENTE outstanding fixtures → page 1 default (25 rows + total 70 + typed metadata); pageSize 250 → 100; page-walk pages 1..3 at pageSize 25 and 100 with commit-order-newest-first identical sequences, no overlap/gap (R-C9 scenarios 1–3).
- [x] 2.2 RED boundary test (risk #4): PAGADA threshold parity — Decimal fixtures `applied = total`, `applied = total - 0.01`, `applied = 0`, `applied > total` (debit-note re-inflation) upstream of `clasificarEstadoPago` vs the SQL outstanding predicate (design D4's one re-encoded threshold).
- [x] 2.3 Extend `app/src/modules/cobros/infrastructure/saldo-cxc.repository.ts` `consultarSaldoCxcEnTx` with optional page tail `{page, pageSize}` using `limitePaginaSql` for OFFSET/LIMIT; **canonical aggregate block (L46–93) byte-identical — outer wrapper re-applies `ORDER BY "fechaEmision" DESC, "id" DESC` itself, never trusting inner order** (D1/D2). Add `contarSaldoCxcEnTx(tooling)` returning `{total, pendientes}` via COUNT over the same wrapper.
- [x] 2.4 Update `app/src/modules/cobros/application/consultar-saldo-cxc.ts`: use case gains `{page?, pageSize?, now?}`, calls shared playbook `normalizarPagina`/`normalizarTamanoPagina` before data access; page-wide derived facts computed purely (`clasificarEstadoPago`, `enMora`, `dueDate`) on PAGE rows only; batched client-terms read narrowed to the page's distinct clients (R-C9).
- [x] 2.5 Thin server action in `app/src/modules/cobros/http/actions.lectura.ts` (+ `actions.ts`): `consultarSaldoCxcAction({page?, pageSize?})` with typed metadata return `{filas, total, page, pageSize, totalPages}` / stable error code; zero business logic in the adapter (D4).
- [x] 2.6 Update `app/src/modules/cobros/ui/board.ts` + `app/src/modules/cobros/ui/CxcBoardScreen.tsx`: screen consumes server pages; buckets classified client-side per page with `clasificarTableroCxc`; page navigation controls honor `totalPages`; **remove nothing else — PR description MUST state the accepted page-scoped-bucket-count behavior change** (risk #3, D4's UI consequence).
- [x] 2.7 ADR-017 guard: grep-diff the canonical aggregate block between baseline commit and the worked tree — zero char diff; keep the diff artifact in the PR description (invariant scenario of the cobros delta).
- [x] 2.8 Slice verification: `pnpm exec prisma validate` · `pnpm lint` · `pnpm exec tsc --noEmit` · `pnpm test -- --run` on the cobros suites changed by 2.1–2.2; cobros integration suite on Postgres 16; Playwright board flow only if `E2E_USER`/`E2E_PASSWORD`/`NEXT_PUBLIC_SUPABASE_*` secrets exist (else notice-skip per CI contract).
- [x] 2.9 Version bump commit `chore: bump version 0.x.y+1 MINOR` — `chore(release)` classified knowing the PR computes as `feat` (MINOR bumped by the PR's dominant unit, files written BOM-free).

**PR2 rollback boundary**: `git revert` PR2 merge — restores fetch-everything-then-fill-in-memory board; PR1/PR3 unaffected (module-local to cobros serving).

---

## PR3 — H2 reportes data-layer cuts: aging + rentabilidad + estadoFacturas (`feat` → MINOR)

Branch `feature/optimizacion-pr3-reportes-pagination`, based on post-PR2 master (89ebb5b, task file said `-paging` — the orchestrator-dispatched name wins). Depends on PR1's shared helpers. PR3 DONE: commits 2ea432a (aging FIN-6) / 3a25255 (rentabilidad REN-4) / 5f9e828 (estadoFacturas OP-6) / 3ce00c6 (bump 0.14.10); PR opened for review.

Carried risks enforced here: **risk #1** (three ORDER-BY pins red→green), **risk #2** (if any tenant-workload fixture approaches tens of thousands of rows on these OFFSET plans, STOP and re-open D1 with the orchestrator), **risk #7** (estadoFacturas summary keeps its second bounded full-grid read — document, don't engineer).

- [x] 3.1 RED domain unit test pinning the aging translation (design D2 computed-field case): SQL-mirrored evaluation of `diasVencidoEnSD` over boundary fixtures (due today → 0, 1 SD day past 23:59:59 SD, 30/31/60/61 crosses) and the bucket `CASE` vs `clasificarBucketAging` for day counts 0..400 (FIN-6 order pin red first).  ← `aging-sql-pin.test.ts` (2 tests green by construction — the D2 mirror contract; the behavioral RED evidence is in the integration suite: `consultarSaldoCxcAgingEnTx`/`resumirAgingSqlEnTx` undefined pre-implementation → 2 failing tests).
- [x] 3.2 Add paged aging queries in `app/src/modules/cobros/infrastructure/saldo-cxc.repository.ts` (new, do NOT touch the canonical block): `consultarSaldoCxcAgingEnTx` — canonical fragment + CLIENTE plazo join + `dbPlazo` bind + SD `AT TIME ZONE` day expression + `ORDER BY "diasVencido" DESC, "saldoPendiente"::numeric DESC, "facturaId" ASC` + page tail; `resumirAgingSqlEnTx` bucket-summary aggregate (D2/D5 contract).  ← commit 2ea432a; canonical `consultarSaldoCxcEnTx` block grep-verified byte-identical vs 89ebb5b (whitespace-insensitive, len 1280).
- [x] 3.3 Update `app/src/modules/reportes/application/cxc-aging.ts` `consultarCxcAging`: stop calling `leerCxcAgingCompleto` + `slice` (L152–155); page pure-mapped via `construirFilaAging` on PAGE rows; `leerCxcAgingCompleto` kept **un-paged** for the CSV export path (exports unbounded; FIN-6 export scenario).  ← commit 2ea432a; scope/gate factored into `conPermisoAging` shared by both paths; `pagina()` assembler reused; total = summary's `facturasAbiertas` (whole-window metadata).
- [x] 3.4 Rentabilidad: `app/src/modules/reportes/infrastructure/rentabilidad-repository.ts` gains `limitePaginaSql` page tail on `rentabilidadFilasEnTx` (keeps `ORDER BY p."id" ASC`) + new `contarRentabilidadFilasEnTx` (COUNT over the same CTE-filtered join); `app/src/modules/reportes/application/rentabilidad.ts:96–98` slice dropped; full read for CSV (`leerRentabilidadCompleta`) untouched (REN-4; order pin red→green via page-walk test pages 1..5).  ← commit 3a25255; ONE `WITH`/universe definition shared by page+count; summary keeps `resumirRentabilidad` over the same un-paged grouped read the CSV reuses (risk-#7 sibling, documented); `paginacionDe` exported from operacional.ts as the shared page-window derivation.
- [x] 3.5 estadoFacturas: `app/src/modules/reportes/infrastructure/operacional-repository.ts` `estadoFacturasGridEnTx` gains `Paginacion`-tail + explicit `ORDER BY estado, tipoNcf` (the one added-order change, D2) + `app/src/modules/reportes/application/operacional.ts:177–178` slice dropped; summary keeps its own full-grid read (≤6 cells, risk #7 documented).  ← commit 5f9e828; DEVIATION: both columns are frozen Postgres ENUMs, so the observable pin is the ENUM DECLARATION order (VIGENTE→CANCELADA→ANULADA; B01→B02), not alphabetical wording — stronger (migration-locked) and byte-identical to the pre-slice implicit order. No new ORDER text needed beyond pinning the existing one in the test.
- [x] 3.6 Aging integration suite: 500+ fixtures seeded with cross-boundary emission/pattern dates; SQL-vs-domain bucket parity; ADR-017 balance probe on paged rows (`saldoPendiente` == canonical by id); integration order-pin page-walk pages 1..3 (FIN-6/OP-6/REN-4 integration scenarios — risk #1 carried).  ← `aging-paginado.integration.test.ts` (4 tests, 516 fixtures): walk pages 1..3 @25 byte-equal prefix + full @100 walk equal to the domain order; SQL `diasVencido` == `diasVencidoEnSD` per served row; `resumirAgingSqlEnTx` == `resumirAging` full-set; export stays unbounded with a pageSize-1 filter (30 CSV detail rows).
- [x] 3.7 Export-path guard greps: no paging import in `exportar*` paths (`reportes-export`/`reportes-fiscales` untouched); `leerCxcAgingCompleto`/`leerRentabilidadCompleta` full-set reads still untouched; canonical ADR-017 block grep-diff still zero.  ← `git diff origin/master -- exportar*` EMPTY; `reportes-fiscales` dir not in the diff; both full-read exports present unchanged; ADR-017 identical: True; audit-site files diff EMPTY, `movimientoAuditoria.create` per-file counts == master.
- [x] 3.8 Slice verification: `pnpm exec prisma validate` · `pnpm lint` · `pnpm exec tsc --noEmit` · `pnpm test -- --run` targeted greps `aging|rentabilidad|operacional` · integrations on Postgres 16 (RLS).  ← ALL GREEN: prisma valid; lint 0 errors (16 PRE-EXISTING baseline warnings); tsc 0; unit battery 125 suites/1208 tests; FULL integration battery 49 suites/227 tests (aging-paginado 4, rentabilidad REN-4 9/9, operativos OP-6 10/10, financieros 10/10, cobros saldo suites unchanged green).
- [x] 3.9 Version bump commit `chore: bump version 0.x.y+1 MINOR` (feat-class PR — BOM-free files, changelog entry notes the grid ORDER BY addition per D2).  ← commit 3ce00c6 `chore: bump version 0.14.10 MINOR` as the FINAL commit; `bytes[0]` ∈ {123, 123, 35} (no BOM), LF endings verified (CRLF=0 in all three).

**PR3 rollback boundary**: `git revert` PR3 merge — three use cases revert to in-memory slices; PR1 helpers remain imported (no cross-slice state).

---

## PR4 — M2 audit-writer consolidation + M4 product-listing dedupe (`fix` → PATCH)

Branch `feature/optimizacion-pr4-audit-consolidation`, based on post-PR3 master (1377961). Net-negative LOC target for M2. PR4 DONE: commits 72f371e / 83803be / 001c771 / 00177f5 (M2 groups), ff847c3 (M4), c2a4e2d (integration), 018d170 (lint pin fix), bump 0.14.11 as the final commit; PR opened for review.

Carried risks enforced here: **risk #5** (`AccionAuditoria` import-source per site), **risk #6** (payload contract `{count: total}` + signature `count` param drop changelog'd), no-mutation path invariant.

- [x] 4.1 RED replay fixtures: for EACH of the 12 sites (map in design D5), a record/replay unit test — old body on a recording tx vs new delegate on the same recording, asserting byte-equal EVERY field (`accion`, `entidad`, `idEntidad`, `motivo`, `valorAnterior`, `valorNuevo`, `sucursalId`; `fechaHora` type-only). Test fails (the target) before any site is migrated; RED list enumerates all 12.  ← `registrar-sites-consolidation.test.ts` (spy on the write-port + recording tx). RED observed pre-migration: 6 failed / 6 (delegation = 0 calls before any migration; payload pins resolve green through the delegation after each group). All 12 sites enumerated across the group describes; site 4 `registrarAuditoriaStockEnTx` exported solely for the pin (call sites stay private).
- [x] 4.2 Per-site **AccionAuditoria import-source check ticks** (risk #5): for sites 1–12 in the D5 map, record in each task whether the site uses the domain enum (`Journal` inversion) or a local mirror; local mirrors map at the builder. Sites: `devolucion-repository.ts:268`, `venta-repository.ts:877+1081`, `inventario-repository.ts:202`, `compra-repository.ts:709`, `categoria-repository.ts:245`, `cliente-repository.ts:395`, `proveedor-repository.ts:308`, `producto-repository.ts:362/394/425/451`.  ← ALL 12 verify: every site imports the PRISMA-generated enum from `@/generated/prisma/client` (no local mirrors found). Delegation passes the site's existing enum member/param verbatim — identical string-literal unions (structurally assignable, tsc-checked drift), canonical writer normalizes via `PRISMA_ACCION` (identity map, byte-identity holds; pinned by the replay test).
- [x] 4.3 Migrate site bodies (design D5 mapping table verbatim): each of the 12 named helpers KEEPS its signature; body becomes `registrarEventoAuditoriaEnTx(tx, ctx, event)` swallowing the D5 event mapping; canonical writer and `auditoria-write-port` re-export unchanged; commit granularity: one commit per 2–3 related sites to keep review small.  ← 4 commits: 72f371e (devolucion+venta 1-3), 83803be (inventario+compra 4-5), 001c771 (categoria+cliente+proveedor 6-8), 00177f5 (producto 9-11; site 12 rides the M4 commit ff847c3). All bodies delegate via `auditoria-write-port` (the ratified public seam); canonical writer byte-untouched.
- [x] 4.4 M4: `app/src/modules/producto/application/listar-productos.ts:50` passes the READ'S filtered `total` (not `items.length`) — no other change; `registrarProductoListadoEnTx` gains the D6 window check inside the caller's tx (bounded `findFirst` on `{empresaId, usuarioId, LEER, Producto, fechaHora >= Date.now()-60000}`, deterministic order, distinct-actor boundary test). No schema, no lock, race tolerance of one extra accepted/documented (REQ-PROD-010-B/C/D).  ← commit ff847c3; signature `(tx, ctx, page, total, ahora?)` — `now` injectable for tests, defaults to the server clock (`new Date()`, the SAME plain-instant time source the whole codebase uses; no dedicated date provider exists to reuse). UTC instant comparison; race acceptance documented in the helper docblock + PR body; `corteVentanaProductoListado` pure helper exported for the boundary unit tests.
- [x] 4.5 M4-adjacent behavior tests (risk #6): fresh actor → append; row <60s → skip, NO retro-merge (nothing ever touches the open row); 60.1s boundary sets a fresh window; different actor within window → still appends; injected-`now` determinism; migration of prior unit tests that asserted `count: items` payload.  ← `producto-listado-dedupe.test.ts` 6/6 (cut math, fresh actor append + full row shape, in-window skip, 60s just-inside/just-outside boundary, bounded-read predicate pin); `listar-productos.test.ts` needed NO migration (it stubs the helper, asserts call count only). Different-actor + boundary-fresh-window + payload semantics = integration green (below).
- [x] 4.6 Integration + no-mutation invariant: canonical writer round-trip (rows byte-identical; append-only constraint still matches zero rows for any UPDATE attempt on `MOVIMIENTO_AUDITORIA`); M4 in-tx semantics (listing rollback aborts the audit row — showing 'same-tx' behavior).  ← `auditoria-listed-dedupe.integration.test.ts` 6/6 on Postgres 16 (RLS): first listing appends ONE row with `count=2` (filtered total, limit-1 page proves count≠items.length); same-actor second listing appends 0 and the open row is untouched; different actor appends his own row/count; PROD-010-A created row byte-identical; same-tx rollback aborts the audit row; the UPDATE probe REVEALED the ledger is stronger than RLS: the `AUDITORIA_INMUTABLE` trigger rejects UPDATE loud — asserted, row payload unchanged.
- [x] 4.7 Guard greps green: `movimientoAuditoria.create` occurrences OUTSIDE `registrar-evento.repository.ts` = 0; no UPDATE/DELETE on audit rows anywhere; diffstat check M2: deletions ≥ additions.  ← create outside canonical writer: app source = 0 (only the canonical plus the generated client); movimientoAuditoria.update* = 0 in app source (unchanged pre-existing integration RLS probe + generated client only); AFTER UPDATE/DELETE search empty; M2 site-repository numstat: 14/15/16/13/14/15/15/30 deletions vs 9/9/10/8/12/9/9/17 additions (net −53 across the 8 site repos for M2; whole-file net incl. M4 −27); `inventario-repository.ts` FOR-UPDATE block diff EMPTY (grep over its diff=0 matches); ADR-017/canonical writer untouched.
- [x] 4.8 Slice verification: `pnpm exec prisma validate` · `pnpm lint` · `pnpm exec tsc --noEmit` · `pnpm test -- --run` targeted `auditoria|producto` · Postgres 16 integration suite.  ← ALL GREEN: prisma valid + schema valid; tsc 0 errors; lint 0 errors + 16 pre-existing warnings (baseline restored); FULL unit battery 127 suites/1221 tests; FULL integration battery 50 suites/233 tests (was 49/227 post-PR3; +1 suite +6 tests = the M4/M2 integration suite); `pnpm lint:commits` OK 7 commits.
- [x] 4.9 Version bump commit `chore: bump version 0.x.y+1 PATCH` — changelog entry carries a **NOTES** block flagging the `registrarProductoListadoEnTx` signature change (`count` param dropped; `valorNuevo` now `{count: total}`) per risk #6.  ← this commit `chore: bump version 0.14.11 PATCH` (fix-class PR; BOM-free `[IO.File]` writes, bytes[0] ∈ {123,123,35}; tasks.md checkboxes carried per PR2/PR3 precedent).

**PR4 rollback boundary**: `git revert` PR4 merge — per-site appends resume (audit growth resumes; zero audit-semantic corruption; symbol count of appends returns to pre-fix behavior).

---

## PR5 — M5 shared ConfiguracionEmpresa active-window reader seam (`refactor` → PATCH)

Branch `feature/optimizacion-pr5-config-seam`, based on post-PR4 master. LAST slice — it touches 4 modules' read seams after everything settles.

Carried risks enforced here: **risk #8** (the seam compares timestamptz INSTANTS — behavior-unchanged beats the literal "resolved in SD" paragraph; SD resolution inherited from callers' ratified conversions `domain/zona-horaria.ts` / `reporte-filtro.ts` en-CA parts).

- [ ] 5.1 Create `app/src/shared/infrastructure/configuracion-empresa.ts` (D8 contract verbatim): `FilaConfigEmpresa {clave, valor}`; `leerConfigActivaEnTx` (findFirst + newest-`vigenciaInicio` tie-break, R-V17) and `leerConfigsActivasEnTx` (findMany multi-key, compra's shape); predicate = `{empresaId, clave, activa: true, vigenciaInicio: {lte: fecha}, vigenciaFin: {gte: fecha}}` absolute-instant comparison — NO SD conversion inside the seam; value-grammar validation stays in each consumer module (R-QC-08).
- [ ] 5.2 Unit + integration test pinning the seam itself: overlapping windows resolve to the newest `vigenciaInicio`; expired/absent row → `null` out of `leerConfigActivaEnTx`; batched multi-key shape returns all found rows (R-QC-08's one-implementation scenario backed by tests, not just grep).
- [ ] 5.3 `app/src/modules/venta/infrastructure/config-repository.ts`: 3 singles (DESC_MAX / PLAZO_DEVOLUCION / RETROACTIVO_FECHA_VENTA_DIAS) consume `leerConfigActivaEnTx` from their callers' tx; `VentaConfigError` hard-fail semantics on missing/invalid unchanged (R-C4; existing suites pass unchanged).
- [ ] 5.4 `app/src/modules/compra/infrastructure/configuracion-repository.ts` `leerTasasRetencionEnTx`: 4-key findMany → `leerConfigsActivasEnTx`; map-by-clave outcome identical (overlap-free per-key seed guarantee holds; R-V17); missing required key still raises `CONFIG_RETENCION_FALTANTE`.
- [ ] 5.5 `app/src/modules/reportes/infrastructure/config-repository.ts` (PLAZO_CREDITO, single, `null` on gap) → seam; `app/src/modules/reportes/infrastructure/dgii-config-repository.ts` (UMBRAL_CONSUMO_607, DGII_TIPO_INGRESO_607, statutory-default fallback) → seam; fallback semantics unchanged (R-QC-08).
- [ ] 5.6 Grep guard: exactly ONE canonical predicate implementation (`activa: true` window predicate encoded only in `shared/infrastructure/configuracion-empresa.ts`); 4 consumer files import it and none re-encode.
- [ ] 5.7 Slice verification: `pnpm exec prisma validate` · `pnpm lint` · `pnpm exec tsc --noEmit` · `pnpm test -- --run` targeted `venta-config|config|retencion` · the 4 modules' existing integration suites pass UNCHANGED on Postgres 16.
- [ ] 5.8 Version bump commit `chore: bump version 0.x.y+1 PATCH` (refactor; BOM-free writes; changelog notes seam introduction).

**PR5 rollback boundary**: `git revert` PR5 merge — readers re-inline their predicates; no data changed anywhere.

---

## Slice-level verification template (every PR, adapted from the repo CI contract)

```powershell
pnpm exec prisma validate
pnpm lint
pnpm exec tsc --noEmit
pnpm test -- --run # + grep-targeted suites named by the slice
# guards:
#   PR1: duplicated pagination helpers = 0; FOR UPDATE diff = none
#   PR2/PR3: ADR-017 grep-diff zero; ORDER-BY pin tests present; export paths unpaged
#   PR4: movimientoAuditoria.create outside registrar-evento.repository.ts = 0
#   PR5: one predicate implementation; 4 importer files
# CI contract: integration against Postgres 16 (RLS, systemfact_app). E2E only if repo secrets exist.
```

## Cross-slice invariants (checked at every PR)

1. ADR-017 canonical aggregate block in `saldo-cxc.repository.ts` byte-identical vs baseline commit (PR2/PR3 explicitly; every PR verify sequence).
2. Inventory FOR UPDATE lock loops: zero diff across all 5 PRs.
3. DGII TXT/CSV export paths: zero paging import anywhere in the cycle.
4. Append-only audit: no UPDATE/DELETE path introduced by any slice (asserted in PR4 but structurally valid per slice).
5. Every PR green on CI gate + own conventional-commit-bump; squash-merge with `Merge pull request` avoided per the release-please documented merge rule (though releases are manual now, keep the merge convention).

## review_policy

400 lines per PR; above that register maintainer-approved size:exception.
