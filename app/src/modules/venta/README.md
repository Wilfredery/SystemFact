# Venta module — fase 5b core (draft-only sale engine)

Four-layer modular-monolith feature (`domain / application / infrastructure /
http`) implementing the **draft-only** sale core: `BORRADOR` lifecycle
(create/update/cancel) with DGII-safe mixed 18/16/0 ITBIS, discount-before-ITBIS
(ADR-018), a venta client resolver defaulting to Consumidor Final, non-blocking
branch stock warnings at draft save, and `DESC_MAX`-capped admin-only discounts.
Confirmation, NCF consumption, inventory debit and payments are **reserved for
5c** — no 5b code path reaches `CONFIRMADA`.

> **PR status.** This is the **PR-1 (domain)** + **PR-2 (application /
> infrastructure / http / venta-config / integration)** + **PR-3 (POS `ui/`
> slice)** build. Confirmation, NCF, inventory and payments stay reserved for
> 5c. See `openspec/changes/fase-5b-venta-core/`.

## Penpot gate (task 3.1) — board-agnostic

The `02-Venta` board is referenced only in `docs/17-plan_wireframes.md §3`
(planning). No board export or design spec is committed in-repo, and no live
Penpot instance was connected when PR-3 was implemented. Per the design's Open
Question, the POS UI proceeded **board-agnostic**: layout follows design §6
(Technical Approach) with no pixel-level reference, and the visual pass is
deferred to 5c when the board is available.

## UI layer (PR-3) — first interactive screen

| File | Responsibility |
|---|---|
| `app/src/app/venta/page.tsx` | Server shell: resolves `TenantCtx` from the session (redirect `/login` when absent) and passes `esAdmin` down. No business logic. |
| `ui/carro.ts` | Pure client cart model + transitions (`agregarAlCarrito`/`quitarDelCarrito`/`editarLinea`) and `calcularVistaPrevia`, which previews totals with the SAME pure domain calculators the server uses. |
| `ui/PosScreen.tsx` | `"use client"` orchestrator: composes the panels, drives save/edit/cancel through the PR-2 actions, renders the warning banner + status. **Renders no confirm control.** |
| `ui/ProductSearch.tsx` | Name/code search via `listarProductosAction`; add-to-cart. |
| `ui/ClienteSelector.tsx` | Picker defaulting Consumidor Final (`clienteId: null` → resolved by the 5a seam at save); inline registration via `crearClienteAction`. |
| `ui/CartTable.tsx` | Live cart lines with qty/price editing and per-line ITBIS. |
| `ui/DiscountPanel.tsx` | Header discount, rendered only for `esAdmin` (UI gate; the cap + actor are server-side, R-V8). |
| `ui/Totales.tsx` | Totals with the gravado/exento breakdown (returned-only figures, R-V6). |
| `ui/DraftList.tsx` | "My drafts" (BORRADOR, own user) with Edit/Cancel wired to the PR-2 actions. In-place **Edit** is gated to zero-discount drafts (see below); discounted drafts are view/cancel-only. |
| `ui/fecha.ts` | Santo Domingo presentation formatting (`Intl.DateTimeFormat` + `timeZone`, never `toLocaleString` with the browser zone). |
| `ui/__tests__/venta-ui.spec.tsx` | jsdom + React Testing Library component tests for R-V14. |

- **ADR-018 / R-V7 edit constraint:** a persisted discount stores only its
  **resolved money** (`descuento`), so a `PORCENTAJE` draft's original percentage
  is *not* recoverable from `obtenerVenta`. Re-editing it as `MONTO` would
  silently change the frozen `descuentoTipo`, so the editor refuses non-zero
  discounts (they can be cancelled and recreated instead). State rows are mapped
  through `estadoVentaDesdeDb` (fail-loud) and compared against `ESTADO_VENTA` —
  no free state strings in the UI.

- **Design "UI totals":** the client imports the pure `domain/calculators` (no
  DB deps) for a responsive preview; the save actions always recompute
  authoritatively server-side inside `withTenantTransaction`.
- **Accessibility / copy:** English screen copy; labelled controls, `role="alert"`
  /`aria-live` for the warning banner, visible disabled state on the empty-cart
  save guard. Kept intentionally simple (no grid/DnD/keyboard-macro extras).
- **Test toolchain:** PR-3 added `@testing-library/react`, `@testing-library/dom`,
  `@testing-library/jest-dom` and `jest-environment-jsdom` (the repo previously
  had only the `node` environment). A `.tsx` ts-jest transform was wired into
  `jest.config.js`; component tests opt into jsdom via their `@jest-environment`
  docblock, so the global unit/integration environment is unchanged.
- **Manual smoke checklist:** `app/SETUP-LOCAL.md` §"POS manual smoke checklist".

## Application / infrastructure / http layers (PR-2)

| Layer | File | Responsibility |
|---|---|---|
| application | `application/venta-service.ts` | `crearVenta` / `actualizarVenta` (full line-replace + client swap, guarded) / `cancelarVenta` / `listarVentas` / `obtenerVenta`. Thin orchestration; no `prisma.*`. |
| application | `application/preparar-lineas-venta.ts` | One shared pre-write pipeline for both saves: line/rate/validity validation, server-side admin-only discount gate, `DESC_MAX` cap, computation and stock warnings. No writes. |
| application | `application/resolver-cliente-venta.ts` | R-V10 client resolver: `null` → Consumidor Final via `getOrCreateConsumidorFinalEnTx` (5a seam); given id → empresa-scoped active check → typed `CLIENTE_*` codes. |
| application | `application/venta-guardado.ts` | Composed sale-save result type (`VentaErrorCode` ∪ `DESC_MAX_FALTANTE`) so the domain catalog stays frozen at its 14 codes. |
| infrastructure | `infrastructure/venta-repository.ts` | The only Prisma surface: tenant/branch-scoped reads, guarded `updateMany` (estado + `updatedAt` token), replace-lines, audit append, branch stock reads, role check. |
| infrastructure | `infrastructure/config-repository.ts` | venta-config `leerConfigVentaEnTx`: hard-fail `DESC_MAX` read (R-C1); owns the `DESC_MAX_FALTANTE` code and `VentaConfigError`. |
| http | `http/{validations,actions}.ts` | Zod transport boundary + thin `"use server"` actions wrapped in `withTenantTransaction` (ESLint `server-action-must-wrap-tenant`); CRUD roles Administrador + Operador. |
| tools | `../../../tools/scripts/seed-venta-config.ts` | `pnpm seed:venta`: idempotent one-active-`DESC_MAX`-row-per-empresa seed (default `4.00`). |

- **Concurrency (R-V3/R-V4):** guarded `updateMany ... WHERE estado='BORRADOR'`
  with an affected-rows check is the lock. Because a draft edit leaves `estado`
  at `BORRADOR`, the guarded update also pins the `updatedAt` snapshot read at the
  pre-check — that token is what makes two parallel edits genuinely conflict
  (no `version` column exists; `@updatedAt` advances on the winner's commit).
- **Security (R-V8/R-V11):** the Administrador-only discount and every role check
  run server-side inside the transaction; the tenant/branch filters pin both
  `empresaId` and `sucursalId`; zod is never the authorization authority.

## Domain layer (pure — ADR-013)

`domain/` imports NOTHING from Next.js / React / Prisma / Supabase. All money and
quantities cross the boundary as `Decimal`-compatible strings (`Decimal(12,2)`
amounts, `Decimal(12,3)` quantities); arithmetic is `decimal.js` half-up 2dp, so
**no floats appear**. Parity with `compra/domain/calculators.ts`.

| File | Responsibility |
|---|---|
| `domain/venta.ts` | `EstadoVenta`, the total `estadoVentaDesdeDb` mapper (unknown → fail loud), draft-reachability predicates, the `Descuento`/`VentaLineaInput`/`TotalesVenta` contracts and the zero-discount convention. |
| `domain/errors.ts` | Pinned stable-code catalog (`VentaErrorCode` + Spanish `messageFor`), `VentaResult<T>`, `VentaSaveResult<T>` and the `STOCK_INSUFICIENTE` `StockWarning` (a warning, never an error). |
| `domain/calculators.ts` | R-V5 computation order (`gross → line discount → net base → header proration → ITBIS`) and R-V6 header proration (half-up shares, remainder to the largest net base, ties earliest). Returns `subtotalGravado`/`subtotalExento` — never stored. |
| `domain/descuentos.ts` | R-V7/R-V8 pure rules: shape validation, the `DESC_MAX` triple-cap (per-line % of gross, header %, aggregate % of Σ gross) and the base-exceed rule. |

### Fiscal semantics

- `precioUnitario` is **ITBIS-exclusive** (ADR-018 net base): the customer pays
  `total = base + ITBIS`. The ADR-style note lives in the change design doc.
- Stored `descuento`/`descuentoLinea` hold **resolved money** (2dp), never the raw
  percentage input; `descuentoTipo` records the frozen authorization form and
  `descuentoAutorizadoPor` the admin actor. A zero discount is always
  `PORCENTAJE` / `0.00` with a `NULL` authorizer.
- The stored identity `total = subtotal − descuento + itbis` holds exactly;
  fixtures F1–F4 in `domain/__tests__/calculators.spec.ts` are the canonical
  numbers.

## Reserved 5c seam (no stubs in 5b)

`BORRADOR → CONFIRMADA`, NCF consumption, the `SALIDA_VENTA` hard stock block,
B01/B02 eligibility, and credit-limit/mora blocking. Stock at draft save is only
a structured `STOCK_INSUFICIENTE` warning (R-V9). `CONFIRMADA` exists in the
persisted enum for `estadoVentaDesdeDb` completeness but has no reachable path.

See `openspec/changes/fase-5b-venta-core/` (proposal, spec, design, tasks) for the
full contract and the enforcement/wiring that PR-2 adds.
