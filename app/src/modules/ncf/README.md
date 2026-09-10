# NCF Engine — `src/modules/ncf`

Frozen DGII sequence rules over `NCF_SECUENCIA`. Phase 1 (`pr5c1`) of
`fase-5c-ncf-confirm`. Reusable by `confirmarVenta` and later nota / B11 flows.

## Layer map (ADR-013)

| Layer | File | Responsibility |
|---|---|---|
| `domain/` | `ncf-rules.ts` | Pure: `componerNcf` (R-N2), `calcularUmbral90` (R-N3), `esRangoVencidoSD` (R-N5), D7 transition helpers, B01/B02 eligibility **result types** (D2). No Prisma / Next / React / Supabase. |
| `application/` | `consumir-ncf.ts` | The consume port `consumirNcfEnTx(tx, ctx, tipo, opts)` and the typed `NcfConsumoError`. |
| `infrastructure/` | `ncf-repository.ts` | Prisma-only `SELECT ... FOR UPDATE` row lock + advance on `NCF_SECUENCIA`. |

## Port contract — `consumirNcfEnTx`

```
consumirNcfEnTx(tx, ctx, tipo, opts?) → Promise<{ ncf, tipo, secuencial, warning? }>
```

* Runs **inside the caller's tenant transaction** (opens none itself).
* Locks the single **active** `empresaId + tipoNcf` row with `SELECT ... FOR
  UPDATE` — the sequence row, never the `EMPRESA` row, so only that sequence is
  serialized (design decision). RLS `ncfsecuencia_isolation` is enforced **and**
  `empresaId` is pinned in the `WHERE` (defense in depth).
* Composes exactly `B<tipo 2d><secuencial %08d>` = 11 chars, no RNC (R-N2).
* Advances the counter only after all guards pass, so a concurrent second
  consume blocks until the first commits and receives the next distinct value
  (`@@unique([empresaId, tipoNcf])` is never violated).

## Semantics

* **D7 — last used.** `secuenciaActual` is the LAST used value; `next =
  secuenciaActual + 1`. `next > rangoFin` ⇒ exhausted.
* **D8 — SD calendar day.** Expiry compares `America/Santo_Domingo` calendar
  dates (via `Intl.DateTimeFormat` with an explicit `timeZone`, the ratified
  project "equivalent" to a tz library — see `venta/ui/fecha.ts`), never raw UTC
  instants. `now` is injectable through `opts.now` for deterministic tests.

## Throw-after-consume convention

Missing / exhausted / expired throw `NcfConsumoError` with a stable code
(`NCF_SEC_INEXISTENTE` | `NCF_AGOTADA` | `NCF_VENCIDA`). Because the throw
propagates out of the caller's transaction, **the counter and every post-consume
effect roll back together — an aborted or retried transaction burns nothing**
(R-N1 retry safety). The 90% case is NOT an error: it is surfaced out-of-band as
`warning: "NCF_UMBRAL_90"` on the successful result (R-N3) and must never fail
the operation.

> `venta` (Phase 2) maps these codes into its frozen 19-code catalog; this
> module deliberately does not touch that catalog.

## Deviations recorded for verify

1. **Integration test location.** DB-backed cases live in
   `src/integration/ncf-consume.integration.test.ts` (run via
   `pnpm test:integration`), not `infrastructure/__tests__/*.spec.ts` as the
   task text names — that path is collected by the no-DB unit config and would
   never reach the harness. Same location as `compra-concurrency`.
2. **No new dependency.** R-N5 says "via `date-fns-tz`"; the repo has none and
   its ratified precedent (`venta/ui/fecha.ts`) uses `Intl.DateTimeFormat` with
   an explicit `timeZone` as the AGENTS.md "equivalent". Phase 1 follows that
   precedent rather than adding `date-fns-tz` + lockfile churn.
3. **Spec literal typo.** The change docs print `B02000000522` (12 chars) while
   mandating "exactly 11 characters" + `%08d`. The authoritative, self-consistent
   rule yields `B0200000522`; tests assert 11 chars. Recommend fixing the
   literal (and the 9-digit dev seed range `100000000–100000999` in Phase 4,
   which likewise exceeds `%08d`).

## Tests

```
pnpm jest src/modules/ncf        # unit (pure rules) — R-N2/R-N3/R-N5
pnpm test:integration ncf-consume # real DB — R-N1/R-N3/R-N4/R-N5 + concurrency
```
