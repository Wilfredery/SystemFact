# Delta Spec — format (F0.3)

Shared DOP money and America/Santo_Domingo date formatters under `app/src/shared/ui/format/`, consolidating the duplicatedventa/cobros helpers. Binding scope: proposal §F0.3.

### Requirement: Single shared money formatter (RD$ display)

A single `formatearMonto` SHALL live at `app/src/shared/ui/format/money.ts` and produce the Dominican currency display for a `Decimal(12,2)` fixed-point string: `RD$` prefixed, comma-thousands grouping, exactly two decimals — e.g. `"1234.50"` → `RD$ 1,234.50`, `"10000"` → `RD$ 10,000.00`, `"0.00"` → `RD$ 0.00`. Out-of-domain input (`"garbage"`, `"-5"`, `""`) SHALL return verbatim, never throw, so a malformed cell never blanks a board. The behavior SHALL be locked by unit tests moved/deduplicated from the existing suites (cobros `format.test.ts` currency assertions; venta's digit-grouping assertions fold into the composed currency form).

#### Scenario: RD$ currency rendering

- **GIVEN** the canonical money strings `1234.50`, `10000`, `0`, `9999999.99`
- **WHEN** `formatearMonto` is called
- **THEN** outputs are respectively `RD$ 1,234.50`, `RD$ 10,000.00`, `RD$ 0.00`, `RD$ 9,999,999.99` (one `RD$` prefix, comma grouping, two decimals).

#### Scenario: Out-of-domain input verbatim

- **GIVEN** inputs `"garbage"`, `"1.234"`, `"-5"`, `""`
- **WHEN** `formatearMonto` is called
- **THEN** each input is returned verbatim (including for empty string) — display boundary never throws or blanks.

#### Scenario: No double currency prefix in venta

- **GIVEN** venta UI call sites (Totales, CartTable, DraftList) previously rendering `RD$ {formatearMonto(...)}` against the digits-only helper
- **WHEN** they are rewired to the shared formatter
- **THEN** the rendered total contains exactly one `RD$` occurrence and the identical numeric grouping as before (behavior-preserving: `RD$` literal removed from call sites, provided by the shared formatter).

### Requirement: Single shared SD date formatter (dd/MM/yyyy from UTC instants)

A single `formatearFechaSD` SHALL live at `app/src/shared/ui/format/date.ts`. It SHALL convert a UTC-stored timestamp (`string | Date`, ISO) to the America/Santo_Domingo calendar day using `date-fns-tz` (successor to the venta `fecha.ts` Intl approach) and render it as short Dominican form `dd/MM/yyyy`; it SHALL also accept an already-SD-resolved bare date string `YYYY-MM-DD` as carried by cobros, rendering the same day unchanged. No manual hour arithmetic anywhere (no `addHours`/`getHours` math); fallback to `—` for empty/unparseable input.

#### Scenario: UTC instant resolves to SD calendar day in dd/MM/yyyy

- **GIVEN** `2026-01-01T02:30:00.000Z` (UTC) — in the UTC-4 business zone that instant falls on `2025-12-31` at 22:30
- **WHEN** `formatearFechaSD` receives it
- **THEN** the output is `31/12/2025` (zero-padded two-digit day and month, 4-digit year).

#### Scenario: Same-day UTC instant stays exact

- **GIVEN** `2026-10-13T14:00:00.000Z` → `13:00` SD on `2026-10-13`
- **WHEN** `formatearFechaSD` receives it
- **THEN** the output is `13/10/2026`.

#### Scenario: Bare SD date string renders unchanged

- **GIVEN** the cobros domain output `2026-01-31` (already a Santo-Domingo calendar date, not an instant)
- **WHEN** `formatearFechaSD` receives it
- **THEN** the output is `31/01/2026` with no double timezone shift.

#### Scenario: Unparseable/empty input fallback

- **GIVEN** `""`, `"not-a-date"`
- **WHEN** `formatearFechaSD` receives either
- **THEN** the output is `—`.

### Requirement: Deduplication rewiring (no duplicates left, DGII untouched)

After this sub-slice SHALL hold: (a) no `formatearMonto` export on `venta/ui/carro.ts`; (b) `cobros/ui/format.ts` deleted (its `formatearMontoDO`/`formatearFechaDO` call sites — `PaymentForm`, `ReciboReprintScreen`, `EstadoDeCuentaScreen`, `CxcBoardScreen`, cobros/reportes panels — import from `shared/ui/format`); (c) `venta/ui/fecha.ts` deleted, its consumers import from `shared/ui/format`; (d) `venta/ui/formatearMonto.test.ts` and `cobros/ui/format.test.ts` relocate/consolidate under `app/src/shared/ui/format/`; and (e) `reportes/domain/dgii/formato.ts` `formatearMonto` (fixed-width fiscal export) remains untouched — different semantic, stays in its domain.

#### Scenario: Duplicate helpers are gone

- **GIVEN** the repo after the change
- **WHEN** `src/modules/venta/ui/carro.ts`, `src/modules/cobros/ui/format.ts`, `src/modules/venta/ui/fecha.ts` are searched
- **THEN** carro.ts exports no money/date format helpers, and the two duplicated format modules do not exist; every former consumer resolves to `shared/ui/format`.

#### Scenario: DGII fiscal formatter is not touched

- **GIVEN** `reportes/domain/dgii/formato.ts`
- **WHEN** the change diff is examined
- **THEN** that file (and its tests) is unchanged; the DGII fixed-width formatter keeps zero-left padding semantics distinct from the display formatter.

#### Scenario: Tests follow the formatters

- **GIVEN** `app/src/shared/ui/format/`
- **WHEN** unit tests run (`pnpm test` workspace)
- **THEN** the money and date contracts pass there, and no stray test file still imports the deleted modules (no dangling imports; typecheck green).

### Requirement: YAGNI for format

F0.3 SHALL NOT create locale-parameterized clusters, third currency, a generic `format.ts` bag, or convert dates to/from any other timezone; only DOP display money and SD display dates.

#### Scenario: No speculative API

- **GIVEN** the shared format module
- **WHEN** its exports are listed
- **THEN** exactly the two display helpers (`formatearMonto`, `formatearFechaSD`) plus their local constants exist — no `formatValue(valor, locale?, options?)` knobs.
