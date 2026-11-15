import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import { contarFacturasConSaldoDeSucursalEnTx } from "./saldo-cxc.repository";

/** Unit stub of the client has no `Prisma.sql`: a minimal tagged-template fragment (strings + values). */
interface FragmentoSql {
  readonly strings: readonly string[];
  readonly values: readonly unknown[];
  readonly sql: string;
}

jest.mock("@/generated/prisma/client", () => ({
  Prisma: {
    sql: (strings: readonly string[], ...values: unknown[]) => ({
      strings,
      values,
      sql: strings.join("?"),
    }),
  },
}));

const ctx: TenantCtx = { empresaId: 4, sucursalId: 5, usuarioId: 6, esAdmin: true };

function txCon(filas: unknown[]) {
  const queryRaw = jest.fn().mockResolvedValue(filas);
  return { tx: { $queryRaw: queryRaw } as unknown as PrismaTx, queryRaw };
}

describe("contarFacturasConSaldoDeSucursalEnTx", () => {
  it("runs ONE aggregate over the canonical fragment, narrowed by branch, pinned by empresa", async () => {
    const { tx, queryRaw } = txCon([{ total: 3 }]);

    await expect(contarFacturasConSaldoDeSucursalEnTx(tx, ctx, 9)).resolves.toBe(3);

    expect(queryRaw).toHaveBeenCalledTimes(1);
    const [strings, ...values] = queryRaw.mock.calls[0] as [string[], ...unknown[]];
    const sql = strings.join("?");
    expect(sql).toContain("COUNT(*)");
    expect(sql).toContain('f."sucursalId" =');
    expect(sql).toContain('s."saldoPendiente"::numeric > 0');
    expect(values).toContain(9);
    expect(values).toContain(ctx.empresaId);

    // The canonical fragment is embedded verbatim: only APLICADO cobros reduce the balance.
    const fragmento = values.find(
      (v): v is FragmentoSql =>
        typeof v === "object" && v !== null && "strings" in v && "sql" in v,
    );
    expect(fragmento?.sql).toContain(`"estado" = 'APLICADO'`);
    expect(fragmento?.sql).toContain(`f."estado" = 'VIGENTE'`);
  });

  it("returns 0 when the aggregate yields no row", async () => {
    const { tx } = txCon([]);
    await expect(contarFacturasConSaldoDeSucursalEnTx(tx, ctx, 9)).resolves.toBe(0);
  });
});
