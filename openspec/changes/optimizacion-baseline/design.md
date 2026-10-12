# Design: optimizacion-baseline — server-side pagination & deduplication cycle

Change: `optimizacion-baseline` · Store: hybrid (this file + Engram `sdd/optimizacion-baseline/design`)

## Technical Approach

One shared pagination contract (`shared/domain/pagination.ts`) + one shared audit writer consumption (canonical `registrarEventoAuditoriaEnTx`) carry all seven work items. The pagination work moves the interactive page cut to the SQL layer per-area:

- **CxC board (H1, R-C9)** — the canonical ADR-017 aggregate block in `cobros/infrastructure/saldo-cxc.repository.ts` stays byte-identical; the board page is served by an outer wrapper query over that block with the outstanding-set predicate, the pinned `ORDER BY`, an optional page tail, and a server-side filtered total.
- **Aging (FIN-6)** — `consultarCxcAging` stops calling `leerCxcAgingCompleto` + slicing; the screen page becomes SQL (`LIMIT`/`OFFSET` + `ORDER BY` replicating the pre-slice sort) and the bucket summary becomes an SQL aggregate. The CSV export keeps the existing full-read path untouched (exports stay unbounded).
- **Estado de facturas (OP-6)** — the ONE remaining in-memory slice in `application/operacional.ts:177-178` becomes a paginated grid read; the page-independent summary keeps its own full-grid read (grid is bounded ≤ estado × tipoNcf cells, ≤6 rows — cheap).
- **Rentabilidad (REN-4)** — `rentabilidad-repository.ts` already sorts in SQL (`ORDER BY p."id" ASC`); add the page tail + a filtered-total count; `application/rentabilidad.ts:96-98` drops its slice.
- **Ventas por periodo / productos vendidos / inventario valorizado / CxP (OP-6 partial)** — already push `LIMIT`/`OFFESET` via `limitePaginaSql` + `contar*EnTx`; NO change (verified — the audit's H2 defect list narrows to the three use cases above).
- **Inventario guard (M1, R-INV-B1)** — the per-product `findFirst` loop (`guardarPertenenciaProductosEnTx`, `inventario-repository.ts:172-182`) becomes ONE batched tenant query + a pure set-difference that preserves the deny-first rule.
- **Audit writer (M2, AU-1)** — the 12 duplicated `movimientoAuditoria.create` sites converge on `registrarEventoAuditoriaEnTx` (canonical at `auditoria/infrastructure/registrar-evento.repository.ts:41-68`, consumed today via the `auditoria/application/auditoria-write-port` re-export).
- **Producto listing dedupe (M4, REQ-PROD-010)** — `registrarProductoListadoEnTx` gains a bounded one-row window check inside the listing's own transaction; at most one `producto.listed` row per actor per 60-second window, payload `{count: total}`.
- **ConfiguracionEmpresa seam (M5, R-QC-08 / R-C4)** — ONE shared reader carrying the active-window predicate (company + clave + `activa` + window + newest-`vigenciaInicio` tie-break), consumed by the 4 existing reader modules.

Verified code facts this design relies on (all read from source, codegraph-verified):

- Canonical aggregate: `consultarSaldoCxcEnTx(tx, ctx): Promise<SaldoCxcFila[]>` — `SELECT ... FROM "FACTURA" f LEFT JOIN (Σ PAGO) p LEFT JOIN (Σ NOTA_CREDITO) nc LEFT JOIN (Σ NOTA_DEBITO) nd WHERE f."empresaId" = ctx.empresaId AND f."estado" = 'VIGENTE' ORDER BY f."fechaEmision" DESC, f."id" DESC` (saldo-cxc.repository.ts:46-93).
- Board UI is `"use client"` fetch-on-mount (`CxcBoardScreen.tsx:49,77-79`) calling `consultarSaldoCxcAction` → `consultarSaldoCxC(tx, ctx, input)`; `ui/board.ts` supplies `TAMANO_PAGINA_CXC=25`, `clasificarTableroCxc`, `paginar<T>` (slice-in-memory, cap 100, clamp page).
- Aging pre-slice sort (`application/cxc-aging.ts:115-119`): `diasVencido DESC, saldoPendiente DESC, facturaId ASC` over rows aged by the pure `diasVencidoEnSD`/`construirFilaAging` (`domain/aging.ts`), filtro pages from `reporte-filtro.ts` (`calcularOffset`, `calcularTotalPages`, `TAMANO_PAGINA_POR_DEFECTO=25`, `TAMANO_PAGINA_MAXIMO=100` — duplicated identically in `auditoria/domain/auditoria.ts:69,71`).
- Rentabilidad: `rentabilidadFilasEnTx(tx, ctx, ventana)` returns the FULL grouped set ordered `p."id" ASC` (rentabilidad-repository.ts:112); `consultarRentabilidad` slices at `application/rentabilidad.ts:97-98`.
- `Paginacion {offset, limit}` + `limitePaginaSql(pag?)` already exist in `operacional-repository.ts:34,87-89` and serve ventas/productos/inventario/CxP — the LIMIT/OFFSET pushdown pattern is established codebase convention.
- Inventario guard loop: `productoExisteEnEmpresa` per id → per-loop `findFirst` (`inventario-repository.ts:149-182`). Productos are empresa-scoped (`Producto.empresaId`), the branch GUC is irrelevant to this query.
- Canonical audit writer: `registrarEventoAuditoriaEnTx(tx, ctx: AuditoriaTenantAnchor, event: AuditoriaWriteEvent)`, appends one `MovimientoAuditoria.create` inside the caller's tx, `fechaHora` defaults `new Date()` (UTC), field-complete mapping incl. `event.sucursalId !== undefined ? event.sucursalId : ctx.sucursalId ?? null`.
- The 12 non-canonical sites are 12 thin named helpers whose bodies are each exactly one `movimientoAuditoria.create` (see audit-site map below); 5 module files already consume the canonical writer through `auditoria-write-port` (venta-service, cobros cobro/reembolso, auth-session).
- `registrarProductoListadoEnTx(tx, ctx, page, count, total)` — `producto-repository.ts:444-465`, writes `accion=LEER, entidad="Producto", idEntidad=String(page), valorNuevo=JSON.stringify({count, total})`; called only from `listar-productos.ts:50`.
- ConfiguracionEmpresa readers all fire the SAME predicate: `{empresaId, clave, activa: true, vigenciaInicio: {lte: fecha}, vigenciaFin: {gte: fecha}}` ×  `orderBy vigenciaInicio desc` × `select valor/clave,valor` — (venta/config-repository.ts:3 singles, reportes/config-repository.ts:1, dgii-config-repository.ts:2, compra/configuracion-repository.ts:1 findMany multi-key).
- Schema indexes: `FACTURA {empresaId, fechaEmision}` (`FACTURA_empresaId_fechaEmision_idx`) supports the board's ORDER BY + OFFSET; `MOVIMIENTO_AUDITORIA {empresaId, usuarioId, fechaHora, id}` (`..._empresaId_usuarioId_fechaHora_id_idx`) supports the M4 bounded read. `PRODUCTO` lookup already tenant-pinned; no missing index blocks any change here.

## Architecture Decisions

### Decision D1: LIMIT/OFFSET, not keyset — per repository

**Choice**: OFFSET paging everywhere (`limitePaginaSql` extends to the new queries); no keyset cursor in this change.

**Alternatives considered**: keyset cursor per query (carry `(fechaEmision, id)` for the board; `(diasVencido, saldoPendiente, facturaId)` for aging; `productoId` for rentabilidad) — rejected.

**Rationale**:

- **cobros board** — the query is index-supported for the full `WHERE empresaId + estado='VIGENTE' ORDER BY fechaEmision DESC, id DESC` plan (`FACTURA_empresaId_fechaEmision_idx`), and the outstanding wrapper filters `cobrosAplicados < total` re-using the in-row derived columns. A keyset cursor over a mutable receivable list drifts when an invoice becomes PAGADA (row disappears, cursor window shifts invisible to the user); page-number OFFSET re-serves a re-snapshot of THE same page, which the board's "reload/update" behavior (`recargar`) already assumes. Row volume: a tenant's VIGENTE invoices are realistically hundreds to low-thousands; with the composite index address, a worst-case `OFFSET 1000` scans ~1k index rows per page — far below any interactive-latency budget. YAGNI on keyset.
- **aging** — keyset would need to serialize the computed `diasVencido` expression into every cursor comparison AND handle the tie-break triple; the aging set (open receivables only, ≤ the board's size) is smaller than the invoice count. OFFSET wins on complexity.
- **rentabilidad** — rows = DISTINCT active products with sales or purchases in window (a `GROUP BY`, not raw transactions; the repository header pins this bound). Product counts per tenant are hundreds; OFFSET trivially adequate; keeping `ORDER BY p."id" ASC` makes OFFSET rock-simple.
- **estadoFacturas** — the grid is bounded by `estado × tipoNcf` (≤6 cells); a LIMIT/OFFSET tail is mechanically added for spec compliance, but no cursor/page semantics are needed (page 1 at pageSize ≥ 6 always contains the whole grid).

Keyset becomes justified only when a report's filtered set exceeds ~50k rows per tenant; none of these paths can. The specs explicitly allow "…or an equivalent keyset predicate the repository supports" — none does today anywhere in the codebase (grep-verified: no keyset/cursor idiom exists), so introducing one would be a novel architecture for zero measured need.

### Decision D2: ORDER BY extraction — how the pushed sort is pinned

**Choice**: every paginated query carries the EXACT `ORDER BY` the pre-slice sort produced, written directly in its ` infrastructure/` statement; a domain unit test pins the sort-expression equivalence; pinned page-walk tests (two page sizes, walk pages 1..3, assert no overlap/gap/order identity) guard it end-to-end.

Per query, the exact pushed ordering:

| Query | Previous pre-slice sort | Pushed ORDER BY |
|---|---|---|
| Board page (new) | canonical SQL order already emitted rows in `fechaEmision DESC, id DESC` order | `ORDER BY "fechaEmision" DESC, "id" DESC` re-applied in the OUTER wrapper (an outer wrapper CANNOT rely on inner order — Postgres row-order of subqueries is not guaranteed) |
| Aging page (new) | app sort `diasVencido DESC → saldoPendiente DESC → facturaId ASC` (cxc-aging.ts:115-119) | `ORDER BY "diasVencido" DESC, "saldoPendiente"::numeric DESC, "facturaId" ASC` where `diasVencido` is an SQL column expression mirroring `diasVencidoEnSD` |
| Rentabilidad page | none added in-app (repo already ordered `p."id" ASC`) | `ORDER BY p."id" ASC` (unchanged) + `limitePaginaSql` |
| EstadoFacturas page | none added in-app; grid is bounded | grid's existing implicit order preserved by adding `ORDER BY estado, tipoNcf` explicitly during the change (see below) + page tail |

**The computed-field case (aging `diasVencido`)** — flagged per the brief, resolved:

- `diasVencidoEnSD` (cobros/domain/en-mora.ts) yields the FULL SD-calendar-day difference between "today" (now in SD) and the SD-calendar due date (`fechaEmision + plazoCreditoDias` days). This maps 1:1 to an SQL expression USING THE SAME `AT TIME ZONE 'America/Santo_Domingo')::date` idiom the codebase already ratified in `operacional-repository.ts` (fechaSD grouping):

```sql
-- plazo resolution: client value wins when > 0, else the DB PLAZO_CREDITO param (may be 0)
CASE WHEN c."plazoCreditoDias" > 0
     THEN c."plazoCreditoDias"
     ELSE COALESCE(${dbPlazo}::int, 0)
END AS plazo_resuelto

-- diasVencido (SD calendar days; 0 when not yet due — clamped by the existing rule):
GREATEST(
  ((${now} AT TIME ZONE 'America/Santo_Domingo')::date
   - ((f."fechaEmision" + (plazo_resuelto || ' days')::interval)
      AT TIME ZONE 'America/Santo_Domingo')::date)::int,
  0)
```

- `dbPlazo` is passed as a bind: the paged use case ALWAYS fetches it via the existing `leerPlazoCreditoEnTx` (the "only when needed" conditional optimization applies to the full-set path; on a 25-row page always fetching one config row is cheaper than pre-scanning terms, and the behavior is identical).
- The scalar value must match the pure rule to the day: a domain unit test enumerates `diasVencidoEnSD({fechaEmision, plazoCreditoDias, now})` vs a mocked-SQL-equivalent evaluation over boundary fixtures (due today → 0; 1 SD day past 23:59:59 SD; DST-free zone so no DST gap cases — subtracting whole `::date` values never crosses an hour-arithmetic bug path, satisfying "no manual hour arithmetic").
- The bucket summary re-encodes ONLY the frozen boundaries as a `CASE` matching `clasificarBucketAging` (0 / ≤30 / ≤60 / >60); the equivalence is pinned by a domain unit test over day counts `0..400` (see Testing Strategy).

**Board ORDER BY in the outer wrapper** — the wrapper re-applies the identical order; a page-walk test across pages 1→3 with pageSize 25 vs 100 asserts identical row sequences (the FIN-6/R-C9 pin).

**EstadoFacturas explicit order** — the grid has no stable observable order today; the change adds an explicit deterministic `ORDER BY estado, tipoNcf` (alphabetical, matching nothing else — RELIABLE because cells are a deterministic cross-product) so `LIMIT/OFFSET` is stable. This is the one added-order change; the page-walk test covers it.

### Decision D3: page caps constant — one shared module

**Choice**: `src/shared/domain/pagination.ts` exports exactly:

```ts
/** AGENTS.md: lists ALWAYS paginated — default 25/page, hard clamps at 100. */
export const TAMANO_PAGINA_POR_DEFECTO = 25;
export const TAMANO_PAGINA_MAXIMO = 100;

/** Clamp a raw transport page size to [1, MAXIMO], defaulting to POR_DEFECTO. */
export function normalizarTamanoPagina(pageSize?: number | null): number;

/** Floor a raw transport page to >= 1 (defaulting to the first page). */
export function normalizarPagina(page?: number | null): number;

/** Zero-based row offset for the indexed query. */
export function calcularOffset(page: number, pageSize: number): number;

/** Pages a `total` needs at `pageSize` (0 when there are no rows — the
 *  `calcularTotalPages` audited semantics, not the board's min-1 variant). */
export function calcularTotalPages(total: number, pageSize: number): number;
```

Nothing re-encodes the caps after this; no consumer imports 25/100 literals.

- The AUDIT variant (min-1 `totalPages`) divergence pinned: `auditoria` legitimately documents `totalPages = 0` for empty sets (auditoria.ts:227-235). `calcularTotalPages` in shared returns 0 for empty input; the cobros board's `Pagina.totalPages` keeps its own min-1 semantics at the UI layer (the shared type below does NOT force one shape — call sites compose). The clamp behavior stated in R-QC-07 (0→25, 25→25, 250→100) is `normalizarTamanoPagina`.
- Signatures take `(page, pageSize)` numbers rather than the current `calcularOffset(filtro: Pick<AuditoriaFiltro|ReporteFiltro, "page"|"pageSize">)` object shape. NO delegating wrappers remain: every call site updates its import once and passes `(filtro.page, filtro.pageSize)` — a wrapper would be the indirection YAGNI forbids (delegated shims are how stray copies re-appear). The DEDUPLICATION COUNT grep must reach 0 (success criterion).
- `Paginacion {offset, limit}` (infrastructure SQL shape) STAYS in `operacional-repository.ts` — it is a derived data view (offset/limit bundle), not a logic copy; it is CONSTRUCTED from the shared helpers via the existing `paginacionDe(filtro)`.
- Reportes `Pagina<T>` (reporte-resultado.ts) and cobros `Pagina<T>` (ui/board.ts) stay LOCAL — each carries report-specific fields (resumen clamp/sections). The shared module is function-only; it exports no types.
- `pagina<T>` assembler duplicated at `application/operacional.ts:202` + `financiero.ts:144`: move to `reportes/domain/reporte-resultado.ts` (one reportes-local copy, exported beside the `Pagina<T>` it builds); both applications import it. NOT moved to `shared/domain` — it instantiates the reportes-local `Pagina<T>` shape.

### Decision D4: CxC board consumption shape — keep the client screen, extend the server action

**Choice**: keep `CxcBoardScreen.tsx` as a `"use client"` screen; it consumes a server action returning the page + typed metadata. Convert to a server component is rejected (bigger diff, per-component rewrite of interactivity; each bucket reload behavior would need new architectural surface).

- Server action signature (thin adapter, in `cobros/http/actions.lectura.ts`):

```ts
consultarSaldoCxcAction(input: { page?: number; pageSize?: number }): Promise<
  | { ok: true; data: { filas: readonly SaldoCxCVista[]; total: number; page: number; pageSize: number; totalPages: number } }
  | { ok: false; code: CobroErrorCode; message: string }
>;
```

- The application use case `consultarSaldoCxC` gains optional paging input `{page?, pageSize?, now?}` and returns `{ok, data: {filas, total, page, pageSize, totalPages}}` — `filas` are the page's derived `SaldoCxCVista[]` (the pure classifier + mora rules applied per page row; the batched client-terms read now covers only the page's distinct clients — a smaller read than today). The BOARD's filtered set (outstanding receivables) is one SQL wrapper query + a count query, both over the canonical block; the derived per-row facts are NEVER re-encoded in SQL.
- The paged path must produce byte-identical derived facts per row: page rows are classified purely (`clasificarEstadoPago`, `enMora`, `fechaVencimiento`) into the same `SaldoCxCVista` shape the cells render today.
- **UI consequence stated explicitly**:
  the board renders the paged `SaldoCxCVista[]` and buckets it CLIENT-side on the current page with `clasificarTableroCxc` — the section titles keep their meaning (Pendiente / Parcial / En Mora), but the per-bucket counts are page-scoped. Per-bucket totals across the WHOLE tenant are impossible without re-encoding the mora rule + due-date math in SQL — rejected (a second encoding of the SD domain rule = forbidden duplication; D2's pin absolves ordering, not the pages-per-bucket derived state). The delta's integration scenarios pin page/total/clamp/order, not per-bucket totals — so the page-scoped bucket counts are the accepted behavior change; the PR description states it.

### Decision D5: auditoria canonical writer — thin builders, no new port/abstraction, inline the .create

**Choice**: the 12 duplicated sites are not inlined into use cases; their existing named `registrarAudit*EnTx(tx, ctx, ...)` helpers KEEP their signatures and become thin builders that delegate to `registrarEventoAuditoriaEnTx(tx, ctx, { … event })`. Zero new ports, zero new abstractions (YAGNI; the audited "canonical writer" already exists with a well-behaved event type).

- `registrarEventoAuditoriaEnTx` signature does NOT change.
- The site bodies mutate from `tx.movimientoAuditoria.create({data: …})` to `registrarEventoAuditoriaEnTx(tx, ctx, event)` — the grep-verified target is: `movimientoAuditoria.create` occurrences outside `registrar-evento.repository.ts` = 0.
- Staging the builders (not inlining construction at every use case) keeps (a) module call sites untouched (smaller diff), (b) designs still carry typed payload safety (e.g. `devolucion`'s `nuevo {estado,ncf,monto,itbis}` shape), (c) test surfaces (`venta-service.test.ts` assertions over `registrarEventoAuditoriaEnTx` calls) stay stable.

The 12 sites with their event-payload mapping to the canonical signature (`event` fields):

| # | Site (`file:line`) | Existing helper | Canonical event mapping |
|---|---|---|---|
| 1 | `devolucion/infrastructure/devolucion-repository.ts:268` | `registrarAuditNotaCreditoEnTx(tx, ctx, notaCreditoId, nuevo{estado,ncf,monto,itbis}, motivo)` | `{accion: CREAR, entidad: "NotaCredito", idEntidad: String(notaCreditoId), valorAnterior: null, valorNuevo: JSON.stringify(nuevo), motivo}` |
| 2 | `venta/infrastructure/venta-repository.ts:877` | `registrarAuditFacturaEnTx(tx, ctx, facturaId, anteriores?, nuevos?, motivo?)` | `{accion: ANULAR, entidad: "Factura", idEntidad: String(facturaId), valorAnterior/Nuevo: JSON-or-null, motivo}` |
| 3 | `venta/infrastructure/venta-repository.ts:1081` | `registrarAuditVentaEnTx(tx, ctx, accion, ventaId, anteriores?, nuevos?, motivo?)` | `{accion: (param), entidad: "Venta", idEntidad: String(ventaId), ...same}` |
| 4 | `inventario/infrastructure/inventario-repository.ts:202` | `registrarAuditoriaStockEnTx(tx, ctx, inventarioId, anterior, nueva, …)` (private) | `{accion: (param: AJUSTAR/CREAR/ACTUALIZAR), entidad: "Inventario", idEntidad: String(inventarioId), valorAnterior: JSON(anterior-stock), valorNuevo: JSON(nueva-stock), motivo}` |
| 5 | `compra/infrastructure/compra-repository.ts:709` | `registrarAuditCompraEnTx(tx, ctx, accion, compraId, anteriores?, nuevos?, motivo?)` | `{accion: (param), entidad: "Compra", idEntidad: String(compraId), ...same}` |
| 6 | `categoria/infrastructure/categoria-repository.ts:245` | `registrarAuditCategoriaEnTx(tx, ctx, accion, categoriaId, ...)` | `{accion: (param), entidad: "Categoria", idEntidad: String(categoriaId)}` |
| 7 | `cliente/infrastructure/cliente-repository.ts:395` | `registrarAuditClienteEnTx(tx, ctx, accion, clienteId, ...)` | `{accion: (param), entidad: "Cliente", idEntidad: String(clienteId)}` |
| 8 | `proveedor/infrastructure/proveedor-repository.ts:308` | `registrarAuditProveedorEnTx(tx, ctx, accion, proveedorId, ...)` | `{accion: (param), entidad: "Proveedor", idEntidad: String(proveedorId)}` |
| 9 | `producto/infrastructure/producto-repository.ts:362` | `registrarProductoCreadoEnTx(tx, ctx, producto…)` | `{accion: CREAR, entidad: "Producto", idEntidad: String(producto.id), valorNuevo: {codigo, tasa} JSON}` |
| 10 | `producto/infrastructure/producto-repository.ts:394` | `registrarProductoActualizadoEnTx(tx, ctx, productoId, ...)` | `{accion: ACTUALIZAR, entidad: "Producto", idEntidad: String(productoId)}` |
| 11 | `producto/infrastructure/producto-repository.ts:425` | `registrarProductoDesactivadoEnTx(tx, ctx, productoId)` | `{accion: CANCELAR, entidad: "Producto", idEntidad: String(productoId), valorAnterior/Nuevo: {activo:…}, motivo: "producto.desactivado"}` |
| 12 | `producto/infrastructure/producto-repository.ts:451` | `registrarProductoListadoEnTx(tx, ctx, page, count, total)` | `{accion: LEER, entidad: "Producto", idEntidad: String(page), valorNuevo: JSON.stringify({count: total})}` — with M4 dedupe (D6) |

Verification per site: a record/replay unit test — run the OLD body on a recording `tx` (capturing the `create` call) and the NEW delegate on the same recording; assert fields byte-equal (`accion`, `entidad`, `idEntidad`, `motivo`, `valorAnterior`/`valorNuevo`, `sucursalId`; `fechaHora` compared type-only). Already-canonical consumers (venta-service, cobros/registrar-cobro, cobros/registrar-reembolso, auth-service) untouched.

### Decision D6: M4 dedupe mechanism — bounded read, no lock, race tolerance accepted

**Choice**: inside `registrarProductoListadoEnTx(tx, ctx, page, total)`:

1. `openWindowCut = new Date(Date.now() - 60_000)` (a UTC instant; `fechaHora` is a UTC `timestamptz` per AGENTS.md and per the AU-1 spec — the window comparison is an ABSOLUTE instant pair, no SD conversion; "today" SD semantics don't apply to an instant-window).
2. One bounded read:

```ts
const pareja = await tx.movimientoAuditoria.findFirst({
  where: {
    empresaId: ctx.empresaId, usuarioId: ctx.usuarioId,
    accion: LEER, entidad: "Producto",
    fechaHora: { gte: openWindowCut },
  },
  orderBy: [{ fechaHora: "desc" }, { id: "desc" }],  // for determinism if the read ISN'T matched
  take: 1,
});
```

3. If `pareja !== null` → return (no row appended; the open window's row stays untouched — PROD-010-C "no retro-merge", guaranteed structurally because nothing ever mutates the immutable row).
4. Else append `{ accion: LEER, entidad: "Producto", idEntidad: String(page), valorNuevo: JSON.stringify({count: total}) }` — count semantics per Engram decision `decision-m4` (obs 1069): `count = the filtered total of THE READ THAT OPENED THE WINDOW` (the listing's `total`); the per-page `items.length` no longer flows into the JSON.
- **No schema change, no auxiliary table, no rate-limiter library.**
- **Race tolerance — decided EXPLICITLY: accepted.** Two parallel listings inside the same 60s window may each resolve `pareja = null` and each append (2 rows per window edge). A `FOR UPDATE` on the candidate audit row does NOT close this race (the race is over read-ABSENCE, not a conflicting row — there is no pre-existing row two writers mutate); an "INSERT-if-absent" unique-index constraint would change the schema + error semantics, and a serializable isolation bump on a READ path is out of proportion. The tolerance is one extra bounded row per race window — accepted and documented; audit growth stays ~x60 lower than one-row-per-render either way.
- **Index justification**: the existing `MOVIMIENTO_AUDITORIA_empresaId_usuarioId_fechaHora_id_idx` composite directly serves this bounded read (equality on `empresaId` + `usuarioId`, range on `fechaHora`, tie-break `id`) — no migration needed.
- Window semantics note: "one per sliding minute" here means "at most one row per rolling-60s activity"; the NEXT row (after a ≥60s gap) opens a NEW window and records only ITS OWN read (the literal append-only fix from decision 1069 — no retro-merge, no accumulator).
### Decision D7: shared module — no `pagina<T>` / `Pagina<T>` strays

**Choice**: `src/shared/domain/pagination.ts` exports constants/functions only (D3). No shared list/container type. `Pagina<T>` stays local to its shape owner (reportes `Pagina<T>` + `resumen` in `reportes/domain/reporte-resultado.ts`; cobros UI `Pagina<T>` in `ui/board.ts`, converging on D4's server metadata shape; `ListarProductosOutput` stays the producto contract). `Paginacion {offset, limit}` stays in `operacional-repository.ts` — an infrastructure bind bundle (offset/limit), not a logic copy; each `paginacionDe(filtro)` derives it from the shared `calcularOffset`.

- The duplicated `pagina<T>` assembler (`application/operacional.ts:202` + `financiero.ts:144`) merges into ONE copy exported from `reportes/domain/reporte-resultado.ts` beside `Pagina<T>`; both applications import it. It does NOT move to `shared/domain` — it instantiates the reportes-local `Pagina<T>` shape.

### Decision D8: ConfiguracionEmpresa seam — location and exact contract

**Choice**: a `src/shared/infrastructure/configuracion-empresa.ts` one-function read seam + a zero-logic shape:

```ts
/**
 * ONE canonical CONFIGURACION_EMPRESA active-window read: the row of
 * `empresaId.clave` that is `activa: true` and whose validity window
 * (`vigenciaInicio` ≤ fecha ≤ `vigenciaFin`, ABSOLUTE timestamptz instants —
 * the comprar reader's documented reasoning) covers `fecha`'s instant.
 * Overlapping windows resolve to the NEWEST `vigenciaInicio` (R-V17).
 */
export interface FilaConfigEmpresa { readonly clave: string; readonly valor: string }
export function leerConfigsActivasEnTx(
  tx: PrismaTx,
  empresaId: number,
  claves: readonly string[],
  fecha: Date,
): Promise<ReadonlyArray<FilaConfigEmpresa>>;   // findMany (compra's multi-key shape)
export function leerConfigActivaEnTx(
  tx: PrismaTx,
  empresaId: number,
  clave: string,
  fecha: Date,
): Promise<FilaConfigEmpresa | null>;           // findFirst + newest-`vigenciaInicio` tie-break
```

- **Location**: `src/shared/infrastructure/` — not `shared/domain` (it queries Prisma), not any one module (its consumers are venta + compra + reportes×2). It is a repository-shaped adapter living outside every module and is the ONLY sanctioned row-fetch for the active-window predicate inside the caller's tenant tx; per-key VALUE-GRAMMAR validation stays in each consumer module (the seam stays free of business semantics).
- The 4 reader modules consume it as:
  - `venta/config-repository.ts` (3 singles: DESC_MAX / PLAZO_DEVOLUCION / RETROACTIVO_FECHA_VENTA_DIAS) → `leerConfigActivaEnTx(tx, empresaId, clave, fecha)`; each helper keeps its `VentaConfigError` on missing/invalid (same hard-fail semantics).
  - `reportes/config-repository.ts` (PLAZO_CREDITO, single, returns `null` on gap) → same reader; missing/invalid row → `null` (unchanged).
  - `reportes/dgii-config-repository.ts` (UMBRAL_CONSUMO_607, DGII_TIPO_INGRESO_607 — 2 singles with statutory-default fallback) → same reader; fallback semantics unchanged.
  - `compra/configuracion-repository.ts` (`leerTasasRetencionEnTx`, a **findMany** 4-key batch) → `leerConfigsActivasEnTx(tx, empresaId, claves, fecha)`; a missing required key still raises `CONFIG_RETENCION_FALTANTE`.
- **findMany vs findFirst**: BOTH exposed. `leerConfigsActivasEnTx` is ONE query serving compra's multi-key serving shape; `leerConfigActivaEnTx` carries the newest-`vigenciaInicio` tie-break for the single-key readers. Overlapping-window behavior never changes: compra's batched read selects ALL rows for the required keys and maps by `clave` (`rows.map` → map, LAST row per key arbitrarily surviving) — today's outcome depends on the seed's zero-overlap-per-key guarantee (R-V17); the seam preserves that same 1:1 outcome mapping, and the seed keeps asserting zero overlap so neither variant can be shadowed by corrupted config. Behavior-unchanged tests pin all four modules' reader shapes.
- **Cutoff instant vs SD calendar**: every CURRENT reader compares the validity window against a `timestamptz` instant (`compra/configuracion-repository.ts`'s header documents the deliberate instant comparison — no tz library, long-dated windows). The seam keeps that EXACT instant comparison; the R-QC-08 wording "cutoff date resolved in America/Santo_Domingo" is honored at the CALLER's seams: callers resolve their `fecha` via the ratified SD conversions (`domain/zona-horaria.ts` fechaEnSD/fechaSDaUTC, `en-CA`-formatted SD parts in `reporte-filtro.ts`) before passing it. The seam itself never re-derives a calendar day. Documented as the behavior-preserving reading of the spec (R-C4's own scenario pins "same window evaluation, same SD-date evaluation" — semantics-unchanged wins).

## Data Flow

```
HTTP Server Action (thin adapter)
        │  (input: {page?, pageSize?})
        ▼
withTenantTransaction ─ sets RLS GUCs (app.current_*)
        │
        ▼
application use case  ─── normalizarPagina/normalizarTamanoPagina  (shared/domain/pagination.ts)
        │                       (0/absent → 25 · 250 → 100 · floor page ≥ 1)
        ▼
infrastructure query  ───────────────── SQL filter + ORDER BY (pinned) + LIMIT/OFFSET + COUNT
        │                                                    (one page + filtered total)
        ▼
domain pure recompute (estadoPago, enMora, bucket) on the PAGE rows
        │
        ▼
typed Pagina → client screen
```

- **board (H1)**: `consultarSaldoCxcAction({page, pageSize})` → `withTenantTransaction` → `consultarSaldoCxC(tx, ctx, {page, pageSize, now})` → [count over the canonical wrapper] + [page query over the canonical wrapper] + [client-terms read for the page's clients] → pure mapping → client screen renders sections from the page.
- **aging (H2)**: screen action → `consultarCxcAging(tx, ctx, filtro, {now})`: role gate + scope (UNCHANGED) → [paged aging query (canonical fragment + CLIENTE plazo join + `dbPlazo` bind + page tail)] + [SQL bucket-summary SELECT] + [count] → pure `construirFilaAging` for THE PAGE rows (bucket/vencimiento recomputed purely); the page-independent summary rides from SQL.
- **rentabilidad (H2)**: `consultarRentabilidad(tx, ctx, filtro)` gate/widen unchanged → `rentabilidadFilasEnTx(tx, ctx, ventana, pag?)` (+ `contarRentabilidadFilasEnTx`) → `calcularFilaRentabilidad` per page row → summary unchanged (full-set metrics; the CSV path keeps reusing `leerRentabilidadCompleta` un-paged).
- **estadoFacturas (H2)**: `estadoFacturasGridEnTx(tx, ctx, ventana, pag?)` page query + the summary's own full-grid read (≤6 cells; bounded).

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `app/src/shared/domain/pagination.ts` | Create | M3 — one pure pagination contract (constants + 4 functions), consumed everywhere modules paginated |
| `app/src/modules/cobros/ui/board.ts` | Modify | M3/H1 — paginar<T> deleted; imports shared helpers (paginar consumed by board.ts only; clasificarTableroCxc kept) |
| `app/src/modules/auditoria/domain/auditoria.ts` | Modify | M3 — local pagination helpers deleted; importing shared helpers (AU-4) |
| `app/src/modules/reportes/domain/reporte-filtro.ts` | Modify | M3 — local pagination helpers (page/pageSize normalization + `calcularOffset` + `calcularTotalPages`) deleted; call sites import the shared module directly (no shim; a local filter normalization keeps only its domain work) |
| `app/src/modules/reportes/domain/reporte-resultado.ts` | Modify | M3 — the `pagina<T>` assembler lands here (ONE copy beside `Pagina<T>`) |
| `app/src/modules/reportes/application/operacional.ts` | Modify | M3 + H2 — uses shared `pagina<T>` + imported `calcularOffset`/`calcularTotalPages`; `consultarEstadoFacturas` slices dropped; new paginated grid read wiring |
| `app/src/modules/reportes/application/financiero.ts` | Modify | M3 — local `pagina<T>` and `paginacionDe` simplified to imports |
| `app/src/modules/reportes/application/cxc-aging.ts` | Modify | H2 — `consultarCxcAging` re-routed to the new paged path; `leerCxcAgingCompleto` kept for exports |
| `app/src/modules/reportes/application/rentabilidad.ts` | Modify | H2 — slice dropped; page+count from repository |
| `app/src/modules/reportes/infrastructure/operacional-repository.ts` | Modify | H2 — `estadoFacturasGridEnTx` gains the `Paginacion`-tail + explicit `ORDER BY estado, tipoNcf` |
| `app/src/modules/reportes/infrastructure/rentabilidad-repository.ts` | Modify | H2 — page tail on `rentabilidadFilasEnTx` + new `contarRentabilidadFilasEnTx` (COUNT over the same CTE-filtered join) |
| `app/src/modules/cobros/infrastructure/saldo-cxc.repository.ts` | Modify | H1 + H2 — canonical aggregate block preserved byte-identical; `consultarSaldoCxcEnTx` gains an optional page tail; new paged counter + the board's outstanding-filtered wrapper; new aging paged rows (`diasVencido` expression + CLIENTE plazo join) and the SQL bucket summary |
| `app/src/modules/cobros/application/consultar-saldo-cxc.ts` | Modify | H1 — paged board use case returning typed metadata |
| `app/src/modules/cobros/http/actions.lectura.ts` (+ `actions.ts`) | Modify | H1 — thin action carries `{page?, pageSize?}` and returns the metadata |
| `app/src/modules/cobros/ui/CxcBoardScreen.tsx` | Modify | H1 — consumes page + metadata; sections rendered from the server page |
| `app/src/modules/inventario/infrastructure/inventario-repository.ts` | Modify | M1 — batched ownership guard, one query + set-difference; locking blocks untouched |
| `app/src/modules/auditoria/infrastructure/registrar-evento.repository.ts` | Modify | Canonical writer UNCHANGED semantic (verify comments if tightened) |
| `app/src/modules/auditoria/application/auditoria-write-port.ts` | — | unchanged (re-export access point) |
| 12 audit-site helper files (map in D5; `devolucion/venta/inventario/compra/categoria/cliente/proveedor/producto` repos, 9 files) | Modify | M2 — helper bodies delegate to the canonical writer (net-negative LOC; JSON payloads byte-identical) |
| `app/src/modules/producto/infrastructure/producto-repository.ts` | Modify | M4 — `registrarProductoListadoEnTx` dedupe window-check inside the tx (+ M2 delegate) |
| `app/src/modules/producto/application/listar-productos.ts` | Modify | M4 — call passes the read's total; no other change |
| `app/src/shared/infrastructure/configuracion-empresa.ts` | Create | M5 — one canonical active-window reader seam |
| `app/src/modules/venta/infrastructure/config-repository.ts` | Modify | M5 — consume seam (DESC_MAX / PLAZO_DEVOLUCION / RETROACTIVO) |
| `app/src/modules/compra/infrastructure/configuracion-repository.ts` | Modify | M5 — consume seam (multi-key findMany) |
| `app/src/modules/reportes/infrastructure/config-repository.ts` | Modify | M5 — consume seam (PLAZO_CREDITO) |
| `app/src/modules/reportes/infrastructure/dgii-config-repository.ts` | Modify | M5 — consume seam (UMBRAL_CONSUMO_607 / DGII_TIPO_INGRESO_607) |
| versioning files (`app/package.json`, `.release-please-manifest.json`, `app/CHANGELOG.md`) | Modify | Every PR — own version bump (UTF-8 no-BOM writes only per AGENTS.md) |

No schema migrations. No new dependencies. No `git mv` renames.

## Interfaces / Contracts

```ts
// --- shared/domain/pagination.ts (NEW; pure, imports nothing project-internal) ---
TAMANO_PAGINA_POR_DEFECTO: 25; TAMANO_PAGINA_MAXIMO: 100;
normalizarTamanoPagina(pageSize?: number | null): number;
normalizarPagina(page?: number | null): number;
calcularOffset(page: number, pageSize: number): number;
calcularTotalPages(total: number, pageSize: number): number;

// --- cobros H1 (paged canonical CxC) ---

// infrastructure — the page tail rides the canonical block (opts optional)
consultarSaldoCxcEnTx(tx, ctx, opts?: { page?: number; pageSize?: number }): Promise<SaldoCxcFila[]>;
contarSaldoCxcEnTx(tx, ctx): Promise<{ total: number; pendientes: number }>;

// application — fully derived rows for ONE page (metadata typed, board-facing)
consultarSaldoCxC(tx, ctx, input?: { page?: number; pageSize?: number; now?: Date }):
  Promise<CobroResult<SaldoCxCVistaPaginated>>;   // { filas, total, page, pageSize, totalPages }

// --- reportes H2 ---
// rentabilidad: full set remains for export; page reads
rentabilidadFilasEnTx(tx, ctx, ventana, pag?: Paginacion): Promise<RentabilidadInsumo[]>;
contarRentabilidadFilasEnTx(tx, ctx, ventana): Promise<number>;

// aging — new paged read over the canonical fragment (cobros infra, consumed by reportes)
consultarSaldoCxcAgingEnTx(tx, ctx, opts: {
  page: number; pageSize: number; now: Date; dbPlazo: number | null;
}): Promise<CxcAgingFila[]>;              // one page of aged rows (pure mapping applied upstream)
resumirAgingSqlEnTx(tx, ctx, opts: { now: Date; dbPlazo: number | null }): Promise<ResumenAging>;

// operacional estadoFacturas: `estadoFacturasGridEnTx(tx, ctx, ventana, pag?)`

// --- M4 ---
registrarProductoListadoEnTx(tx, ctx, page: number, total: number): Promise<void>;
// dedupe inside; count semantics = the read's filtered total

// --- M5 ---
leerConfigActivaEnTx(tx, empresaId, clave, fecha): Promise<{clave;valor} | null>;
leerConfigsActivasEnTx(tx, empresaId, claves, fecha): Promise<ReadonlyArray<FilaConfigEmpresa>>;
```

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | Shared helpers: clamp/normalize matrix (0→25, 25→25, 250→100, page 0→1, −1→1, 2.7→2) | Plain Jest on `shared/domain/pagination.ts` |
| Unit | `pagina<T>` assembler (mover) equivalence: fixtures from the 2 former copies produce byte-equal `Pagina<T>` (incl. `totalPages` clamp semantics) | Jest, comparing e.g. `{filas, total, page, pageSize, totalPages, resumen}` across pages |
| Unit | Aging expression↔domain equivalence (the D2 pin): `diasVencidoEnSD` vs the SQL-mirrored evaluation over boundary fixtures (due today → 0, 30/31/60/61 crosses, emission-after-23:59:59-SD); SQL `CASE` bucket == `clasificarBucketAging` for day counts 0..400 | Jest — the pure half needs no DB (the SQL half is pinned in integration, below) |
| Unit | Audit builders (12 sites) replay test: OLD body shape → NEW delegate: each produces byte-equal `{accion, entidad, idEntidad, motivo, valorAnterior, valorNuevo}` (recording `tx`) | Jest (already the same style `venta-service.test.ts` uses) |
| Unit | `registrarProductoListadoEnTx` window (M4): fresh actor (no row → append); row within 60s (skip); 59.9s/60.1s boundary (deterministic via an injected `now`); different actor inside window (still appends) | Jest — recording/fake `tx` |
| Integration | Cobros board: default page/filtered total (70 VIGENTE outstanding → 25 rows + 70); pageSize 250 → 100; page 1..3 ordering NEWEST-first commit-order walk identical at pageSize 25/100 (order-pin, per-pin D2); PAGADA invoices excluded from the served set (the SQL `<total` predicate vs `clasificarEstadoPago` boundary parity) | Postgres 16, RLS, `systemfact_app`; existing suites unchanged |
| Integration | Aging page + SQL-vs-domain bucket parity: SQL `CASE` boundaries yield the same bucket/count/Σ saldo as `resumirAging` over the full sets (500+ fixtures seeded with cross-boundary emission dates); ADR-017 balance deviance probe: the derived `saldoPendiente` on paged rows == the canonical value per id | Postgres, change-scoped |
| Integration | Rentabilidad page + count: page 1..5 walks + `total` == `contarRentabilidadFilasEnTx`; REN-1 metrics on page rows vs unlocked-formula (existing suite unchanged); export path (`leerRentabilidadCompleta`) unchanged output | Postgres |
| Integration | estadoFacturas page: bounded grid normal shape; `total` serves from server-side COUNT with filters applied; ORDER BY `estado, tipoNcf` deterministic; summary (full-grid call) == page-affecting set | Postgres |
| Integration | M1 inventario batched guard: 40-id batched ownership (exactly 1 query — assertion via `tx` call record); foreign id denied by default naming ONLY the missing id; semantics identical to old (existing suites) | Postgres, RLS |
| Integration | M2: canonical writer round-trip — 12 site replay tests + the canonical path on a real tenant tx (appendo-only constraint untouched — a `MOVIMIENTO_AUDITORIA` UPDATE policy attempt still matches zero rows) | Postgres |
| Integration | M4 in-tx semantics: the dedupe read uses the SAME tx (a listing rollback aborts the audit row, exactly as today); window behavior under one concurrent burst (no deadlock; extra-row tolerance documented) | Postgres |
| Integration | M5: each config reader's scenarios (missing key → its stable code; expired window → fail; valid window → succeed) — the 4 modules' existing suites pass UNCHANGED; the seam itself pinned by its own unit/integration test | Postgres (existing suites) + grep (one seam implementation) |
| E2E (Playwright) | CxC board + reports screens: page navigation renders identical data flows | Board page scroll/bucket render — exercises H1 only; the reportes screens follow via their suites' existing contracts |
| Grep | Duplication invariants enforced in CI/review: `movimientoAuditoria.create` outside `registrar-evento.repository.ts` = 0; duplicated pagination helpers in scope = 0 (per D3/D5); DGII export paths untouched (no paging import in `exportar*`); FOR UPDATE blocks in `inventario-repository.ts` unchanged | CI grep assertions (review script) + PR checklist |

## Threat Matrix

N/A — no routing, shell, subprocess, VCS/PR automation, executable-file classification, or process-integration boundary.

## Validation checklist (requirement → file(s) → PR slice)

| Requirement | Implementing file(s) | Verifying test/suite | PR |
|---|---|---|---|
| **R-C9** (cobros board server-page, order pinned, caps, ADR-017 byte-identical) | `cobros/infrastructure/saldo-cxc.repository.ts`, `cobros/application/consultar-saldo-cxc.ts`, `cobros/http/actions.lectura.ts`, `cobros/ui/CxcBoardScreen.tsx` + `cobros/ui/board.ts` | cobros integration suite (70-case + clamp + order-pin + byte-identical grep) | PR2 |
| **FIN-6** (aging data-layer cut; exports excluded; report math unchanged) | `reportes/application/cxc-aging.ts`, new paged queries in `cobros/infrastructure/saldo-cxc.repository.ts`, `reportes/domain/aging.ts` untouched | aging integration suite + export-path ideal-no-page | PR3 |
| **OP-6** (operacional: filters ANDed, caps, page at data layer, order pinned, invalid range pre-query, exports unbounded) | `reportes/application/operacional.ts` (`consultarEstadoFacturas` slice removed), `reportes/infrastructure/operacional-repository.ts` | existing suites + estadoFacturas page test + order-pin | PR3 |
| **REN-4** (rentabilidad data-layer cut; CSV excluded; REN-1 untouched) | `reportes/application/rentabilidad.ts`, `reportes/infrastructure/rentabilidad-repository.ts` | rentabilidad integration + page-walk + export parity | PR3 |
| **R-INV-B1** (batched ownership guard; locking invariant untouched) | `inventario/infrastructure/inventario-repository.ts` (guard fn only) | existing ownership suites + 1-query assertion + foreign-id case | PR1 |
| **AU-1** (single audit writer; 12 sites byte-identical behavior) | `registrar-evento.repository.ts` (unchanged) + the 12 site helpers | replay tests per site + row-table equality | PR4 |
| **AU-4** (auditoria pagination helper absorbed) | `auditoria/domain/auditoria.ts` + `shared/domain/pagination.ts` | auditoria consultation suite + grep dup = 0 | PR1 |
| **REQ-PROD-010** (one row per actor+minute; `{count: total}`; same-tx bounded read; no mutation) | `producto/application/listar-productos.ts`, `producto/infrastructure/producto-repository.ts` | M4 unit (fake tx) + integration in-tx parity | PR4 |
| **R-QC-07** (one shared pagination contract; dup helpers 0 uniformly clamp) | `src/shared/domain/pagination.ts` + the absorbed sites | unit + grep (dup count 0) | PR1 |
| **R-QC-08** (one canonical reader; no re-encoding) | `src/shared/infrastructure/configuracion-empresa.ts` + 4 consumer repos | 4 modules' existing suites + grep (one impl) | PR5 |
| **R-C4** (venta-config behavior unchanged; `leerConfigVentaEnTx` seam consumer) | `venta/infrastructure/config-repository.ts` | existing DESC_MAX/PLAZO_DEVOLUCION/RETROACTIVO suites unchanged | PR5 |

## PR slice plan (final — incl. M4; each PR its own version bump per AGENTS.md)

| PR | Content | Est. size | Requirements implemented |
|----|---------|-----------|--------------------------|
| **PR1** | M1 (batched inventory ownership guard) + M3 (`shared/domain/pagination.ts`; absorb auditoria + reportes + financiero/operacional helpers — direct import updates at every call site, no shims) | ~150–230L | R-INV-B1, R-QC-07, AU-4 |
| **PR2** | H1 cobros board server pagination (canonical wrapper, action, application, screen) | ~180–260L | R-C9 |
| **PR3** | H2 aging + rentabilidad + estadoFacturas data-layer cuts (on PR1's helper) | ~200–300L | FIN-6, OP-6, REN-4 |
| **PR4** | M2 audit-writer consolidation (12 sites → canonical) + M4 product-listing dedupe (same PR — both are auditoria-adjacent write-surface work; M4's dedupe already lives inside the M2-consolidated helper) | ~180–260L (net-negative for M2) | AU-1, REQ-PROD-010 |
| **PR5** | M5 shared ConfiguracionEmpresa reader seam + 4 consumer repo rewrites | ~110–180L | R-QC-08, R-C4 |

Soft dependency: PR2/PR3 on PR1 (the shared helper). Slices 1–4 are individually rollback-safe; slice 5 goes last because it touches four modules' read seams after everything else has settled.

## Migration / Rollout

No migration required — no schema change, no data backfill, no feature flag. Rollback: per-PR `git revert <merge-commit>` (each PR = one coherent work unit with its own bump; the release tag follows the AGENTS.md convention). Reverting PR5 restores the four config readers' inlined predicates (no data changed); reverting PR4 re-opens the per-render audit rows (log growth resumes, no audit-semantic corruption).

## Risks carried to tasks

1. **ORDER-by pins** (D2) — every page-walk/order-pin test in PR2 (board) and PR3 (aging/rentabilidad/estadoFacturas) MUST be shipped with the diff (red → green is the pin, not a post-hoc green).
2. **Open keyset re-checks** (D1) — all four page consumers shipped as OFFSET; if a task's data check finds a tenant workload (concrete fixtures/curves) approaching tens of thousands of rows, STOP and re-open D1 (the design does NOT silently re-engineer to keyset).
3. **Board's three-bucket rendering becomes page-scoped** (D4's UI consequence) — the status quo (3 sections with per-bucket totals over the full set) is NOT preserved; reviewed against the delta scenarios (they pin page/total/clamp/order, not bucket counts) — the UI simplification must be stated in the PR description.
4. **PAGADA boundary SQL predicate parity** (D4's filter) — the SQL `applied < total` filter re-encodes the `clasificarEstadoPago`'s PAGADA threshold ONLY — its parity is pinned by a unit test over Decimal boundary fixtures (applied = total, applied = total − 0.01, applied = 0, cobros > total AND debit-note re-inflation example).
5. **`AccionAuditoria` parameter import** (D5) — each of the 12 site helpers references `AccionAuditoria` from SOMEWHERE in its module (mirror enum); PR4 tasks MUST verify each site's enum source before delegating (`{accion: acc}` body — when the local value == domain enum, direct; when a local mirror, map it in the builder).
6. **`registrarProductoListadoEnTx` signature change** (M4) — the `count` param drops; `valorNuevo` stops carrying `{count: items, total}` and carries only `{count: total}` (the corrected obs-1069 semantics). The auditoria UI is display-only (unaffected); PR4 tasks must migrate the unit tests + flag the row-shape contract change in the changelog.
7. **`estadoFacturas` summary's second full-grid read** (H2) — the page-independent summary keeps the un-paged grid read; doubling a ≤6-cell bounded read is accepted; re-open this only if the grid's identity ever expands (document, don't engineer).
8. **SD wording vs instant comparison in the config seam** (D8) — the seam compares `timestamptz` instants BECAUSE every current caller already does instant comparison (behavior-unchanged beats the literal spec paragraph wording); R-C4's "same SD-date evaluation" is inherited from the callers' ratified conversions.
9. **UTF-8 BOM rule** (AGENTS.md) — all three versioning files in every PR written with `UTF8Encoding($false)` and byte-verified (never PowerShell Set-Content -Encoding UTF8).

## Open Questions

- [ ] None blocking. The PR4 `AccionAuditoria` import-source check (risk #5) is a task-level verification, not a design-level unknown: the canonical writer's signature accepts only the domain enum, so a mismatch is a one-wrapping conversion at the site.
- [ ] The board's per-bucket page counts (D4's UI consequence) is a product-facing wording refinement deferred to sdd-tasks review — the specs do not constrain it.
