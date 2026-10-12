# Delta for producto

## MODIFIED Requirements

### Requirement: REQ-PROD-010: Observability events

The Producto module SHALL emit observability events: `producto.created` (with `codigo`, `tasa`) and `producto.listed` (throttled: at most one audit row per actor per one-minute sliding window, with a `{ count: total }` payload for the read that opened the window).

**Rationale**: AGENTS.md mandates an append-only audit log for every state-changing action and for significant reads. These events feed that log. Emitting one `producto.listed` row per page render permanently inflated the append-only log with pagination navigation; the actor+minute window keeps the significant-read signal while bounding growth (~x60+ vs one row per render). (Previously: one `producto.listed` audit row with `{ count }` was appended for every successful `listarProductos` page render.)

**Acceptance criteria**:
- `producto.created` is emitted after a successful `crearProducto` (unchanged from PROD-010-A).
- `producto.listed` is aggregated: at most one audit row is appended per actor per one-minute sliding window (the actor's `usuarioId` delimits the window; the accion used is the `LEER` enum value ratified by migration `20260905000000_add_leer_accion_auditoria`).
- The appended row's payload carries `{ count: total }` — the total of items served by the `listarProductos` read that opened the window. Reads performed inside an already-open window append no row and their items are NOT retro-merged into the open row: with a strictly append-only log there is no mutation channel to merge future reads; window granularity trades that per-page detail for bounded growth, and this trade-off is accepted here.
- The aggregation decision executes a bounded read of the actor's last `producto.listed` audit row inside the same read transaction as the listing query; no schema change and no auxiliary table are introduced.
- The append-only audit contract is untouched: no UPDATE or DELETE ever modifies existing audit rows as part of the aggregation.

**Scenarios**:

#### Scenario: PROD-010-A: product created event (unchanged)

- Given a successful `crearProducto(ctx, input)`
- When the use case completes
- Then an audit row with event `producto.created` and payload `{ codigo, tasa }` is appended

#### Scenario: PROD-010-B: product listed event aggregated per actor+minute window

- Given an actor whose last `producto.listed` audit row is older than one minute
- When a successful `listarProductos(ctx, query)` completes
- Then exactly one new audit row with event `producto.listed` and payload `{ count: <total> }` is appended

#### Scenario: PROD-010-C: repeated listing inside the window adds no row

- Given an actor with a `producto.listed` audit row created less than one minute ago
- When the same actor lists products again
- Then no new audit row is appended for that read
- AND the open window's row still reflects exactly the items served by the read that opened it, without any UPDATE or DELETE ever touching existing audit rows

#### Scenario: PROD-010-D: append-only contract preserved by aggregation

- Given the aggregation emits bounded rows per actor+minute window
- When the audit rows produced are inspected
- THEN every row is append-created only; no code path updates or deletes any audit row
