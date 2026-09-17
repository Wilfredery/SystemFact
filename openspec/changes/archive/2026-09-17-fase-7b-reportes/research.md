<!--
gentle-ai.sdd-research/v1
revision: 1
outcome: partial
change: fase-7b-reportes
lane: DGII fiscal report formats (IT-1, Formato 606, 607, 608)
generated: 2026-09-16
-->

# Research — DGII Fiscal Report Formats (606 / 607 / 608 / IT-1)

**SDD change:** `fase-7b-reportes` · **Lane:** DGII fiscal report formats (gates slice E: fiscal reports + DGII export)
**Outcome:** `partial` (complete column layouts for 607/606/608 at the *field-name / order / logical-type* level are verified; exact fixed-width **byte** offsets and **file encoding** are NOT authoritatively pinned and must be validated against the DGII pre-validation tool during implementation; the exact "Tipo de Ingreso" (607) and "Tipo de Bienes/Servicios" (606) code tables are partially verified.)
**Capability grants observed:** `open-web` (websearch + webfetch available and used), `documentation` (repo read/grep). Admission: granted.
**Generated date / retrieved date:** 2026-09-16 (all sources accessed on this date unless noted).

---

## 1. Research questions & search strategy

**Questions (from orchestrator):**
1. Formato 607 — exact columns, order, field meanings, file format (TXT/encoding/delimiter), submission rules.
2. Formato 606 — same.
3. Formato 608 — columns, cancelation codes, date requirements, scope; reconcile with SystemFact `Cancelada` vs `Anulada` semantics.
4. IT-1 — data needs (ITBIS facturado, ITBIS retenido/compras, neto a pagar), period rules, and whether "exportar IT-1" is a TXT layout or a data summary.
5. NCF type mapping (B01/B02/B03/B04/B11/B15…) driving columns; ITBIS third-party retention (IR-17) effect on 606.
6. Whether ITBIS 16% / 0% (export/registered) change column semantics.

**Search strategy — what worked / failed:**
- `websearch` scoped to DGII official PDFs (`dgii.gov.do/legislacion/normasGenerales/...`, `dgii.gov.do/publicacionesOficiales/...`) → **worked**: surfaced the governing norms (NG 06-2014, NG 07-2018) and the per-format instructivos with column tables in their search highlights.
- `webfetch` of the DGII instructivo PDFs (607, 608) → **failed**: PDFs exceed the 5 MB tool limit; content not retrievable as text directly.
- `webfetch` of `Norma07-18.pdf` → returned raw PDF byte stream (FlateDecode), not extractable inline; the Annex tables were nevertheless obtained via the norm's search index highlights and corroborating secondary mirrors.
- In-repo docs (`docs/01,02,03,05,06,11,13`, `docs/erd-guia.md`) → **worked**: already encodes Cancelada/Anulada → 607/608 semantics, NCF types, ITBIS 18/16/0, retention rules; reused as the product-semantics source (not as an external authority).
- **Contradiction encountered and resolved by authority:** one 2026 secondary source (TuFacturaRD) claims TXT is pipe (`|`)-delimited; the official norms (NG 06-2014, NG 07-2018) specify **space-delimited / fixed-width**. Official wins; pipe claim logged as a contradiction and NOT adopted.

### Source register

| id | class | title | publisher | URL | accessed |
|---|---|---|---|---|---|
| S1 | official | Formatos de Envío de Datos (606/607/608 scope + pre-validación) | DGII | https://dgii.gov.do/cicloContribuyente/obligacionesTributarias/remisionInformacion/Paginas/formatoEnvioDatos.aspx | 2026-09-16 |
| S2 | official | Norma General 06-2014 (column tables 606/607; "Texto delimitado por espacios") | DGII | https://dgii.gov.do/legislacion/normasGenerales/Documents/NG%20sobre%20Comprobantes%20Fiscales/norma06-14.pdf | 2026-09-16 |
| S3 | official | Norma General 07-2018 (Anexo A=606, Anexo B=607; NCF 11 posiciones; Art. 3–5 remit 607/606/608) | DGII | https://dgii.gov.do/legislacion/normasGenerales/Documents/NG%20sobre%20Comprobantes%20Fiscales/Norma07-18.pdf | 2026-09-16 |
| S4 | official | Instructivo Llenado y Remisión 607 (Norma 07-2018 y 05-2019; 23 casillas detalle) | DGII | https://dgii.gov.do/publicacionesOficiales/bibliotecaVirtual/contribuyentes/formatoEnvioDatos/Documents/5-InstructivoLlenadoyenvioFomato607.pdf | 2026-09-16 |
| S5 | official | Instructivo 606 (hasta abril 2018; 19-pos NCF legacy) | DGII | https://dgii.gov.do/publicacionesOficiales/bibliotecaVirtual/contribuyentes/formatoEnvioDatos/Documents/6-Instructivodellenadoyenv%C3%ADoFormato606.pdf | 2026-09-16 |
| S6 | official | Instructivo 608 (NCF anulados; tipos anulación 1–10; ≤4,999 registros) | DGII | https://dgii.gov.do/publicacionesOficiales/bibliotecaVirtual/contribuyentes/formatoEnvioDatos/Documents/3-Instructivo-de-llenado-y-env%C3%ADo-Formato-608.pdf | 2026-09-16 |
| S7 | official | Guía Informativa sobre Formatos de Envío de Datos (scope all formats) | DGII | https://dgii.gov.do/publicacionesOficiales/bibliotecaVirtual/contribuyentes/formatoEnvioDatos/Documents/1-Guia-Informativa-sobre-los-Fomatos-Envio-de-Datos.pdf | 2026-09-16 |
| S8 | official | Instructivo Llenado IT-1 (2019 vigente; casillas, Anexo A/ITA, cross-checks 606/607) | DGII | https://dgii.gov.do/publicacionesOficiales/bibliotecaVirtual/contribuyentes/itbis/Documents/5-InstructivoLlenadoIT-1-2019.pdf | 2026-09-16 |
| S9 | official | Instructivo Envío IT-1 (OFV) | DGII | https://dgii.gov.do/publicacionesOficiales/bibliotecaVirtual/contribuyentes/itbis/Documents/8-InstructivoEnvioITBIS(IT-1)OFV.pdf | 2026-09-16 |
| S10 | secondary (mirror) | 606 layout example (fixed-width, space/zero padded) | rd77.com | http://rd77.com/606_COMPRAS_BIENES_SERVICIOS.pdf | 2026-09-16 |
| S11 | secondary | Reportes 606/607/608 RD 2026 (current 606 fields: proporcionalidad art.349, ITBIS al costo, forma de pago) | Alegra | https://blog.alegra.com/republica-dominicana/reportes-contables-606-607-608/ | 2026-09-16 |
| S12 | secondary | Formato 607 contenido (Norma 7-2018) — mirrors Anexo B column set | Baker Tilly / Red Solidarios | https://www.redsolidarios.org/images/documentos/eventos/Taller_de_Actualizacion_por_Baker_Tilly/Actualizacion_Fiscal_Resumida_-_Solidarios.pdf | 2026-09-16 |
| S13 | secondary | Guía 606 paso a paso (current detail fields incl. bien/servicio split) | miscuentasrd | https://miscuentasrd.com/blog/como-hacer-606-607-dgii | 2026-09-16 |
| S14 | **secondary — CONTRADICTORY** | Claims TXT separated by pipes (`|`) | TuFacturaRD | https://tufacturard.com/blog/guia-completa-606-607-dgii-2026/ | 2026-09-16 |
| SR | in-repo (product) | Cancelada/Anulada→607/608, NCF types, ITBIS 18/16/0, retenciones | SystemFact docs | docs/01,02,03,05,06,11,13, erd-guia.md | n/a |

---

## 2. File format requirements (common to 606 / 607 / 608)

> Confidence: **structure high, exact byte offsets + encoding = UNVERIFIED.**

- **Type:** plain text **TXT** (`.txt`) file, produced by the official DGII Excel template ("Generar Archivo") or by software replicating the layout. [S2][S3][S4][S6]
- **Encoding:** NOT explicitly stated in the specs retrieved. Treat as **UNVERIFIED** (see §7). Likely single-byte ASCII/Windows-1252 with CRLF line endings (no BOM), but this MUST be validated against the DGII **Herramienta de Pre-Validación** before shipping. [S1]
- **Delimiter / layout:** **fixed-width fields**, described by the official norm as *"Texto delimitado por espacios"*. Fields are **padded**: alphanumeric (RNC/Cédula) right-padded with **spaces** to the field length; numeric zero-**left**-padded; amounts include the decimal point within their declared length (e.g. `0000004000.00`). **Contradiction:** S14 (secondary) claims pipe (`|`)-delimited — **rejected**; the official norm specifies space-delimited fixed width. [S2][S10]
- **Header vs detail:** one **encabezado** (header) record followed by N **detalle** (detail) records, all in a **single file with NO separator line** between header and details; the header line is NOT counted in `CANTIDAD_REGISTROS`. [S2][S10]
- **Field-length rule:** *"Las longitudes de los campos no pueden ser diferentes a las anteriormente descritas"* — every field must be present even if zero/blank. `RNC_CEDULA` must never be zero/blank and never contain dashes/special chars. [S2]
- **Filename convention (observed):** `DGII_F_<606|607>_<RNC>_<AAAAMM>.TXT` (e.g. `DGII_F_607_130000000_201807.TXT`). [S4]
- **Decimals:** use a **period (`.`)** for centavos (e.g. `RD$10.18`). [S4]
- **Dates:** `AAAAMMDD` (8 numeric) in detail; period `AAAAMM` (6 numeric) in header. [S2][S4][S6]
- **Record caps (per file):** 607 ≤ **65,000** (legacy 10,000), 606 ≤ (legacy 10,000; current larger — exact cap UNVERIFIED), 608 ≤ **4,999**. When exceeded, split into multiple files. [S4][S6]
- **Submission channel:** upload the TXT in the **Oficina Virtual (OFV)** → *Formatos de Envío › Enviar Archivos*, selecting the format type + period. Files **must be pre-validated** with the DGII tool (applies to 606, 607, 608). Zero-operations periods are filed "informativa / en cero" via *Declaraciones en Cero*. [S1][S6][S7]

---

## 3. Formato 607 — Ventas / income register

**Scope [S1][S3][S7]:** sales/operations effected by the NCF-issuing taxpayer (persons jurídicas/físicas, negocios de único dueño, entidades estatales). Also carries **retentions of ITBIS and ISR performed by third parties** in the taxpayer's favor (sustained on facturas de crédito / comprobantes especiales). **Facturas de consumo (B02)** are detailed **only when ≥ RD$250,000** (from fiscal period July 2018, Norma 10-18; was ≥ RD$50,000 for May–Jun 2018); the rest go into the separate OFV consumption **summary** module. [S7]
**Deadline [S4]:** to the **15th** of the following month (current), previously day 20. Must be sent **before** the IT-1 filing.

### 607 Encabezado (header record)
| # | Field | Type | Length | Notes / source |
|---|---|---|---|---|
| H1 | CODIGO_INFORMACION | N | 3 | literal `607` [S2][S3] |
| H2 | RNC_CEDULA | A | 11 | remitter's RNC/Cédula, space-padded, no dashes, never blank [S2] |
| H3 | PERIODO | N | 6 | `AAAAMM` [S2][S4] |
| H4 | CANTIDAD_REGISTROS | N | 12 | count of detail records, **≤ 65,000**, zero-left-padded [S2][S4] |
| H5 | TOTAL_MONTO_FACTURADO | N | 16 | Σ of detail Monto Facturado (base, no ITBIS), decimal point counted in length [S2] |

### 607 Detalle (detail record) — 23 columns
| # | Column (DGII name) | Type | Len | Meaning | Source |
|---|---|---|---|---|---|
| D1 | RNC/Cédula del adquirente | A | 11 | buyer's RNC/Cédula (blank/`3` for unidentified final consumer) | [S2][S4] |
| D2 | Tipo Identificación | N | 1 | 1=RNC, 2=Cédula, 3=sin identificación (solo consumidor final) | [S2][S4] |
| D3 | Número Comprobante Fiscal | A | 11 | full NCF **including 2-char type prefix** (e.g. `B0100000123`); 19 positions only for pre-May-2018 | [S3][S4] |
| D4 | Número Comprobante Modificado | A | 11 | NCF affected by a Nota de Débito/Crédito (blank if none) | [S4] |
| D5 | Tipo de Ingreso | N | (code) | income classification code (see §5 — exact 1–6 table PARTIAL) | [S4][S11] |
| D6 | Fecha Comprobante | N | 8 | sale date `AAAAMMDD` | [S2][S4] |
| D7 | Fecha de Retención | N | 8 | date third party applied ITBIS/ISR retention; blank if none | [S4] |
| D8 | Monto Facturado | N | 12 | sale value **excluding** ITBIS/other taxes | [S2][S4] |
| D9 | ITBIS Facturado | N | 12 | ITBIS charged on the document (18/16/0 — amount only, no rate col) | [S2][S4] |
| D10 | ITBIS Retenido por Terceros | N | 12 | ITBIS withheld from the taxpayer by a client (needs D7) | [S4] |
| D11 | ITBIS Percibido | N | 12 | ITBIS the taxpayer withheld/collected as advance (as agent) | [S4] |
| D12 | Retención Renta por Terceros | N | 12 | ISR withheld from the taxpayer by a client (needs D7) | [S4] |
| D13 | ISR Percibido | N | 12 | ISR collected as advance by the taxpayer | [S4] |
| D14 | Impuesto Selectivo al Consumo | N | 12 | ISC on ISC-gravada sale | [S4][S12] |
| D15 | Otros Impuestos/Tasas | N | 12 | other taxes/fees part of the document value | [S4][S12] |
| D16 | Monto Propina Legal | N | 12 | legal tip (Ley 54-32, 10%) | [S4][S12] |
| D17 | Efectivo | N | 12 | payment portion **incl. ITBIS** received cash | [S4][S12] |
| D18 | Cheque/Transferencia/Depósito | N | 12 | bank-payment portion incl. taxes | [S4][S12] |
| D19 | Tarjeta Débito/Crédito | N | 12 | card portion incl. taxes | [S4][S12] |
| D20 | Venta a Crédito | N | 12 | credit portion incl. taxes | [S4][S12] |
| D21 | Bonos o Certificados de Regalo | N | 12 | gift-voucher portion | [S4][S12] |
| D22 | Permuta | N | 12 | barter portion | [S4][S12] |
| D23 | Otras Formas de Ventas | N | 12 | other payment forms | [S4][S12] |

**Payment-mode cross-foot (D17–D23):** their sum **must equal the gross invoice total incl. ITBIS** ("ni un centavo más, ni uno menos"). Only applicable modes are filled; not all are mandatory. [S4][S11] *(The Excel template also shows a trailing "Estatus" column for validation messages — it is **not** part of the TXT.)* [S12]

---

## 4. Formato 606 — Compras / expenses register

**Scope [S1][S3][S7]:** costs & expenses for ISR purposes; ITBIS advances used as credit; **retentions of ITBIS and ISR the taxpayer applied to third parties** (i.e. as withholding agent); perceptions; ITBIS carried to cost; detail of purchases. Must be filed **before the ITBIS (IT-1) deadline** so the advances-as-credit are accepted. [S1]
**Deadline [S11]:** before the **15th** of the following month.

### 606 Encabezado (header)
Same 5-field shape as 607 with `CODIGO_INFORMACION = 606`. [S2][S10]
`RNC_CEDULA` A11 · `PERIODO` N6 · `CANTIDAD_REGISTROS` N (legacy cap 10,000; current cap UNVERIFIED) · `TOTAL_MONTO_FACTURADO` N16 (Σ bien+servicio base). [S2][S10][S13]

### 606 Detalle (detail record) — current layout
Ordered per the current instructivo [S13] with legacy fixed-width types from NG 06-2014 [S2][S10]. Fields marked *auto* are computed by the template at validate time (software must still emit the underlying components).

| # | Column | Type | Meaning | Source |
|---|---|---|---|---|
| D1 | RNC/Cédula del proveedor | A 11 | supplier's RNC/Cédula, space-padded, never blank | [S2][S13] |
| D2 | Tipo Identificación | N 1 | 1=RNC, 2=Cédula, 3=sin identificación | [S2][S13] |
| D3 | Tipo Bienes/Servicios Comprados | N 2 | cost/expenses classification code (11 categories, see §5) | [S2][S13] |
| D4 | Número Comprobante Fiscal | A 11/13 | purchase NCF incl. 2-char prefix (B01…/B11…); 19-pos legacy allowed | [S3][S13] |
| D5 | NCF o Documento Modificado | A 11/19 | NCF affected by nota débito/crédito, space-blank if none | [S13] |
| D6 | Fecha Comprobante | N 8 | issue date `AAAAMMDD` | [S2][S13] |
| D7 | Fecha Pago | N 8 | payment date `AAAAMMDD`; blank/zeros if none (required when D-retención filled) | [S2][S13] |
| D8 | Monto Facturado en Servicios | N 12 | services portion of base (no taxes) | [S13] |
| D9 | Monto Facturado en Bienes | N 12 | goods portion of base (no taxes) | [S13] |
| D10 | Total Monto Facturado | *auto* | D8+D9 | [S13] |
| D11 | ITBIS Facturado | N 12 | ITBIS charged on the purchase | [S2][S13] |
| D12 | ITBIS Retenido | N 12 | ITBIS the taxpayer withheld from supplier (needs D7) | [S2][S13] |
| D13 | ITBIS sujeto a Proporcionalidad (Art. 349) | N 12 | ITBIS subject to proportional credit (feeds IT-1 Anexo A) | [S11][S13] |
| D14 | ITBIS llevado al Costo | N 12 | ITBIS expensed to cost (not taken as advance) | [S11][S13] |
| D15 | ITBIS por Adelantar | *auto* | D11 − D14 | [S13] |
| D16 | ITBIS percibido en compras | N 12 | ITBIS perceived from third parties at invoicing | [S13] |
| D17 | Tipo de Retención en ISR | N (code) | ISR retention type (codes 1–8, see §5); needs D7 | [S13] |
| D18 | Monto Retención Renta | N 12 | ISR withheld = Servicios × rate | [S13] |
| D19 | ISR Percibido en compras | N 12 | ISR perceived from third parties | [S13] |
| D20 | Impuesto Selectivo al Consumo | N 12 | ISC on gravada purchase | [S13] |
| D21 | Otros Impuestos/Tasas | N 12 | other taxes/fees | [S13] |
| D22 | Monto Propina Legal | N 12 | legal tip | [S13] |
| D23 | Forma de Pago | N (code) | 1 Efectivo, 2 Cheque/Transferencia/Depósito, 3 Tarjeta, 4 Compra a crédito, 5 Permuta, 6 Notas de crédito, 7 Mixto | [S13][S11] |

> The **legacy** 606 (NG 06-2014 / instructivo S5, pre-May-2018, 19-pos NCF) had fewer columns: `RNC_CEDULA, TIPO_IDENTIFICACION, TIPO_BIENES_SERVICIOS_COMPRADOS, NUMERO_COMPROBANTE_FISCAL(19), NUMERO_COMPROBANTE_MODIFICADO(19), FECHA_COMPROBANTE, FECHA_PAGO, ITBIS_FACTURADO, ITBIS_RETENIDO, MONTO_FACTURADO`. [S2][S5][S10] The **current** layout adds the goods/services split, proporcionalidad, ITBIS-al-costo, ISR retention type and Forma de Pago. [S11][S13] **Use the current layout for the exporter.**

---

## 5. Formato 608 — Comprobantes anulados

**Scope [S1][S3][S7]:** monthly report of **NCFs the taxpayer annulled during the period**, specifying the reason. Filed **by the 15th**, mandatory **even in zero** (informativa). Governed by Norma General 07-2018. [S3][S6][S7]

### 608 Encabezado (header)
`CODIGO_INFORMACION = 608` · `RNC_CEDULA` A11 · `PERIODO` N6 (`AAAAMM`) · `CANTIDAD_REGISTROS` N (**≤ 4,999**). [S6]

### 608 Detalle (detail record) — 3 columns
| # | Column | Type | Meaning | Source |
|---|---|---|---|---|
| D1 | Número de Comprobante Fiscal | A 11 | the annulled NCF | [S6][S3] |
| D2 | Fecha de Comprobante | N 8 | original issue date `AAAAMMDD` | [S6][S3] |
| D3 | Tipo de Anulación | N (code) | reason code **1–10** (below) | [S6][S3] |

**Tipo de Anulación codes (1–10) [S6][S3]:** 1 Deterioro de factura preimpresa · 2 Errores de impresión (factura preimpresa) · 3 Impresión defectuosa · 4 Corrección de la información · 5 Cambio de productos · 6 Devolución de productos · 7 Omisión de productos · 8 Errores en secuencia de NCF · 9 Por cese de operaciones · 10 Pérdida o hurto de talonarios.

> **No amounts** are reported in 608 — only NCF, its date, and the annulment reason. [S11]

### Reconciliation with SystemFact `Cancelada` vs `Anulada`  [SR]
- **`CANCELADA`** (internal discarded operation, NCF never delivered / "no utilizado", **sin efecto fiscal**): **not** reported in 607; correlativo kept "no utilizado". **Does the "NCF no utilizados" wording of 608 apply here?** The current 608 (Norma 07-2018) instructivo enumerates *anulados* and reason codes (1–10, several of which are "pre-printed/sequence/loss" cases ≈ unused/void stock), which is where SystemFact's no-fiscal-effect voided sequence numbers naturally land. → **Decision item for spec, flagged:** confirm with the DGII pre-validation tool whether a never-issued `CANCELADA` sequence goes in 608 (unused/void) or is omitted entirely. (The repo's older docs say Cancelada → not in 607, correlativo preserved; the exact 608 inclusion of *unused vs annulled* needs tool confirmation.)
- **`ANULADA`** (fiscal effect, NCF consumed, previously issued/delivered): **must** appear in 608 with a reason code (typically 4 Corrección / 6 Devolución / etc.); a **B04 Nota de Crédito** referencing the original is emitted if the client already held it. [SR]
→ Exporter implication: 608 source = documents with `estadoFiscal = ANULADA` (and any intentionally-voided sequence numbers to be confirmed), never `VIGENTE`; `CANCELADA` handled per the flagged decision.

---

## 6. IT-1 — Declaración Jurada de ITBIS (NOT a TXT export)

**Nature [S8][S9]:** IT-1 is the monthly sworn **ITBIS declaration form**, filed **interactively in the Oficina Virtual** (*Declaraciones Juradas › Declaración Interactiva › IT1 – Declaración del ITBIS/ANEXOS*) or on paper at a local administration. It is **accompanied by Anexo A (ITA)** which **must be sent first**; Anexo A auto-populates most casillas from the already-submitted **606 and 607**. There is **no DGII "TXT layout" for IT-1** — it is not a data-file exchange like 606/607/608.
**Deadline [S8][S9]:** declaration & payment by the **20th** of the following month (e.g. June declared/paid by 20 July). Mora: 10% first month + 4% progressive/month + 1.10% indemnificatory interest.

**What IT-1 needs (data, not columns):**
- **Débito fiscal** (ITBIS cobrado/facturado en ventas) — ties to 607 (`ITBIS Facturado` Σ; Anexo A rows for *Comprobante válido para crédito fiscal (01)*, *Nota de Débito (03)*, *Nota de Crédito (04)* auto-fill from 607). [S8]
- **Crédito fiscal / adelantos** (ITBIS pagado en compras locales + importaciones, less proporcionalidad & costo) — ties to 606. [S8]
- **ITBIS Retenido / Percibido (Renglón A)**: **casilla 60 "Impuesto a Pagar" must equal Σ of "ITBIS Retenido" reported in the active 606** — OFV blocks submission on mismatch. [S8]
- **Neto a pagar** = (ITBIS débito − crédito), plus the retención/percepción total → total a pagar (casillas 38 + 67). [S8]
- Importaciones casilla validated against **DGA** amounts. [S9]
- Cross-check: **607 total sales must reconcile with the IT-1 sales base**. [S11]

**→ "Exportar IT-1" for SystemFact means, realistically:** generate the **data summary / worksheet** of the IT-1 casilla values (débito, crédito, ITBIS retenido, neto) derived from the same 606/607 aggregates, so a human can key/verify it in the OFV interactive form — **not** produce a TXT file. The only true DGII **TXT exports** are 606, 607 and 608. This distinction should be made explicit in the proposal/spec so slice E does not over-promise an "IT-1 TXT" the DGII never accepts. [S8][S9][S11]

---

## 7. NCF type mapping & retention effects (questions 5 & 6)

**How NCF "type" enters 607/606:** there is **no dedicated "tipo NCF" column**. The **first 2 characters of the NCF string** (`B01`, `B02`, `B03`, `B04`, `B11`, …) carry the type and sit inside `NUMERO_COMPROBANTE_FISCAL` (and `..._MODIFICADO`). DGII derives typing from the prefix. [S3][S4][S13]
- **607:** `B01` Factura Crédito Fiscal (detail with client RNC), `B02` Consumo (only ≥ RD$250k detail; below → summary), `B03` Nota de Débito (sets D4 modificado), `B04` Nota de Crédito (D4 references original, reduces base/ITBIS). The `Tipo de Ingreso` (D5) is a separate income classification (not the NCF prefix). [S4][S7][S11]
- **606:** `B01` supplier formal invoice; `B11` purchase from informal/physical person — drives **ITBIS Retenido 100%** (D12) + needs Fecha Pago; services between sociedades → 30% ITBIS retention; ISR retention type (D17)/amount (D18) for professional services / rentals. [SR][S13]

**Tipo de Ingreso (607 D5) & Tipo Bienes/Servicios (606 D3) code tables:** the **606 cost-classification** codes are known from NG 06-2014 [S2]: `01 Gastos de personal · 02 Trabajos, suministros y servicios · 03 Arrendamientos · 04 Gastos de activos fijos · 05 Gastos de representación · 06 Otras deducciones admitidas · 07 Gastos financieros · 08 Gastos extraordinarios · 09 Compras y gastos que formarán parte del costo de venta · 10 Adquisiciones de activos · 11 Gastos de seguros`. The **607 "Tipo de Ingreso"** 1–6 value set is referenced by secondary sources [S11] but the authoritative list could **not be read** from the fetched annex → **PARTIAL/UNVERIFIED** (validate against pre-val tool / Anexo B).
**IR-17:** ITBIS-withholding declaration for specific economic activities; it is a **separate monthly form**, not part of the 606 TXT, but the **606 "ITBIS Retenido" total must reconcile with IT-1 casilla 60**, and IT-1 casilla 39 warns if an IR-17 for the period wasn't filed. [S8] → No new 606 columns, but cross-form consistency matters.

**ITBIS 18% / 16% / 0% semantics (Q6):** The formats carry **no rate column** — only base (`Monto Facturado`) and tax-amount (`ITBIS Facturado`). A **0%/exempt or exported** line simply reports `ITBIS Facturado = 0.00` (base still reported); the **16% reduced rate** is likewise just its amount. So **rates do NOT change column semantics** — they only change the numeric values the exporter computes per line. [S2][S4] *(Registered/export "0%" special regimes may have separate reporting annexes beyond this lane's scope.)*

---

## 8. Implications for the SystemFact exporter (high-level data mapping)

Prisma model/field → format column (domain layer supplies all fiscal math; exporter is an `infrastructure/`/`http/` adapter that only formats). [SR]

**607 (Ventas):**
- Header `RNC_CEDULA` ← `Empresa.rnc` (no dashes, space-padded 11) · `PERIODO` ← report period · `TOTAL_MONTO_FACTURADO` ← Σ base.
- Per **ComprobanteFiscal** with `estadoFiscal = VIGENTE`, type ∈ {B01,B02≥250k,B03,B04,B15?}: D1/D2 ← `Cliente.identificacionFiscal`+type (or blank/`3` for B02 consumer); D3 ← `ncf` (**with `tipoNcf` prefix**); D4 ← original NCF referenced by a `B04/B03`; D6 ← `fechaComprobante` (America/Santo_Domingo business date → `AAAAMMDD`); D8 ← `subtotalGravado` (+exento in base as applicable); D9 ← Σ `DetalleVenta.itbis` (frozen rate); D10/D12 ← retentions suffered by us; **D17–D23 ← payment split** from `Pago`/`Venta` by method, **gross incl. ITBIS**, must cross-foot to invoice total.

**606 (Compras):**
- Per `Compra` (with received `COMPRA.ncf`/`tipoNcf`) + expense documents: D1/D2 ← `Proveedor.rnc`+type; D3 ← cost classification (needs mapping config); D4 ← purchase NCF; D6/D7 ← `fechaComprobante`/`fechaPago`; D8/D9 ← service vs goods split of base (may require line `categoria`); D11 ← `itbis` of purchase; **D12 ← ITBIS retenido (B11 → 100%, SERVICIO_PROFESIONAL → 30%)**; D17/D18 ← ISR retention type + amount (from `Proveedor.tipoPersona`, `Compra.tipoCompra` per erd-guia §). [SR]

**608 (Anulados):**
- Per `ComprobanteFiscal` with `estadoFiscal = ANULADA` (and voided/unused sequence decision pending): D1 ← `ncf`; D2 ← original issue date; D3 ← reason code (needs a **DGII-608 reason enum** mapped from `Anulacion.motivo`). `CANCELADA` handling = **open decision (§5)**. [SR]

**IT-1:**
- Not a file export. Produce a **computed summary** (débito = Σ 607 ITBIS Facturado; crédito = Σ 606 ITBIS por Adelantar; ITBIS retenido = Σ 606 D12; neto) surfaced for human entry/verification in OFV. Must self-check that ITBIS retenido total equals what was (and will be) reported in 606. [S8]

**Cross-cutting exporter rules:**
- Multi-tenancy: filter `empresaId` (+ `sucursalId`) when building the register; a company's RNC is the header identity. [SR]
- Money → Decimal formatting with `.` decimal, zero-left-padded to field length; alphanumeric right space-padded; **fixed-width** assembly, header+details in one file, no separator lines. [S2][S10]
- Dates converted to `America/Santo_Domingo` before `AAAAMMDD`. [SR]
- NCF must be emitted **with its 2-char `tipoNcf` prefix**, 11-position current form. [S3][S4]
- **Idempotency/versioning:** re-running an export for a period must not double-count; produce deterministic bytes.

---

## 9. Explicitly UNVERIFIED items (and how to validate)

| # | Item | Why unverified | Validation path at implementation |
|---|---|---|---|
| U1 | **File encoding** (ASCII vs Windows-1252, BOM, LF vs CRLF) | Not stated in specs; PDFs unfetchable inline; secondary sources silent/contradictory | Round-trip a sample TXT through the **DGII Herramienta de Pre-Validación** (S1); adjust encoding until 0 errors |
| U2 | **Exact fixed-width byte offsets** for current 606/607 (11 vs 13 vs 19-char NCF field width, amount field widths) | Official annex tables not machine-read here; NCF width changed 19→11 in 2018 and secondary sources say 11 *or* 13 | Confirm each field length against pre-val tool + the Excel template's "Generar Archivo" output for a known-good record |
| U3 | **607 "Tipo de Ingreso" (D5) authoritative code list (1–6)** | Annex B list not retrievable | Read from DGII Anexo B PDF (open manually) or infer from pre-val tool accepted values |
| U4 | **608 inclusion of `CANCELADA` / never-issued unused sequence numbers** | Repo docs and 608 instructivo emphasize *anulados*; "NCF no utilizados" scope ambiguous | Confirm whether voided-but-unissued sequences belong in 608 (which reason code) or are omitted — via pre-val tool / DGII guidance |
| U5 | **606 current `CANTIDAD_REGISTROS` cap & multi-file split size** | Only legacy 10,000 sourced; current larger | Confirm against current 606 instructivo / tool |
| U6 | **Whether pipe-delimited is ever accepted (S14)** | Contradicts official fixed-width | Authoritatively fixed-width; treat pipe as incorrect — do NOT implement pipe |

---

## 10. Confidence summary per layout

| Report | Column list (order/names/meaning) | File format | Submission rules | Overall |
|---|---|---|---|---|
| **607** | **High** (23 cols confirmed via S3/S4/S12) | Structure high; encoding/byte-offsets = U1/U2 | **High** (day 15, ≤65k, pre-val, OFV) | **High (layout) / Medium (bytes)** |
| **606** | **Medium-High** (current field set S11/S13 + legacy types S2; D5-type/D3 mapping needs config) | Same as 607 | **High** (before 15th & before IT-1) | **Medium-High** |
| **608** | **High** (3 cols + reason 1–10) | Same as 607 | **High** (day 15, ≤4,999, en cero) | **High**; Cancelada/unused scope = U4 |
| **IT-1** | **High** (it's a form, not a layout — data + casilla cross-checks confirmed) | **N/A — not a TXT export** (clarified) | **High** (day 20, Anexo A first, 606/607 prior) | **High (concept) / n/a (file)** |

**Net:** outcome **partial** — enough verified structure to write the slice-E spec (column lists + exporter mapping + "IT-1 is a summary, not a TXT"), but the exporter's **byte-exact fixed-width assembly + encoding + the 607 income-code table + the Cancelada→608 decision** are pinned as implementation-time validation tasks against the DGII pre-validation tool (U1–U6).
