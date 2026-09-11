# Factura Emision Specification

## Purpose

Automatic `FACTURA` emission at sale confirm. Gates emission on `Empresa.facturaAutomatica` (D1b: false ⇒ stable error, no deferred-emission use case), selects B01/B02 by local eligibility (D2a, no DGII lookup; D6 fiscal-id untouched), and writes a `VIGENTE` invoice with recomputed gravado/exento and `FAC-%06d` correlativo. Payment state stays derived (D3/ADR-017). Cancellation transition of the invoice is specified in the venta delta.

## Requirements

### Requirement: Automatic emission gated on facturaAutomatica (R-F1)

On `confirmarVenta`, when `empresa.facturaAutomatica=true` a `FACTURA` MUST be created inside the same tenant transaction; when `false` confirm MUST hard-fail `FACTURA_AUTOMATICA_FALTA` (no partial state, no deferred emission — D1b). The invoice MUST be `estado=VIGENTE`, linked 1:1 to the sale via `ventaId`, carrying `empresaId` and the session `sucursalId` (branch-scoped write — RLS sucursal GUC MUST be restored before this write).

#### Scenario: Automatic invoice created on confirm

- GIVEN a confirmed sale for an empresa with `facturaAutomatica=true`
- WHEN the FACTURA row is written
- THEN one `VIGENTE` invoice exists for the sale, correct branch, exactly one `ventaId`
- TEST: integration

#### Scenario: Non-automatic blocks confirm

- GIVEN `facturaAutomatica=false`
- WHEN confirm runs
- THEN `FACTURA_AUTOMATICA_FALTA` returns and the sale stays `BORRADOR` with no NCF consumed and no invoice
- TEST: integration

### Requirement: B01/B02 eligibility (D2a) (R-F2)

Invoice `tipoNcf` MUST be B01 when the client has a valid **9-digit RNC** (validated by the existing `shared/domain/fiscal-id.ts` mod-11 path) AND is not the Consumidor Final row; otherwise B02. NO DGII portal lookup and NO new corporate 11-digit validation (D6: `fiscal-id.ts` unchanged; open item escalated, not resolved here). Misclassification risk is a documented V1 limitation.

#### Scenario: Taxpayer client gets B01

- GIVEN a named client with a valid 9-digit RNC
- WHEN confirm selects the type
- THEN B01 is chosen and the B01 sequence is consumed
- TEST: unit (pure eligibility decision)

#### Scenario: Consumidor final gets B02

- GIVEN the sale resolves to the empresa's Consumidor Final row (or client without a valid 9-digit RNC)
- WHEN confirm selects the type
- THEN B02 is chosen
- TEST: unit

### Requirement: Invoice amounts recomputed from persisted lines (R-F3)

`subtotalGravado`/`subtotalExento`/`itbis`/`total` MUST be re-derived server-side from the persisted `DETALLE_VENTA` rows using the frozen venta calculators (16% lines count as gravado); client-supplied totals MUST NOT be trusted. Money MUST be `Decimal` with the identity `total = subtotal − descuento + itbis` holding exactly. `correlativoInterno` MUST be a per-empresa `FAC-%06d` allocated atomically (empresa row-lock precedent), never from the sale payload.

#### Scenario: Mixed-rate invoice breakdown

- GIVEN a persisted draft with 18%, 16%, and 0% lines and a header discount
- WHEN the invoice rows are computed
- THEN gravado = Σ(18%+16% bases), exento = Σ(0% bases), `itbis`/`total` match the calculator, and a `FAC-%06d` correlativo is assigned
- TEST: integration

#### Scenario: Correlativo allocation is atomic

- GIVEN two parallel confirms on the same empresa
- WHEN each allocates `correlativoInterno`
- THEN both receive distinct `FAC-%06d` values with no duplication
- TEST: integration (concurrency)

### Requirement: Payment state stays derived (D3/ADR-017) (R-F4)

Emission MUST NOT materialize or cache any payment/balance column; the invoice balance MUST remain computed from the canonical derivation over valid documents. No Pago is created here (Fase 6).

#### Scenario: No stored balance on emission

- GIVEN a newly emitted `VIGENTE` invoice
- WHEN the row is inspected
- THEN no persisted paid/balance state exists (derivation only)
- TEST: integration
