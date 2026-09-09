# Proposal: Fase 5 (Venta) — Phase Map & Sub-Phase Cut

**Change**: `fase-5-venta-exploracion` · **Type**: docs-only, map-only · **Precedent**: `fase-3-4-inventario` (PR #6)

## Intent

Deliver the authoritative Fase 5 phase map and confirmed sub-phase cut (5a–5d) so each sub-phase SDD cycle inherits a complete cross-cutting fiscal contract from the start. Without it, decisions currently undocumented in any artifact — `precioVenta` net-vs-ITBIS-inclusive semantics (blocks 5b calculators and POS display) and the DGII 19-digit NCF mask (blocks 5c issuance) — would force re-design churn mid-implementation.

## Scope

### In Scope

- The exploration document (already written in this change folder) as the phase-map contract source: current state, cross-cutting fiscal contract (NCF engine, inverted totals, B04 reversal, Cancelada/Anulada states), sub-phase cut, seams strategy, risk mapping.
- This proposal as the only additional docs artifact (this file).
- The pending-decision ledger, recorded per sub-phase:
  - **5a**: Consumidor-Final provisioning (lazy vs seed); credit-field edit policy.
  - **5b**: `precioVenta` semantics (**BLOCKER**); carrito persistence; anonymous/Consumidor-Final draft sales.
  - **5c**: NCF mask composition (**BLOCKER**); `facturaAutomatica` V1 scope; confirm idempotency key; receipt format; credit-blocking config wiring.
  - **5d**: paid-invoice → saldo a favor (Fase 6 cash out of scope).
- Delivery plan: single docs PR to `master`, then a standard SDD cycle per sub-phase (5a → 5b → 5c → 5d).

### Out of Scope

- No detailed specs, design, tasks, or implementation for any sub-phase — each gets its own full SDD cycle later.
- No product interviews: all content sourced from `exploration.md`.
- No code, no schema migration, no submodule changes, no Engram/codegraph churn.
- B03 (Nota de Débito) deferred to Fase 6/7 (entity/sequence already exist).

## Capabilities

### New Capabilities
None — this is a docs-only change; no capability requirements are introduced. Existing `openspec/specs/` are unaffected.

### Modified Capabilities
None.

## Approach

Keep the openspec convention: `proposal.md` joins `exploration.md` in `openspec/changes/fase-5-venta-exploracion/`; no `docs/` artifact. Affected area: `openspec/changes/fase-5-venta-exploracion/proposal.md` (New). The proposal records the decision ledger and cut; the exploration holds the full map; sub-phase changes cite both.

## Risks (of record)

| Risk | Severity | Mitigation |
|------|----------|------------|
| NCF exhaustion/vigencia blocks the counter, no fallback | Critical/fiscal | 5c: explicit block + 90% warning in confirm flow |
| Mixed 18/16/0 + discount-before-ITBIS rounding (DGII-visible) | High/fiscal | 5b: pure calculators, exhaustive tests pre-DB |
| Double-confirm / sequence & stock races | High | 5c: row-lock + guarded UPDATE + idempotency decision |
| Cross-tenant leak on high-surface venta tables | Critical/security | RLS + tenant rule + `empresaId`/`sucursalId` filters + isolation tests |
| Cancelada-vs-Anulada 607/608 conflation | Medium/fiscal | 5c: distinct use cases + state-machine tests |
| First interactive POS UI (5b/5c) with no in-repo precedent | Medium | domain-first chained PRs; fiscal ops never optimistic |
| `precioVenta` & NCF mask not guessable by implementers | Medium | surfaced as BLOCKER decisions in the ledger, resolved before each sub-phase's specs |

## Rollback Plan

Docs-only: revert the single docs PR on `master` (`git revert`); the change folder can be deleted without any code or migration impact. Precedent: PR #6.

## Dependencies

None external; requires no upstream artifact beyond the committed exploration.

## Success Criteria

- [ ] Phase map consciously confirmed by the user as the contract for the 5a–5d sub-phase cycles.
- [ ] Proposal reviewed and merged to `master` via a single small docs PR.
- [ ] Every subsequent sub-phase change cites this exploration/proposal and inherits the contract and decision ledger.
- [ ] Decisions #3 (`precioVenta`) and #6 (NCF mask) are surfaced as the two that must not be guessed by agents.
