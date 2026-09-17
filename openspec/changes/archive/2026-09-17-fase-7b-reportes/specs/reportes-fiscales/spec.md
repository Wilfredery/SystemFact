# Reportes-Fiscales Specification

## Purpose

Fiscal report fleet (slice E) per AC docs/15 §8.9 "Reportes fiscales": ITBIS por período, IT-1 data summary, and DGII Formatos 606/607/608 screens plus TXT exporters built from the research lane digest (U1–U5 pinned as acceptance criteria).

## Requirements

### Requirement: FIS-1 — ITBIS summary per period

The system MUST show, per SD-calendar period: ITBIS facturado on VIGENTE `Factura` plus Nota de Crédito / Nota de Débito NCF adjustments, and ITBIS/ISR retenido on `Compra`; B11 informal purchases produce **no ITBIS credit** and this MUST be documented in-report.

#### Scenario: Mixed-rate period totals

- GIVEN invoices with 18%, 16% and 0% ITBIS lines plus a B04 credit note
- WHEN the ITBIS summary renders
- THEN bases and ITBIS per rate reconcile to document totals and the NC reduces débito
- TEST: integration

### Requirement: FIS-2 — IT-1 is a data summary, never a TXT

IT-1 MUST be rendered as a casilla worksheet for manual OFV entry: débito fiscal = Σ607 ITBIS facturado; crédito/ITBIS por adelantar from 606 aggregates; **ITBIS retenido = Σ606 retenido, self-checked to equal IT-1 casilla 60**; neto a pagar; plus day-20 due-date guidance text. The system MUST NOT generate or claim any "IT-1 TXT" file — DGII accepts none.

#### Scenario: Casilla cross-check

- GIVEN a period with supplier ITBIS retentions
- WHEN the IT-1 worksheet renders
- THEN its retenido figure equals the Σ of 606 ITBIS Retenido and a mismatch is surfaced as a validation warning
- TEST: integration

### Requirement: FIS-3 — Formato 607 layout (ventas)

607 TXT MUST cover VIGENTE B01/B02/B03/B04, with B02 (consumo) detailed only when total ≥ RD$250,000 (boundary inclusive — ≥). Header: `CODIGO_INFORMACION`("607") · `RNC_CEDULA` A11 space-padded · `PERIODO` N6 AAAAMM · `CANTIDAD_REGISTROS` ≤65,000 per file (split beyond) · `TOTAL_MONTO_FACTURADO` N16. Detail, 23 columns in order: buyer RNC/Céd A11 · TipoId 1|2|3 · NCF A11 **with 2-char prefix** · NCF-Modificado · Tipo-Ingreso code · FechaComp AAAAMMDD · FechaRetención · MontoFacturado · ITBISFacturado · ITBISRetenidoTerceros · ITBISPercibido · RetRentaTerceros · ISRPercibido · ISC · OtrosImp · PropinaLegal · Efectivo · Cheque/Transfer · Tarjeta · VentaCrédito · Bonos · Permuta · OtrasFormas. D17–D23 (gross incl. ITBIS) MUST cross-foot to the invoice total exactly.

#### Scenario: B02 threshold boundary

- GIVEN B02 consumption invoices of RD$250,000.00 and RD$249,999.00 in the period
- WHEN 607 is generated
- THEN the first is a detail row, the second is excluded
- TEST: unit (domain scope predicate)

#### Scenario: Payment-mode cross-foot

- GIVEN an invoice split across cash, card and credit payments
- WHEN its detail row is assembled
- THEN D17+D18+D19+D20 equals the gross total to the cent
- TEST: unit

### Requirement: FIS-4 — Formato 606 layout (compras)

606 TXT source MUST be `Compra` with estado ∈ {RECIBIDA, PAGADA} only (BORRADOR/PENDIENTE/CANCELADA excluded). Header: same 5-field shape with code "606". Detail (current ~23-col layout): proveedor RNC/TipoId · TipoBienesServicios 01–11 · NCF · NCF-Modificado · FechaComp · FechaPago · MontoServicios · MontoBienes · ITBISFacturado · ITBISRetenido · ITBIS-Proporcionalidad art.349 · ITBIS-al-Costo · ITBIS-por-Adelantar (derived) · ITBISPercibido · TipoRetenciónISR 1–8 · MontoRetenciónRenta · ISRPercibido · ISC · OtrosImp · Propina · FormaPago 01–07.

#### Scenario: Draft purchase excluded

- GIVEN one PENDIENTE and one RECIBIDA purchase from the same supplier
- WHEN 606 is generated
- THEN only the RECIBIDA document produces a detail row
- TEST: integration

### Requirement: FIS-5 — Formato 608 scope decision (binding)

608 MUST report `Factura`/comprobante with `estadoFiscal = ANULADA` only, with 3 detail columns: NCF A11 · FechaComp AAAAMMDD (original issue) · TipoAnulación code 1–10 (mapped from `Anulacion.motivo`). **`CANCELADA` documents appear in NEITHER 607 nor 608** — no fiscal effect, NCF never issued.

#### Scenario: Cancelada in no file

- GIVEN one ANULADA and one CANCELADA factura with consumed NCFs in the period
- WHEN 607 and 608 TXT are generated
- THEN the ANULADA appears only in 608 and the CANCELADA appears in neither
- TEST: integration

### Requirement: FIS-6 — DGII pre-validation acceptance criteria (U1–U5)

Every generated 606/607/608 TXT MUST pass the DGII Herramienta de Pre-Validación with **zero errors** before slice E ships. Encoding UTF-8/ASCII, no BOM, consistent across the file; layout fixed-width space-delimited — **pipe-delimited is rejected (U6), MUST NOT be implemented**; filename `DGII_F_<code>_<RNC>_<AAAAMM>.TXT`; an empty period MUST still produce an en-cero file; record caps enforced with deterministic multi-file splits (607 ≤65,000; 606 cap per U5 tool confirmation; 608 ≤4,999).

#### Scenario: Zero-activity period

- GIVEN a month with no fiscal documents at all
- WHEN the exporter runs for it
- THEN a valid en-cero file (header, CANTIDAD_REGISTROS=0) is produced
- TEST: unit

#### Scenario: Cap-exceeding split

- GIVEN more detail records than the format cap
- WHEN the export runs
- THEN multiple files are produced, each within cap, counts summing to the full register
- TEST: unit
