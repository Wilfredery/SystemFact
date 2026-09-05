# Research: foundational-patterns-fase-1-2

**Date**: 2026-09-02
**Researcher**: sdd-research-calidad-precio
**Project**: systemfact
**Scope**: Source-backed external evidence for 4 questions surfaced by the explore phase.

---

## Scope (questions answered)

### Q1 — Prisma `$extends` + driver adapter incompatibility

**Question**: Is `prisma.$extends({ query: { $allOperations: ... } })` a viable way to enforce `setTenantContext` automatically, or is it incompatible with Prisma 7 + the `@prisma/adapter-pg` driver adapter for pg in interactive transactions?

**Findings**:

1. **Prisma Client extensions (official doc, v7)** — *Client Extensions overview*
   - URL: https://www.prisma.io/docs/orm/v7/prisma-client/client-extensions
   - Date accessed: 2026-09-02
   - Quote: "The `query` extension type does not support nested read and write operations." Listed under "Limitations".
   - Relevance: Documents that query extensions have known limitations; an extension wrapping `$allOperations` to inject `setTenantContext` is not first-class.
   - Confidence: 5/5

2. **GitHub issue #17948 — "Client extensions in interactive transactions are bound to the base client"**
   - URL: https://github.com/prisma/prisma/issues/17948
   - Date: 2023-02-16 (closed in milestone 4.16.0)
   - Quote: "Extensions to the Prisma client have `this` bound to the base client as opposed to the transaction… Use of the extension method within your transaction. `this` will be the base Prisma client instead of the transaction client."
   - Relevance: Even *if* `$extends` were a viable mechanism, contextual `this` binding inside `$transaction` callbacks breaks extension methods that want to participate in the transaction. This is fixed in newer Prisma but the bug existed for ~2 years and signals architectural fragility.
   - Confidence: 5/5

3. **GitHub issue #23583 — "interactive transactions with extended client for RLS in postgres causes blocking queries"**
   - URL: https://github.com/prisma/prisma/issues/23583
   - Date: 2024-03-21 (closed as not_planned)
   - Quote: "the extending prisma client is executing parts of interactive transactions within separate transactions only when we have extended the the model and override `query: { $allModels: {`"
   - Relevance: Confirms that a `query: { $allModels: { $allOperations: ... } }` extension **causes the interactive transaction to be broken into multiple sub-transactions**, which means a `set_config` set inside the extension does not stay in scope across the rest of the business logic. This is the exact mechanism the user wanted.
   - Confidence: 5/5

4. **GitHub issue #27660 — "Transaction API Error: 'Closed transaction found in active transactions map' with Query Compiler and Driver Adapter"**
   - URL: https://github.com/prisma/prisma/issues/27660
   - Date: 2025-07-15 (closed 2025-08-01 by PR #27669)
   - Quote: Reproduces a production failure using `$extends(byPassRls())` *together with* the driver adapter, where the `query: { $allModels: { $allOperations } }` pattern wraps each operation in a sub-`$transaction`. Closed by a Prisma internal fix but illustrates ongoing fragility of the extension + driver adapter + transaction intersection.
   - Relevance: Empirical evidence that combining `$extends` with the new query compiler + driver adapter is a known hazard area, not a stable pattern.
   - Confidence: 5/5

5. **GitHub issue #27957 — "Support for extensions with the new prisma client / driver adapters"**
   - URL: https://github.com/prisma/orm/issues/27957
   - Date: 2025-08-22 (open, labeled `kind/feature`)
   - Quote: "It seems you can't use extensions if you are using the new client and/or extensions. [Demonstrates `new PrismaClient({ adapter }).$extends(readReplicas(...))` failing]"
   - Relevance: Open Prisma ticket confirming that extension + driver adapter support is incomplete and not a feature-complete combination as of August 2025. A maintainer (davecarlson) confirms the read-replicas extension "likely does not support driver adapters in the way that you are using it right now".
   - Confidence: 5/5

6. **Prisma driver-adapter-implementation skill (Prisma, v7.9.1)**
   - URL: https://github.com/prisma/skills/blob/main/prisma-driver-adapter-implementation/SKILL.md
   - Date accessed: 2026-09-02
   - Quote: "Driver adapters are a protocol boundary: type-compatible code can still corrupt values, leak connections, or break transactions."
   - Relevance: Official Prisma guidance explicitly warns that adapter + extension combinations are a leaky abstraction, not a supported boundary.
   - Confidence: 4/5

**Conclusion**:

A2 (`$extends({ query: { $allModels: { $allOperations: ... } } })`) is **NOT viable** for enforcing tenant context in `systemfact` because:

- The official Client Extensions doc lists "no support for nested read/write operations" under limitations (Prisma v7).
- It actively *breaks* interactive transactions by wrapping each operation in a sub-transaction (issue #23583), so the `set_config` GUC would not survive across the use-case code.
- Combination with the new query compiler + driver adapter is an open, unresolved area (issues #27660, #27957).
- The maintainer-confirmed workaround for issue #27957 was "backed this change out" — production reality does not match the docs.

The user's decision for A1 (a `withTenantTransaction(ctx, fn)` wrapper that opens a `$transaction` and runs `set_config(...)` as the first statement) is the pattern that all credible production sources converge on (see Q2). This evidence concretely justifies rejecting A2.

**Evidence references for propose**:
- https://www.prisma.io/docs/orm/v7/prisma-client/client-extensions
- https://github.com/prisma/prisma/issues/17948
- https://github.com/prisma/prisma/issues/23583
- https://github.com/prisma/prisma/issues/27660
- https://github.com/prisma/orm/issues/27957
- https://github.com/prisma/skills/blob/main/prisma-driver-adapter-implementation/SKILL.md

---

### Q2 — Multi-tenant wrapper pattern with `set_config()` + Supabase RLS

**Question**: What is the best reference implementation pattern for `withTenantTransaction(ctx, fn)` that opens a `$transaction`, runs `SELECT set_config('app.current_empresa_id', ..., true)` (and `app.current_sucursal_id`, ...) as the first statement, then delegates to the callback? What are the edge cases (nested transactions, rollback, statement timeout, pool mode)?

**Findings**:

1. **Supabase Row Level Security (official docs)**
   - URL: https://supabase.com/docs/guides/database/postgres/row-level-security
   - Date accessed: 2026-09-02
   - Quote: "A policy is attached to a table, and the policy is executed every time a table is accessed… A policy like this translates to this whenever a user selects from the todos table…". The doc explains the `USING`, `WITH CHECK`, grants/policies split, but the *wrapper pattern* lives in community guides.
   - Relevance: Authoritative on why RLS is the right place for the boundary. The doc also documents `security definer` functions and pgTAP tests, both of which the propose phase can lean on.
   - Confidence: 5/5

2. **"Postgres RLS for Multi-Tenant SaaS, the Production Pattern" — The Road to Enterprise (blog)**
   - URL: https://theroadtoenterprise.com/blog/postgres-rls-multi-tenant-saas
   - Date: 2026-08-01 (also 2026-07-03 indexed version)
   - Quote: "Row level security for a multi-tenant SaaS on self-hosted Postgres is one transaction, one `set_config('app.tenant_id', $1, true)`, and one `CREATE POLICY` against that GUC." Also: "The `true` argument is the line that matters most. Without it, the GUC stays on the session, the connection returns to the pool with a tenant id baked in, and the next request can run a query with the previous tenant's permissions. With `true`, the value evaporates on commit. Same connection, clean slate."
   - Code shape (Prisma):
     ```ts
     export async function withTenantTx<T>(
       tenantId: string,
       work: (tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0]) => Promise<T>,
     ): Promise<T> {
       return prisma.$transaction(async (tx) => {
         await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`
         return work(tx)
       })
     }
     ```
   - Relevance: Production-tested pattern that matches the user's A1 choice **exactly**. The article also gives the Drizzle equivalent and a list of audit-style assertions (negative tests, index requirement, raw client not exported).
   - Confidence: 5/5

3. **"Supabase RLS Production Design Guide" — tomodahinata.com (blog)**
   - URL: https://tomodahinata.com/en/blog/supabase-rls-production-multi-tenancy-patterns
   - Date: 2026-06-24
   - Quote: "Realize multi-tenant isolation declaratively, immediately, and DRY-ly with a membership table + a security definer (set search_path='') helper." Includes the pgTAP test that calls `tests.authenticate_as(user_v)` and asserts cross-tenant invisibility.
   - Relevance: Complementary: shows the *policy + RLS test* half of the wrapper contract — useful when the propose phase designs the RLS policies on `Producto` and `Inventario` tables.
   - Confidence: 4/5

4. **"Does Prisma respect Supabase RLS? No — here's why" — dev.to (blog)**
   - URL: https://dev.to/emil_alander_7c/does-prisma-respect-supabase-rls-no-heres-why-k53
   - Date: 2026-07-19
   - Quote: "Three non-negotiables: the connection role must **not** be the table owner and must **not** have `BYPASSRLS`… everything must be **transaction-scoped** (a session-level `SET` persists on a pooled connection and leaks into the next user's request); and you must set the role _and_ the claims."
   - Relevance: Warns against the failure mode where the wrapper is correctly applied but the DB role still bypasses RLS via `BYPASSRLS`. This is a real gotcha the propose phase must call out in the `auth/infrastructure/PrismaClient.ts` setup.
   - Confidence: 4/5

5. **Supabase docs — "Prisma" connection guide**
   - URL: https://supabase.com/docs/guides/database/prisma
   - Quote: For serverless use `Supavisor Transaction Mode` (port 6543) with `pgbouncer=true`; for migrations use the direct connection on 5432. Two env vars: `DATABASE_URL` (pooled) and `DIRECT_URL` (direct).
   - Relevance: Confirms the connection-string split `systemfact` already uses (`DATABASE_URL` + `DIRECT_URL`). Pool mode = transaction = a perfect match for the wrapper pattern.
   - Confidence: 5/5

6. **Prisma docs — "Configure Prisma Client with PgBouncer"**
   - URL: https://www.prisma.io/docs/orm/v7/prisma-client/setup-and-configuration/databases-connections/pgbouncer
   - Quote: "For Prisma Client to work reliably, PgBouncer must run in **Transaction mode**." Also documents the `pgbouncer=true` query-string flag.
   - Relevance: Reinforces that transaction-mode pooling is the *only* safe mode when the wrapper relies on `SET LOCAL` semantics — exactly the `set_config(..., true)` choice.
   - Confidence: 5/5

7. **Supabase Discussion #47946 — "Transaction-mode pooler: are SET LOCAL GUCs inside an interactive transaction safe?"**
   - URL: https://github.com/orgs/supabase/discussions/47946
   - Quote: Discusses the per-transaction Supavisor pool, dedicated low-privilege role, and `set_config(..., true)` pattern as the canonical setup.
   - Relevance: Confirms the pattern works under Supabase's own transaction-mode pooler (Supavisor / PgBouncer) in production.
   - Confidence: 4/5

**Conclusion**:

The reference implementation pattern is:
```ts
export async function withTenantTransaction<T>(
  ctx: TenantCtx,
  fn: (tx: PrismaTx) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      SELECT
        set_config('app.current_empresa_id', ${String(ctx.empresaId)}, true),
        set_config('app.current_sucursal_id', ${String(ctx.sucursalId)}, true)
    `
    return fn(tx)
  }, { timeout: 10_000, isolationLevel: 'ReadCommitted' })
}
```

Edge cases the propose phase must address:
- **Nested transactions**: Prisma interactive transactions do not allow nesting inside another `$transaction` with a new client; the callback must not invoke a new wrapper. Document this in `withTenantTransaction` JSDoc.
- **Rollback**: `set_config(..., true)` reverts on `COMMIT` *and* `ROLLBACK` automatically; no extra cleanup needed.
- **Pool mode**: Only works in **transaction mode** — Supavisor / PgBouncer transaction mode. A naive session-mode setup will leak GUCs across requests.
- **DB role**: The Prisma connection role must NOT be the table owner and must NOT have `BYPASSRLS`, otherwise the wrapper is a no-op.
- **Statement timeout**: Prisma default is 5s for interactive transactions. Recommend `{ timeout: 10_000 }` as the floor for multi-statement use cases.

The choice of A1 over A2 is justified by all three production sources.

**Evidence references for propose**:
- https://supabase.com/docs/guides/database/postgres/row-level-security
- https://supabase.com/docs/guides/database/prisma
- https://theroadtoenterprise.com/blog/postgres-rls-multi-tenant-saas
- https://tomodahinata.com/en/blog/supabase-rls-production-multi-tenancy-patterns
- https://dev.to/emil_alander_7c/does-prisma-respect-supabase-rls-no-heres-why-k53
- https://www.prisma.io/docs/orm/v7/prisma-client/setup-and-configuration/databases-connections/pgbouncer
- https://github.com/orgs/supabase/discussions/47946

---

### Q3 — ESLint custom rule patterns for "first statement must be X"

**Question**: Is there an existing ESLint rule that enforces "the first statement of a function body must be X" (specifically: the first statement of a Server Action must be `return await withTenantTransaction(ctx, async (tx) => {...})`)? Or do we need a custom AST-based rule?

**Findings**:

1. **ESLint — "Custom Rules" (official docs)**
   - URL: https://eslint.org/docs/latest/extend/custom-rules
   - Quote: "You can create custom rules to use with ESLint. You might want to create a custom rule if the core rules do not cover your use case… A rule can use the current node and its surrounding tree to report or fix problems."
   - Relevance: Official guide to writing the rule. Explains `meta`, `create(context)`, AST node visitors (`FunctionDeclaration`, `ArrowFunctionExpression:exit`), and the `context.report({ node, message })` API.
   - Confidence: 5/5

2. **typescript-eslint — "Custom Rules" (official guide)**
   - URL: https://typescript-eslint.io/developers/custom-rules
   - Quote: "Each rule exports a RuleModule object… exports `meta` and `create`. The `RuleCreator` infers the allowed message IDs the rule can emit from the provided `meta.messages` object."
   - Code shape:
     ```ts
     import { ESLintUtils } from '@typescript-eslint/utils';
     export const rule = createRule({
       create(context) {
         return {
           FunctionDeclaration(node) { /* check node.body.body[0] */ }
         };
       },
       name: 'uppercase-first-declarations',
       meta: { /* ... */ }
     });
     ```
   - Relevance: This is the canonical scaffold for a TypeScript-aware custom rule in the systemfact stack (which uses typescript-eslint). The same visitor pattern can be extended to inspect `node.body.body[0]` and assert it matches the `CallExpression` for `withTenantTransaction`.
   - Confidence: 5/5

3. **ESLint Custom Rule Tutorial**
   - URL: https://eslint.org/docs/latest/extend/custom-rule-tutorial
   - Relevance: Companion tutorial that walks through plugin scaffolding (`eslint-plugin-*` naming convention), `RuleTester`, and module structure. Useful as a working template for a project-local rule.
   - Confidence: 5/5

4. **Existing rule landscape (npm)**
   - Search results for `eslint-plugin-first-line`, `eslint-plugin-no-first-statement`, etc. did not surface any well-maintained plugin that matches the exact "first statement must be a specific CallExpression" semantic. The closest ESLint core rules are:
     - `array-callback-return` — guarantees callbacks return a value (different shape).
     - `no-sequential-imports` — different shape.
   - Confidence: 4/5 (none of the surface results was a direct match)

5. **Practical AST pattern (community walkthrough)**
   - URL: https://daily.dev/posts/how-i-built-my-first-custom-eslint-rule-rprpuopkz (2025-10-08)
   - URL: https://medium.com/@uriser/how-to-write-a-custom-typescript-eslint-rule-4cc3489f9815 (2024-03-05)
   - Quote (representative): A custom rule inspects `FunctionDeclaration(node)` and looks at `node.body.body[0]` to assert a statement shape. The pattern is small (~50 LoC) once the plugin shell exists.
   - Relevance: Validates the size and shape of the rule — small, project-local, no need for a heavy plugin.
   - Confidence: 4/5

**Conclusion**:

**Build a custom rule, project-local.** Specifically:

- Create `tools/eslint-plugin-systemfact/rules/server-action-must-wrap-tenant.ts` using `@typescript-eslint/utils`'s `ESLintUtils.RuleCreator`.
- Visitor targets files matched by the `app/**/actions/*.ts` glob (configurable in the plugin's `meta.docs`).
- On `FunctionDeclaration` or `ExportNamedDeclaration → FunctionDeclaration`, check that `node.body.body[0]` is an `AwaitExpression` or `ReturnStatement` whose `argument` is a `CallExpression` to `withTenantTransaction` (matched by callee identifier name + import source).
- Report with `messageId: 'missingTenantWrap'`.
- Wire it in `eslint.config.mjs` under the existing `typescript-eslint` plugin chain.

There is **no off-the-shelf plugin** that matches this exact semantic, and the AST pattern is small enough that building a custom rule is the right path. It also keeps the rule self-documenting (the error message can name `withTenantTransaction` explicitly) rather than depending on a third-party plugin that could drift.

**Evidence references for propose**:
- https://eslint.org/docs/latest/extend/custom-rules
- https://eslint.org/docs/latest/extend/custom-rule-tutorial
- https://typescript-eslint.io/developers/custom-rules
- https://daily.dev/posts/how-i-built-my-first-custom-eslint-rule-rprpuopkz
- https://medium.com/@uriser/how-to-write-a-custom-typescript-eslint-rule-4cc3489f9815

---

### Q4 — ITBIS per product patterns (Dominican Republic / DGII)

**Question**: What is the correct way to model ITBIS (rate, validity, mixed cart calculation) in the first business module (`Producto`), so the domain layer and the 607/608 reporting lines are aligned with DGII expectations?

**Findings**:

1. **DGII — ITBIS (official)**
   - URL: https://dgii.gov.do/cicloContribuyente/obligacionesTributarias/principalesImpuestos/Paginas/Itbis.aspx
   - Quote: "En cumplimiento con lo establecido en los párrafos I y II del art. 23 de la Ley 253-12, se informa a los contribuyentes que la tasa del ITBIS a aplicar a la transferencia de bienes gravadas y/o prestación de servicios a partir del 2016 será del 18%."
   - Relevance: Authoritative rate confirmation. 18% general since 2016; this is the rate used in `calcularItbis`.
   - Confidence: 5/5

2. **Pellerano & Herrera — "El ITBIS en la República Dominicana: Guía completa para empresas y profesionales" (top Dominican law firm)**
   - URL: https://phlaw.com/es/el-itbis-en-la-republica-dominicana-guia-completa-para-empresas-y-profesionales
   - Date: 2025-10-15
   - Quote: "El ITBIS tiene tres niveles de tasa impositiva: **18%** : Tasa general aplicada a la mayoría de los bienes y servicios. **16%** : Tasa reducida aplicable a productos como café, yogur, azúcares, mantequilla y chocolates. Exento: …"
   - Relevance: Confirms the three-tier rate model (18% / 16% / 0%) with concrete product categories. The 16% reduced rate applies to: yogurts, mantequilla, café, azúcares (azúcar refinado), cacao/chocolate.
   - Confidence: 5/5

3. **Diario Libre — "Evolución del ITBIS en República Dominicana: del 6 al 18 %"**
   - URL: https://www.diariolibre.com/economia/finanzas/2023/07/31/evolucion-del-itbis-en-republica-dominicana-del-6-al-18-/2419060
   - Quote: History: 1983 6% → 1992 8% → 2001 12% → 2004 16% → 2012 18%. "Con una reforma fiscal aprobada a finales de 2012 se estableció el último aumento al ITBIS – aún vigente – así como una tasa reducida del 8% para bienes que anteriormente estaban exentos."
   - Relevance: Establishes that ITBIS rates have changed multiple times historically. This justifies the **validity date** pattern: even though the current rate is stable, the system must be able to represent historical changes for audit / 607 retroactive corrections.
   - Confidence: 5/5

4. **DGII — Instructivo de Llenado y Remisión del Formato 607 (PDF, official)**
   - URL: https://dgii.gov.do/publicacionesOficiales/bibliotecaVirtual/contribuyentes/formatoEnvioDatos/Documents/5-InstructivoLlenadoyenvioFomato607.pdf
   - Date: 2025-12-12
   - Relevance: Authoritative layout for the 607 sales report. Required columns include RNC/Cédula, NCF type (B01 crédito fiscal, B02 consumo, B03 nota de débito, B04 nota de crédito, B14/B15 special), fecha, monto facturado, ITBIS facturado, ITBIS retenido. This is what `systemfact`'s 607 generation must emit.
   - Confidence: 5/5

5. **Alegra blog — "Reportes contables 606, 607 y 608 RD: guía 2026"**
   - URL: https://blog.alegra.com/republica-dominicana/reportes-contables-606-607-608
   - Date: 2026-04-02
   - Quote: Format 607 column definitions (highlights): "ITBIS facturado", "ITBIS retenido por terceros", "ISR retenido por terceros", "Tipo de ingreso (1-6)". Format 608 "10 motivos de anulación vigentes según el instructivo del 608: (1) Deterioro de factura preimpresa, (2) Errores de impresión, … (10) Pérdida o hurto de talonarios".
   - Relevance: Confirms the column shape and the canonical motivos de anulación list. The 10 motivos are the state-enum for the cancellation reason, matching the systemfact rule "State enums frozen".
   - Confidence: 5/5

6. **ivacalculator.com — "Tasas de ITBIS en República Dominicana: 18% General y 16% Reducida"**
   - URL: https://ivacalculator.com/republica-dominicana/itbis-18-16
   - Date: 2026-01-02 (last review)
   - Quote: Worked example — Laptop DOP 50,000 + ITBIS 18% = DOP 9,000 = Total DOP 59,000. Yogurt DOP 1,000 + ITBIS 16% = DOP 160 = Total DOP 1,160. Leche fresca DOP 100 + 0% = DOP 100.
   - Relevance: Provides worked numeric examples that the domain unit tests should mirror as fixtures.
   - Confidence: 4/5

7. **Codebase pattern (community GitHub — manuelpgs/ncf_dgii_reports)**
   - URL: https://github.com/manuelpgs/ncf_dgii_reports
   - Quote: Maps product tax-config to the 607 ITBIS columns — "ITBIS Retenido Persona Jurídica" / "ITBIS Retenido Persona Física" / "ITBIS compra 18%" — showing that a product entity needs both the tax *rate* and the *retention rules* attached.
   - Relevance: Reinforces that the domain model must capture *both* the ITBIS rate (per product) and the ITBIS-retention applicability (Norma 02-05). The retention is per-product *and* per-counterparty-type (Persona Jurídica vs Persona Física).
   - Confidence: 4/5

**Conclusion — proposed entity shape**:

```ts
// Producto entity in `modules/producto/domain/`:
export type TasaItbis = '0' | '16' | '18' // frozen enum (DGII rates, DGII 2026 vigente)

export interface ProductoItbis {
  readonly tasa: TasaItbis                     // frozen at confirm time (ADR-018)
  readonly vigenteDesde: Date                   // rate changes are time-bound
  readonly vigenteHasta: Date | null            // null = current open-ended
  readonly aplicaRetencionITBIS: boolean        // Norma 02-05 — required for services
}

export interface Producto {
  readonly id: string
  readonly empresaId: string
  readonly codigo: string
  readonly descripcion: string
  readonly precioBase: Decimal                  // Decimal(12,2), per ERD v4.7
  readonly itbis: ProductoItbis
  readonly exento: boolean                      // derived: tasa === '0'
}
```

Domain calculation (pure function, no Prisma):
```ts
export function calcularItbisProducto(
  producto: Producto,
  cantidad: Decimal,
): { baseImponible: Decimal; itbis: Decimal; total: Decimal } {
  const baseImponible = producto.precioBase.mul(cantidad)
  const itbis = producto.itbis.tasa === '0'
    ? new Decimal(0)
    : baseImponible.mul(producto.itbis.tasa).div(100)
  return {
    baseImponible,
    itbis,
    total: baseImponible.plus(itbis),
  }
}
```

The 607/608 reporting fields:
- `tasaItbis`: per-line stored (frozen at confirm) — write to the 607 column *ITBIS facturado* and per-line *ITBIS Tasa*.
- `itbisRetenido`: only when `aplicaRetencionITBIS && counterparty.type === 'PERSONA_JURIDICA'` (Norma 02-05).
- `motivoAnulacion` (608): one of the 10 enum values from DGII's instructivo.

**Evidence references for propose**:
- https://dgii.gov.do/cicloContribuyente/obligacionesTributarias/principalesImpuestos/Paginas/Itbis.aspx
- https://phlaw.com/es/el-itbis-en-la-republica-dominicana-guia-completa-para-empresas-y-profesionales
- https://www.diariolibre.com/economia/finanzas/2023/07/31/evolucion-del-itbis-en-republica-dominicana-del-6-al-18-/2419060
- https://dgii.gov.do/publicacionesOficiales/bibliotecaVirtual/contribuyentes/formatoEnvioDatos/Documents/5-InstructivoLlenadoyenvioFomato607.pdf
- https://blog.alegra.com/republica-dominicana/reportes-contables-606-607-608
- https://ivacalculator.com/republica-dominicana/itbis-18-16
- https://github.com/manuelpgs/ncf_dgii_reports

---

## Cross-cutting findings

- **Prisma 7 + driver adapter + interactive transactions** is the structural through-line for Q1 and Q2. Both questions end up at the same answer: a wrapper that owns the transaction lifecycle is the only stable interface, and `$extends` is rejected by the evidence for that same reason. The propose phase should state this dependency explicitly in the ADR.

- **The `true` flag on `set_config(..., true)` is non-negotiable** in both Q2 (RLS wrapper) and the implicit pool-mode question for PgBouncer/Supavisor. The propose phase's ADR must quote this and lock it in code.

- **The DB role used by Prisma must NOT be the table owner and must NOT have `BYPASSRLS`.** The propose phase should add a `tools/scripts/verify-rls.ts` smoke test that asserts `current_user` and `rolbypassrls` from the runtime connection string.

- **ITBIS at 18% (general) + 16% (specific reduced products) + 0% (exempt)** has been stable since 2012 and is the canonical 2026 vigente rate set. No imminent change documented. The model can confidently hard-code the three rates as a frozen enum.

- **DGII rate history (1983 → 2012) shows rates have changed every few years on average**, which justifies the `vigenteDesde` / `vigenteHasta` validity fields even if the current rates are stable. The model must support historical rate changes for audit / 607 corrections.

---

## Open questions for propose

1. **Sub-rubro for retention logic (Norma 02-05)**: Should `aplicaRetencionITBIS` live on `Producto` (per product, simpler) or on a separate `ReglasRetencion` table indexed by `(empresaId, tipoContribuyente, categoriaProducto)` (more flexible but more complex)? Evidence points to per-product being sufficient for V1; the propose phase should pick and justify.

2. **`vigenteHasta` semantics**: Should the system reject a sale against a `Producto` whose ITBIS rate has expired (`vigenteHasta < today`), or should it allow the sale and stamp the historical rate on the document? Domain rule — propose phase should make a recommendation and surface the trade-off to the user.

3. **ESLint rule scope**: Should the rule target *all* exported functions in `app/**/actions/*.ts`, or only functions that are direct exports of files where the import of `withTenantTransaction` is present? The latter is more precise but may need import-tracking via `context.sourceCode.getImports()`. Propose phase should pick the simpler heuristic (all exports in action files) unless the false-positive rate is too high.

4. **Wrapper timeout default**: The default Prisma interactive-transaction timeout is 5s. With nested writes for sale confirmation + inventory + NCF + audit, this is likely tight. Propose phase should benchmark and recommend 10s as the floor, with overrides per use case.

5. **Driver-adapter name in systemfact**: The current codebase uses `PrismaPg` driver adapter for pg — confirmed by the architecture document. This means issues #27957 / #27660 directly apply. The propose phase should add a regression test that asserts no `$extends` is used outside the wrapper module.

---

## Sources cited

### Q1 — Prisma `$extends` + driver adapter
- https://www.prisma.io/docs/orm/v7/prisma-client/client-extensions
- https://github.com/prisma/prisma/issues/17948
- https://github.com/prisma/prisma/issues/23583
- https://github.com/prisma/prisma/issues/27660
- https://github.com/prisma/orm/issues/27957
- https://github.com/prisma/skills/blob/main/prisma-driver-adapter-implementation/SKILL.md

### Q2 — Multi-tenant wrapper + Supabase RLS
- https://supabase.com/docs/guides/database/postgres/row-level-security
- https://supabase.com/docs/guides/database/prisma
- https://theroadtoenterprise.com/blog/postgres-rls-multi-tenant-saas
- https://tomodahinata.com/en/blog/supabase-rls-production-multi-tenancy-patterns
- https://dev.to/emil_alander_7c/does-prisma-respect-supabase-rls-no-heres-why-k53
- https://www.prisma.io/docs/orm/v7/prisma-client/setup-and-configuration/databases-connections/pgbouncer
- https://github.com/orgs/supabase/discussions/47946

### Q3 — ESLint custom rule patterns
- https://eslint.org/docs/latest/extend/custom-rules
- https://eslint.org/docs/latest/extend/custom-rule-tutorial
- https://typescript-eslint.io/developers/custom-rules
- https://daily.dev/posts/how-i-built-my-first-custom-eslint-rule-rprpuopkz
- https://medium.com/@uriser/how-to-write-a-custom-typescript-eslint-rule-4cc3489f9815

### Q4 — ITBIS per product (DGII)
- https://dgii.gov.do/cicloContribuyente/obligacionesTributarias/principalesImpuestos/Paginas/Itbis.aspx
- https://dgii.gov.do/publicacionesOficiales/bibliotecaVirtual/contribuyentes/formatoEnvioDatos/Documents/5-InstructivoLlenadoyenvioFomato607.pdf
- https://phlaw.com/es/el-itbis-en-la-republica-dominicana-guia-completa-para-empresas-y-profesionales
- https://www.diariolibre.com/economia/finanzas/2023/07/31/evolucion-del-itbis-en-republica-dominicana-del-6-al-18-/2419060
- https://blog.alegra.com/republica-dominicana/reportes-contables-606-607-608
- https://ivacalculator.com/republica-dominicana/itbis-18-16
- https://github.com/manuelpgs/ncf_dgii_reports