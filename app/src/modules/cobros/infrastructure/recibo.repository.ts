/**
 * Cobros infrastructure — company-serialized receipt allocator (R-C4).
 *
 * Every `PAGO` carries a `correlativoRecibo` (the printable, NON-fiscal receipt
 * number — receipts are never tax documents, spec R-C4). The number is
 * `MAX+1` per empresa and MUST be serialized so two concurrent payments never
 * collide on the `@@unique([empresaId, correlativoRecibo])` constraint.
 *
 * This is the same shape as `compra`'s `asignarCorrelativoSiguienteEnTx`
 * (`compra/infrastructure/compra-repository.ts:408`): the `EMPRESA` row is the
 * durable serialization anchor (`SELECT ... FOR UPDATE`); only the SUCURSAL GUC
 * is cleared locally so the MAX spans every branch of the empresa (receipts are
 * company-wide), while the EMPRESA GUC keeps the read/write tenant-bound; the
 * acting branch GUC is restored before the caller inserts, so the row lands in
 * the branch that registered the payment (AGENTS.md "Multi-tenancy ALWAYS").
 *
 * Unlike compra, `correlativoRecibo` is an `Int` column, so the MAX is a plain
 * integer (no `SUBSTRING`/`padStart`). `::int` forces Prisma to return a JS
 * `number`, never a `BigInt` (the app tsconfig target cannot emit BigInt
 * literals). Data access stays in the infrastructure layer (ADR-013).
 */

import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";

/**
 * Allocates the next `correlativoRecibo` for an empresa under a row lock and
 * returns it as a JS `number`. The caller performs the `PAGO` insert with the
 * same transaction handle, still holding the `EMPRESA` lock until commit, so no
 * other transaction can observe or reuse the returned number (R-C4).
 */
export async function asignarCorrelativoReciboEnTx(
  tx: PrismaTx,
  empresaId: number,
  sucursalId: number,
): Promise<number> {
  // The empresa row is the serialization anchor for the whole company's receipts.
  await tx.$executeRaw`SELECT "id" FROM "EMPRESA" WHERE "id" = ${empresaId} FOR UPDATE`;

  // Clear ONLY the sucursal filter locally so the MAX spans every branch of this
  // empresa; the empresa boundary (app.current_empresa_id) stays enforced.
  await tx.$executeRaw`SELECT set_config('app.current_sucursal_id', '', true)`;
  const rows = await tx.$queryRaw<{ next: number }[]>`
    SELECT (COALESCE(MAX("correlativoRecibo"), 0) + 1)::int AS next
    FROM "PAGO"
    WHERE "empresaId" = ${empresaId}`;
  // Restore the acting branch context before any further tenant-scoped write.
  await tx.$executeRaw`SELECT set_config('app.current_sucursal_id', ${String(
    sucursalId,
  )}, true)`;

  return rows[0]?.next ?? 1;
}
