# Design: fase-7b-reportes

## Technical Approach

Build `app/src/modules/reportes` as an ADR-013 modular-monolith module, delivered as five chained slices A–E. Server pages/actions remain thin; every read enters `withTenantTransaction`, authorizes before the use case, and delegates to one canonical Prisma/SQL aggregation per report. CSV and DGII writers consume the same unpaginated application result used by screens. No new npm dependency or report table is required.

## Architecture Decisions

| Decision | Choice / rejected alternative | Rationale |
|---|---|---|
| Module seams | `domain/` pure period/SD-window math, comparison/margin/aging, ranking, DGII mapping/padding/errors; `application/` intent-named use cases; `infrastructure/` Prisma `$queryRaw`/`groupBy`, exporters and DB parameters; `http/` Zod/actions; `ui/` panels/selector. | Matches auditoria and keeps fiscal math testable without Prisma. |
| Aggregation | One tenant-aware aggregate query per report; Decimal values cross SQL as text; pagination 25 default/100 clamp. | Prevents fetch-then-sum, N+1, float loss, and screen/export drift. |
| Authorization/widen | `tieneRolPermitidoEnTx` before reads. Admin clears only `app.current_sucursal_id`, restores it in `finally` (auditoria repository pattern); `empresaId` is never cleared. Branch filters are plain `WHERE`. Cobrador is CxC-only and assignment-branch pinned. | Preserves RLS defense-in-depth and deny-by-default. |
| Fiscal output | Dependency-free RFC4180 CSV; fixed-width, space-padded DGII TXT; IT-1 is a summary, never TXT. U1–U5 are slice-E pre-validation acceptance gates. | Research leaves bytes/encoding/codes tool-dependent; guessing would be unsafe. |

## Data Flow

`/reportes` searchParams → thin action → session `TenantCtx` → `withTenantTransaction` + role gate → application use case → one infrastructure aggregate (or reused `consultarSaldoCxcEnTx`) → Decimal DTO → UI or server file response. Dashboard calls the same report use cases for SD-day/month sales, top sellers, pending invoices, CxC balance, and inventory value/low/out counts; it does not duplicate queries.

All `consultar*` functions listed here are application use cases; their domain collaborators are pure period, comparison, ranking, aging, margin, validation, and DGII mapping functions; their Prisma reads and writer implementations are infrastructure; actions are HTTP adapters. CxC imports `consultarSaldoCxC`/`consultarSaldoCxcEnTx`; inventory valuation joins branch stock to current `Producto.costoPromedio`. Rentabilidad explicitly uses current cost, not historical cost snapshots. Export orchestration is application-level (`generarCsv`/`generarTxt606|607|608`), with dependency-free string/stream writers in infrastructure.

## Interfaces / Contracts

```ts
type ReporteFiltro = { desde?: string; hasta?: string; sucursalId?: number; page?: number; pageSize?: number };
type Pagina<T> = { filas: readonly T[]; total: number; resumen: Record<string, string> };
type ReportResult<T> = { ok: true; data: T } | { ok: false; code: "REPORTE_NO_AUTORIZADO" | "REPORTE_VALIDACION"; message: string };
```

Domain converts SD dates through the existing `Intl` seam, validates ranges, derives the immediately preceding equal-length window, Decimal-safe percentage variation (zero baseline → `0`), ranking ties, aging buckets, and fixed-width field rules. CSV emits UTF-8/no BOM, CRLF, RFC4180 quoting and full filtered rows (not page rows). TXT filename is `DGII_F_<code>_<RNC>_<AAAAMM>.TXT`; writer supports zero files and deterministic cap splits. U3 Tipo-Ingreso is a DB-backed parameter mapping, never a constant. A fixture-driven writer loop runs the DGII tool for U1–U5 before E ships.

## File Changes

| File | Action | Description |
|---|---|---|
| `app/src/modules/reportes/{domain,application,infrastructure,http,ui}/**` | Create | Shared filters/errors, all intent use cases, SQL repositories/export writers, guarded actions, panels/CSV/TXT controls. |
| `app/src/app/reportes/page.tsx` | Create | Single selector-first server shell; awaited `searchParams`, deep links. |
| `app/src/app/dashboard/page.tsx` | Modify | Replace placeholder with role-aware KPI dashboard and `/reportes` hub. |
| `app/prisma/migrations/*_reportes_indexes/migration.sql` | Create | Plain SQL indexes on `(empresaId, fecha)` VENTA, `(empresaId, fechaEmision)` FACTURA, `(empresaId, fecha)` COMPRA; own migration commit, additive/revertible. |
| `app/src/modules/cobros/infrastructure/saldo-cxc.repository.ts` | Read-only reuse | No rewrite; report imports canonical balance query. |

## UI, Security, and Slices

`/reportes?reporte=<catalog>&desde=YYYY-MM-DD&hasta=YYYY-MM-DD&sucursalId=<id>&page=<n>&pageSize=<n>` is the stable URL contract. Selector precedes results/export; export buttons render only after the same server gate. Download uses a server action/route file response, keeping consultation interactive. Admin may widen company-wide; Cobrador receives only own-branch CxC tile/report; all other roles get `REPORTE_NO_AUTORIZADO`.

* **A:** module contracts, SD filters/pagination, widen helper, CSV seam, `/reportes` shell, dashboard KPI use cases/UI.
* **B:** operational reports, CSV panels/actions, indexes migration.
* **C:** canonical CxC aging (company-wide plus optional invoice-branch narrowing), CxP, equal-window comparativa.
* **D:** current-cost rentabilidad and visible/exported limitation disclaimer.
* **E:** ITBIS and IT-1 worksheet, 606/607/608 mapping/writers, fixture-driven U1–U5 pre-validation loop; `Cancelada` is in neither file.

## Testing Strategy

Pure Jest tests cover SD boundaries, invalid ranges, comparison, ranking, margins, aging, B02 threshold, CSV quoting, fixed-width padding, cross-foot, zero files, and cap splits. Integration tests cover SQL aggregation, Decimal parity, RLS/cross-tenant isolation, role denial before reads, CxC reuse, branch narrowing, widen restoration on success/failure, DB parameter fallback, and screen==CSV totals. Playwright covers selector-first navigation, searchParams round-trip, role-visible panels, and non-blocking download. E adds fixture writer tests plus actual DGII pre-validation evidence for U1–U5.

## Threat Matrix

| Boundary | Status / response / RED test |
|---|---|
| Documentation-like paths | N/A — no executable documentation classification. |
| Git repository selection | N/A — no Git command or repository selection. |
| Commit state | N/A — no commit automation. |
| Push state | N/A — no push/refspec automation. |
| PR commands | N/A — no PR automation. |

## Migration / Rollout

Slices merge A→E; each is independently revertible. Index migration is additive and separate. No data migration, feature flag, or mutation rollback is required. Caja remains deferred.

## Open design choices settled

- CSV, not XLSX, avoids a dependency and preserves the approved V1 seam.
- IT-1 is a casilla summary because DGII accepts no IT-1 TXT.
- Comparativa uses the immediately preceding equal-length SD window; current-only total row avoids misleading mixed periods.
- Rentabilidad uses current `costoPromedio`; the limitation is shown in UI and CSV.
- `Cancelada` is excluded from 607 and 608; only `Anulada` enters 608, matching the binding spec decision.

## Assumptions

Existing auditoria SD conversion, tenant wrapper, generated Prisma types, role names, and session context remain stable. DGII pre-validation tooling is available to the E implementation environment; unresolved byte offsets, encoding, U3 codes, and U5 cap are not guessed and block E release until validated.
