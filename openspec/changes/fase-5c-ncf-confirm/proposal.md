# Proposal: fase-5c-ncf-confirm — NCF Engine + Sale Confirmation + SALIDA_VENTA

## Intent

Fase 5b shipped draft-only ventas; `CONFIRMADA` is persisted but unreachable. NCF_SECUENCIA, FACTURA and SALIDA_VENTA exist in the frozen ERD (RLS forced) with zero application code. 5c closes the confirm loop: atomic NCF consumption, hard stock debits, automatic invoice emission, and confirmed-sale cancellation with full fiscal semantics (608). Owner decisions D1–D6 are binding (see exploration); engineering freezes D3/D5/D7/D8/D9 adopted here.

## Scope

### In Scope
- **NCF engine seam** (`modules/ncf/`): consume/preview/90%-warning/expiry on `NCF_SECUENCIA` with row-lock `SELECT ... FOR UPDATE`; composition frozen as `B<tipo><secuencial %08d>` (11 chars, no embedded RNC)
- **`confirmarVenta`**: two-guard confirm mirroring compra — guarded `BORRADOR → CONFIRMADA` flip + revalidation; hard per-branch stock block via new `registrarSalidasVenta` batch (throw-on-reject ⇒ full rollback, never return-after-consume); `FACTURA` VIGENTE creation (gravado/exento recomputed from persisted lines, `correlativoInterno` FAC-%06d); B01/B02 eligibility per D2 (valid 9-digit RNC + not consumidor final, no DGII lookup — documented limitation); gated on `facturaAutomatica=true` (D1: false ⇒ stable error, deferred emission = follow-up)
- **Confirmed-sale cancellation** (D4): guarded `CONFIRMADA → CANCELADA`, `REPOSICION_CANCELACION` inventory movement, NCF marked "no utilizado" (consumed, 608 semantics)
- **Payment state stays derived** (D3): invoice payment state untouched until Fase 6 pagos (ADR-017)
- **Seed provisioning**: `pnpm seed:ncf` for DGII-authorized ranges (D5); admin CRUD = follow-up
- **Carry-overs** (D9): Playwright E2E smoke for confirm happy path; DESC_MAX reader hardening (`orderBy vigenciaInicio desc` + seed-time overlap assertion — CodeRabbit F5)

### Out of Scope
- Deferred-invoice emission use case (D1 follow-up); Pago/cash collection (Fase 6); NCF admin CRUD UI
- Corporate 11-digit RNC — frozen per D6; `shared/domain/fiscal-id.ts` untouched; recorded as open item for accountant (B-series NCF carries no RNC, emission unaffected)
- Discounted-draft edit UI, Penpot review, POS polish (separate slice)

## Capabilities

### New Capabilities
- `ncf-engine`: NCF sequence consumption, composition, 90% warning, exhaustion/expiry blocking (SD calendar-day expiry per D8), provisioning seed
- `factura-emision`: automatic FACTURA creation at confirm (eligibility B01/B02, correlativo, estado VIGENTE, derived payment state)

### Modified Capabilities
- `venta`: add CONFIRMADA transition + cancellation of confirmed sales (fiscal state machine BORRADOR/CONFIRMADA/CANCELADA)
- `inventario`: add `registrarSalidasVenta` hard-debit batch primitive (mirror of entry path)

## Approach

Option 1 from exploration: small `ncf` module owning the frozen consumption rules; `confirmarVenta` orchestrates via application-to-application delegation (compra precedent): read+branch guard → pure `transicionarConfirmar` → stock preview (reject early) → NCF lock/consume → guarded flip → FACTURA → `registrarSalidasVenta` (throw on rejection ⇒ transaction rollback including NCF). Concurrency proven by integration tests (UK `[empresaId,ncf]` + row lock + guarded flip), mirroring compra-concurrency fixtures. **Zero schema migrations expected** — no decision above forces DDL; exceptions would be flagged at spec phase.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `app/src/modules/ncf/` | New | Engine: consume/preview/90%/expiry repository + domain rules |
| `app/src/modules/venta/application/` | New/Modified | `confirmar-venta.ts`, confirmed-cancel use case, error codes |
| `app/src/modules/venta/infrastructure/` | Modified | Confirm guard, Factura write path, FAC correlativo |
| `app/src/modules/inventario/` | Modified | `registrar-salidas-venta.ts` batch primitive |
| `app/src/modules/venta/http/` + `ui/` | Modified | Confirm/cancel controls, error surfacing |
| `app/scripts/` seed | New | `seed:ncf` |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Double NCF consumption on retry/concurrency | Med | Row lock + UK + guarded flip; concurrency integration tests |
| Rollback ordering leaks NCF (return instead of throw) | Med | Throw-after-flip convention only; code review gate |
| RLS GUC restore missed after sucursal-clear (correlativo pattern) | Low | Restore before FACTURA write; integration test asserts branch |
| B01 misclassification (no DGII portal in V1) | Low | Documented limitation (D2); local validation only |
| Scope creep inflating review budget | Med | 4 clean chained PRs; polish slice excluded |

## Rollback Plan

Four PRs stacked to main, revertible independently in order (engine → confirm+factura → salidas+cancel → UI+seed+E2E+F5). No schema migrations ⇒ rollback is pure code revert; consumed NCFs during the exposure window remain "no utilizado" records (608-consistent, no repair migration needed).

## Dependencies

- NCF range data must be seeded (`pnpm seed:ncf`) before any confirm E2E
- 5b venta module merged (done)

## Success Criteria

- [ ] Confirm consumes exactly one NCF per sale; retry/concurrency never duplicates (tests prove)
- [ ] Insufficient stock blocks confirm per branch; no negative inventory; rollback leaves sale BORRADOR
- [ ] CONFIRMADA with `facturaAutomatica=true` yields VIGENTE FACTURA with correct gravado/exento and correlativo
- [ ] Cancelled CONFIRMADA sale restocks stock and marks NCF "no utilizado" (608)
- [ ] 90% warning and exhaustion/expiry (SD day) block correctly
- [ ] E2E confirm happy path green; F5 hardening merged
- [ ] Zero schema migrations
