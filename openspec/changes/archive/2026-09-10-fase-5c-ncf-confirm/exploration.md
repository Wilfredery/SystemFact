# Exploration: fase-5c-ncf-confirm — NCF Engine + Sale Confirmation + SALIDA_VENTA

**Phase**: sdd-explore | **Store**: hybrid (file + Engram `sdd/fase-5c-ncf-confirm/explore`) | **Date**: 2026-09-10

## Exploration: fase-5c-ncf-confirm

### Current State

**Venta lifecycle (5b, merged).** `src/modules/venta/` ships draft-only: `crearVenta` / `actualizarVenta` (full line replacement) / `cancelarVenta` (`BORRADOR → CANCELADA`) / list / detail — all inside the caller's `withTenantTransaction`, guarded `updateMany` + affected-rows for idempotency (`venta-service.ts`). `CONFIRMADA` exists in the persisted enum but **has no reachable path**; the README pins an explicit "Reserved 5c seam": `BORRADOR → CONFIRMADA`, NCF consumption, `SALIDA_VENTA` hard stock block, B01/B02 eligibility, credit/mora blocking. Stock at draft save is only a structured `STOCK_INSUFICIENTE` **warning** (R-V9) — the authoritative block is designed to happen at 5c confirm inside the transaction.

**NCF schema ground truth (exists, complete on paper, ZERO code).** `NCF_SECUENCIA` exists since the init migration (20260828184924): `empresaId`, `tipoNcf` (`TipoNcfSecuencia` enum = B01/B02/B03/B04/B11), `rangoInicio`/`rangoFin` (Int), `secuenciaActual`, `vigenciaInicio`/`vigenciaFin` (timestamptz), `activa`, `@@unique([empresaId, tipoNcf])` ("secuencias por tipo y empresa; asignación con row lock"). RLS enabled + **FORCE**d with empresa-isolation policy (`20260902120000_enable_rls` L251, `20260902130000_force_rls` L39). Grep across `app/src` proves **no application code references `ncfSecuencia`** — only generated Prisma types. Comprobantes: `FACTURA` (ventaId 0..1 UK, `@@unique([empresaId, ncf])`, `tipoNcf` B01/B02, `correlativoInterno`, `estado` `VIGENTE/CANCELADA/ANULADA`, gravado/exento breakdown) and `NOTA_CREDITO`/`NOTA_DEBITO` exist with RLS policies; `grep tx.factura.create` returns nothing — **no write path for any fiscal document exists yet**. `Empresa.facturaAutomatica` (schema L192): "true: emitir NCF al confirmar venta (atómico); false: diferido (0..1)".

**Frozen fiscal rules (docs, accountant-approved).** `docs/03-reglasNegocioFact.md` L140: *"Toda venta confirmada debe generar una factura"*; §Secuencias L163-170: independent sequences per tipo+empresa; consumed on CONFIRM (not draft); 90% range warning; block when exhausted or expired; annulled NCF = "no utilizado", still consumed (Formato 608); Cancelada = no fiscal effect (never 607), Anulada = fiscal effect (608); stock that went out is restocked on cancellation (`REPOSICION_CANCELACION` movement enum exists). B01 only for clients that are active taxpayers with an ITBIS-declaring RNC (verified RNC + exact razón social + dirección fiscal); B02 is the main consumption sequence.

**NCF string composition (verified against DGII, not pinned in repo docs).** Per NG 06-2018 / Aviso 13-18 (dgii.gov.do, live fetch): current paper NCF series "B" is **11 characters: `B` + 2-digit tipo + 8-digit secuencial** (e.g. `B02000000522`). The issuer RNC is **not embedded** in the NCF (it was in the pre-2018 series A/P 19-digit form). The repo docs only say "según especificación DGII" (`docs/11` L28) — the spec phase must freeze the `B<tipo><secuencia % 08d>` composition. Consequence: the 11-digit-RNC question does **not** block NCF emission.

**Corporate 11-digit RNC.** `shared/domain/fiscal-id.ts` freezes mod-11 weights for 9-digit RNC `[7,9,8,6,5,4,3,2]` and 11-digit cédula `[1,2,4,8,5,10,9,7,3,6]`; `validarIdentificacionFiscal` routes by length (9→RNC, 11→cédula). Its header documents the **OPEN ITEM**: the modern 11-digit CORPORATE RNC (branch-suffix form) shares its length with the cédula and its DV variant is NOT pinned by `docs/13-glosarioFact.md` — "until an accountant pins it in Fase 5b/5c". The cliente README repeats it. 5b design explicitly handed this to 5c: *"Corporate 11-digit RNC semantics remain a 5c/accountant decision; 5b does not alter `shared/domain/fiscal-id.ts`."* DGII guidance (live fetch): RNC is 9 digits (jurídicas) or the 11-digit cédula (físicas); 11-digit corporate forms exist in the wild and DGII validation is by portal lookup, not local algorithm.

**Confirmation & movement precedents (compra).** `confirmar-compra.ts` = two-phase confirm: `BORRADOR → PENDIENTE` guarded flip + `correlativoInterno` allocation; `recibir-compra.ts` = `PENDIENTE → RECIBIDA` guarded flip then **delegates all stock/movement/cost to inventario** via `registrarEntradasCompra(tx, ctx, {...})` (application→application over published domain types), throwing `INVENTARIO_ENTRADA_RECHAZADA` after a rejection so the state flip rolls back; the guarded `UPDATE ... WHERE estado='PENDIENTE'` with affected-rows check is the sole idempotency arbiter. The atomic-consumption precedent is `asignarCorrelativoSiguienteEnTx` (`compra-repository.ts` L408): `SELECT ... FROM EMPRESA ... FOR UPDATE` (empresa row = serialization anchor), temporary `set_config('app.current_sucursal_id','',true)` to read cross-branch MAX, restore, then `CMP-%06d`. The inventario repository has a proven three-phase batch primitive with `SELECT ... FOR UPDATE` on INVENTARIO rows and deterministic ascending-product-id locking (`inventario-repository.ts` ~L488-560). Nota: compra never touches `NCF_SECUENCIA` — `Compra.ncf` is the supplier's document (manual entry, `esDuplicadoNcf` P2002 guard); no code issues B11 for informal purchases.

**Params.** `ConfiguracionEmpresa` keys (`TASA_ITBIS`, `DESC_MAX`, `PLAZO_*`, retentions) with validity windows; venta's `leerConfigVentaEnTx` reads `DESC_MAX` with instant comparison and hard-fails `DESC_MAX_FALTANTE` (no hardcoded fallback). CodeRabbit F5 carry-over: windows may overlap and `findFirst` (no `orderBy`) picks arbitrarily.

### Affected Areas
- `app/src/modules/venta/application/` — new `confirmar-venta.ts` use case (guarded flip + revalidation + NCF + stock + factura)
- `app/src/modules/venta/infrastructure/` — confirm guarded update, Factura write path, correlativo allocation (FAC-%06d)
- `app/src/modules/venta/domain/` — CONFIRMADA transitions, new stable error codes (NCF/agotada/vencida, STOCK_INSUFICIENTE as BLOCK)
- `app/src/modules/inventario/application/` — new `registrar-salidas-venta.ts` (mirror of `registrar-entrada-compra.ts`, negative deltas, hard block)
- NEW seam: `app/src/modules/ncf/` (engine: consume/preview/90% warning) or `venta/infrastructure/ncf-secuencia-repository.ts` — design decision
- `app/src/modules/venta/http/{actions,validations}.ts` + `ui/{PosScreen,DraftList}` — confirm control, error surfacing
- `app/src/shared/domain/fiscal-id.ts` — only if 11-digit corporate RNC is pinned by the accountant this fase
- `app/src/app/api/` + seed scripts — NCF range provisioning (currently none)
- `app/prisma/` — **expected: zero schema migrations** (see below)

### Schema ground truth: what needs creation/migration
ERD v4.7 ALREADY includes everything 5c touches: `NCF_SECUENCIA` (+RLS/FORCE), `FACTURA` (+RLS), `SALIDA_VENTA`/`REPOSICION_CANCELACION` enum values, `MovimientoInventario.ventaId`, `Empresa.facturaAutomatica`, gravado/exento fields, frozen `EstadoVenta.CONFIRMADA`. **The orchestrator frame's expectation "5c WILL need schema work" is NOT confirmed by evidence — the gap is application code + data provisioning, not DDL.** The only real migration candidates, each a decision:
1. `FACTURA` RLS currently matches `empresaId` only (like `CLIENTE`); invoice reads/writes cross branches within the empresa. Same convention as compra today; add sucursal match only if product wants branch-pure documents.
2. Nothing else — NCF ranges are runtime DATA (DGII-authorizado), provisioned by seed/admin path, not schema.

### Approaches (main fork: where the NCF engine lives)
1. **`ncf` shared module** (`modules/ncf/{domain,application,infrastructure}`) — reusable consume/preview API called by venta (and later compras-B11/notas)
   - Pros: B11 (informal purchases) and B03/B04 (notas) reuse the exact frozen engine; single home for 90%/exhausted/expiry rules; testable row-lock unit
   - Cons: new module boundary before a second consumer ships (mild YAGNI)
   - Effort: Medium
2. **Inside `venta/infrastructure`** (like `asignarCorrelativoSiguienteEnTx` lives in compra) — Pros: mirrors closest precedent, fewer seams. Cons: forced extraction when notas/B11 land (fase 5+/6), duplicating rules otherwise. Effort: Low now, Medium later.
3. Deferred-invoice variant: confirm = estado flip + stock only; a separate "emitir factura" use case honors `facturaAutomatica=false`. Recommended as part of Option 1's API, not as a separate architecture.

### Decision points needing product/accountant answers
| # | Question | Options | Recommendation |
|---|---|---|---|
| D1 | `facturaAutomatica=false`: confirm creates a VIGENTE-less CONFIRMADA sale with a later emission action, or is confirm gated on true for V1? | (a) full dual path now; (b) dual data model but UI only automatic; (c) require true | (b) — schema already 0..1; emission use case = same engine call |
| D2 | B01 vs B02 eligibility: what makes a client "contribuyente activo que declara ITBIS" with no DGII lookup in V1? | (a) valid 9-digit RNC present + not consumidor final → B01; (b) new per-client flag (migration); (c) accountant | (a) for V1 + accountant sign-off; B01 needs exact razón social/dirección already stored |
| D3 | Cash collection at confirm (venta contado → Pagada) is **not** in the 5c frame; confirm leaves the invoice's payment state DERIVED (PENDIENTE until Fase 6 pagos) | (a) confirm without pagos now; (b) pull Pago minimal in | (a) — ADR-017 derivation; keeps 5c bounded |
| D4 | Cancelling a CONFIRMADA sale (stock reposición + NCF "no utilizado" + 608) — same fase or next? | (a) include; (b) defer to 5d | (b) — confirm alone already unblocks the roadmap; cancel semantics need their own spec surface |
| D5 | NCF range provisioning (empresa registers DGII-authorizado ranges): seed script vs admin UI in 5c? | (a) seed `pnpm seed:ncf`; (b) admin CRUD | (a) for V1 launch parity with `seed:venta`; (b) tracked follow-up |
| D6 | Corporate 11-digit RNC: close the fiscal-id open item (accountant pins weights) or formally defer? | (a) pin + implement with tests; (b) keep 11-digit = cédula-only until accountant returns | (b) + escalate to client — NCF emission does NOT need it (B-series carries no RNC); only B01-to-corporate-client data quality |
| D7 | `secuenciaActual` semantics = last used (advance to rangoFin ⇒ agotada) vs next free — must freeze before tests | — | freeze as *last used*; 90% = `(actual−inicio+1)/(fin−inicio+1)` |
| D8 | Expired check granularity: timestamptz instant (venta config precedent) vs SD calendar day (DGII: validity through 31-dic, TZ-irrelevant) | (a) instant; (b) date-fns-tz day compare | (b) matches DGII fiscal dates exactly; cheap and correct |
| D9 | 5b carry-overs: discounted-draft edit UI + Penpot `02-Venta` review + Playwright E2E + DESC_MAX overlap (F5) | absorb all / absorb subset / defer | E2E smoke for the confirm happy path **in scope** (it's the highest-risk fiscal flow and 5b design already deferred E2E "to 5c"); F5 as a tiny hardening task (reader `orderBy vigenciaInicio desc` + seed-time overlap assertion); discounted-draft UI + Penpot review = separate POS polish slice, do not mix into fiscal PRs |

### Recommendation
Build a small **NCF engine seam** (Option 1, one module owning consume/preview/90%/expiry with `SELECT ... FOR UPDATE` on the `NCF_SECUENCIA` row — finer-grained than the empresa lock and exactly the "atomic row-lock inside the transaction" contract), then `confirmarVenta` mirroring the compra two-guard pattern: (1) read venta + branch guard + pure `transicionarConfirmar`, (2) revalidate stock HARD per branch (block, not warn), preview/lock/consume NCF (B02/B01 per D2), guarded `UPDATE ... WHERE estado='BORRADOR'` flip, create `FACTURA` (VIGENTE, gravado/exento from recomputed persisted lines, `correlativoInterno` FAC-%06d via the empresa-lock precedent only if D1 needs it — prefer deriving from the NCF correlativo), then `registrarSalidasVenta` batch (new inventario primitive mirroring the three-phase entry path) — THROWN on any rejection so the flip and NCF consumption roll back. Emit confirm result warnings for the 90% threshold. Deliver as 3 chained PRs: engine(+tests) / confirm+salidas / UI+seed+E2E smoke. Expect **no schema migration** unless D2-b/D8-D9 force it — call this out early so the proposal doesn't budget one.

### Risks
- **Double-consumption / gap**: retry or concurrent confirms must never burn two correlativos (UK `[empresaId,ncf]` + guarded flip + row lock must be proven by concurrency integration tests, mirroring `compra-concurrency` fixtures).
- **Rollback ordering**: NCF consumed but stock rejected (or vice versa) — the throw-after-flip convention (compra) is the only safe pattern; any `return` instead of `throw` silently leaks NCFs.
- **RLS interaction**: NCF row updates run under `app.current_empresa_id`; if the confirm transaction ever clears the sucursal GUC (correlativo precedent), restore before writing FACTURA (branch-scoped) — the compra helper already shows the pattern; forgetting the restore is a data-integrity bug.
- **B01 eligibility misclassification**: local-only validation can invoice B01 to an inactive taxpayer; DGII portal lookup is out of V1 scope — accept and document, or gate B01 behind explicit admin choice.
- **11-digit corporate RNC stays unresolved**: acceptable (engine is B-series); becomes a blocker only if the real client's own RNC is 11-digit and provisioning screens validate it as cédula.
- **Scope creep via D9**: absorbing POS UI polish + review threads into the fiscal change inflates review burden past the 400-line budget; keep slices clean.
- **Timezone semantics of "today"** for expiry (D8) affects fiscal validity; a silent instant-compare could mark a not-y-expired range blocked (or vice versa) at midnight edges.

### Ready for Proposal
**Yes** — architecture is fully precedented (compra confirm/receive + inventario batch + venta guards); nothing awaits unknown code. The proposal should present D1-D9 (D2, D4, D6 need explicit user/accountant sign-off; the rest are engineering freezes the proposal can decide with rationale) and budget zero schema migrations unless a decision flips.

## Key Learnings

1. The NCF_SECUENCIA table exists in the frozen ERD with RLS force enabled but no application code consumes it.
2. Dominican current paper NCF series B is 11 characters, B plus tipo plus eight-digit correlativo, carrying no embedded RNC.
3. The 11-digit corporate RNC check-digit algorithm is an open item frozen out of shared/domain/fiscal-id.ts pending accountant sign-off.
4. fase-5c likely needs zero schema migrations because ERD v4.7 already provisions every confirm-side table and enum.
5. The compra empresa-row FOR UPDATE correlativo allocator and throwing inventario batch delegation are the canonical confirm orchestration precedents.
