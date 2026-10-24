# f2-venta-pos — Venta/POS refinement (contado + crédito)

Objective: finish the F2 venta/POS feature (slices C, D, E + version bump + PR).
Branch: `feature/f2-venta-pos` · Delivery: single PR (owner-ratified, size:exception) · Test runner: jest (`pnpm exec jest ...`).
Binding specs (verbatim): `openspec/changes/f2-venta-pos/tasks.md` (tasks 3.x/4.x/5.x/6.x), `design.md` (D2/D3/D4/D5/D8), `specs/venta/spec.md` (R-V21..R-V26). Read those for task detail; this doc tracks status only.

## Specs

- S1: Per-line discount cart wiring — admin-gated per-line discount inputs in CartTable feeding `carro.ts` amounts, preview = same released calculators, over-cap decided ONLY server-side (tasks 3.1–3.5, R-V21, design D2).
- S2: Vuelto panel + numeric keypad — display-only money-received/vuelto in Totales, ONE shared 48px `NumericKeypad` (`app/src/components/ui/numeric-keypad.tsx`), pure `componerValor`/`calcularVuelto`, never in any payload (tasks 4.1–4.7, R-V22/R-V23, design D3/D4).
- S3: Anulación Dialog + shared E2E utils + credit-path coverage — admin "Void sale" Dialog with mandatory motivo (action unchanged), e2e utils extraction `app/e2e/utils/{login,db,venta-pos}.ts`, contado COBRO assertion + credit-path e2e case (tasks 5.1–5.14, R-V24/R-V26, design D5/D8).
- S4: Final version bump ONLY — `app/package.json` + `.release-please-manifest.json` to 0.17.0 + new `[0.17.0]` CHANGELOG section, BOM-free writes + byte-check gate, commit contains exactly those 3 files (tasks 6.1–6.8).
- S5: Final gates + single PR: `pnpm lint && pnpm exec tsc --noEmit && pnpm test && pnpm build` green; PR to `master` referencing the openspec trail; apply report ends `bump validated: 0.17.0`.
- Carried: 1.9 e2e flow-proof env-blocked locally → ratified by CI.

## Tasks

| ID | S# | Route | Status | Commit |
|----|----|-------|--------|--------|
| Slice A (tasks 1.1–1.9) | — | inline | done 1.1–1.8; 1.9 pending CI | `2e89caf` |
| Slice B (tasks 2.1–2.12) | — | inline | done | `02fb45a` |
| Slice C (tasks 3.1–3.5) | S1 | inline | done (gate re-run pending in S5) | `8137a59` |
| Slice D (tasks 4.1–4.7) | S2 | inline | done (53/53 UI suites, tsc 0, lint 0 errors, build 0) | `6707de5` |
| Slice E (tasks 5.1–5.14) | S3 | inline | done except 5.1/5.6/5.14 e2e run (env-blocked locally, CI ratifies) | pending commit |
| Bump + gates + PR (6.1–6.8) | S4,S5 | inline | open | — |

## Log

- L1 (2026-10-14): "Do the f2 venta... store opened `feature/f2-venta-pos` slices per openspec" — original SDD apply request, verbatim scope in `openspec/changes/f2-venta-pos/tasks.md` L1 (tasks.md header).
- L2 (2026-10-23): owner: "we're stopped to use the SDD and now we're in ODD" — SDD phase tracking ends; this ODD doc supersedes Engram/sdd trackers. openspec specs remain the binding verbatim requirements (referenced above, not re-quoted).
- L3 (2026-10-23): Slice B committed `02fb45a`; verification evidence in `openspec/changes/f2-venta-pos/apply-progress.md`. Next: slice C task 3.1.
- L4 (2026-10-23): Slice C committed `8137a59` (per-line discount cart wiring, 5 files / +326). Slice D committed `6707de5` (vuelto panel + numeric keypad, 8 files / +416) with observed verification: 53/53 UI suites, `tsc --noEmit` 0, lint 0 errors, `pnpm build` 0; `dineroRecibido` stays display-only (PosScreen/Totales/venta-ui spec, never in payload). Slice C per-commit gate evidence was not captured to Engram at commit time — re-run in the S5 final gate, not assumed. Next: slice E task 5.1.
- L5 (2026-10-24): Workspace cleanup before slice E (owner-authorized): restored `app/package.json` + `app/pnpm-lock.yaml` to HEAD (they were `v0.16.2` master content, not branch work), ignored `*.penpot` (6 MB local design binary, never to be committed), committed Next-generated `app/AGENTS.md`/`app/CLAUDE.md`, the root `AGENTS.md` CI/CD trim, and this tracker; merged `origin/master` (`3c4455f`) into the branch. Rationale: one coherent work unit per commit, no binary in history, no docs rewrite inside the feature PR.
- L6 (2026-10-24): Slice E implemented inline. e2e utils extracted (`e2e/utils/login.ts`, `db.ts`, `venta-pos.ts`; four specs swapped, helpers byte-equivalent in behavior). R-V24 admin-only Void sale Dialog in `DraftList`/`PosScreen` (reason UI-mandatory, `zCancelarVentaInput.motivo` stays optional — R-V16 frozen). Contado case gained the `PAGO (COBRO/APLICADO, monto = factura.total)` assertion; new credit case proves ZERO COBRO. Observed gate: jest 30 suites / 320 tests green, `tsc --noEmit` 0, lint 0 errors, `pnpm build` 0. `pnpm e2e` attempted and env-blocked: no Postgres on `localhost:5433` (`AggregateError` in `usuarioPrecond`), so 5.1/5.6/5.14 are CI-ratified, not locally proven. Next: commit slice E, then 6.1–6.8 (version 0.17.0 + single PR).
