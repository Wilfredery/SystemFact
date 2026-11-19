import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import {
  contarFacturasConSaldoDeSucursalEnTx,
  contarSaldoCxcEnTx,
  consultarProximasAVencerEnTx,
  consultarSaldoCxcTableroEnTx,
} from "./saldo-cxc.repository";

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
    empty: { strings: [""], values: [], sql: "" },
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

/** The full SQL text of one `$queryRaw` call, flattening nested `Prisma.Sql` fragments. */
function textoDeSql(strings: readonly string[], valores: readonly unknown[]): string {
  const anidados = valores
    .filter(
      (v): v is FragmentoSql =>
        typeof v === "object" && v !== null && "strings" in v && "sql" in v,
    )
    .map((f) => textoDeSql(f.strings, f.values));
  return [strings.join("?"), ...anidados].join(" ");
}

/** Every scalar bind of the statement, flattening the nested `Prisma.Sql` fragments. */
function aplanarValores(valores: readonly unknown[]): unknown[] {
  return valores.flatMap((v) =>
    typeof v === "object" && v !== null && "strings" in v && "values" in v
      ? aplanarValores((v as FragmentoSql).values)
      : [v],
  );
}

function sqlDe(queryRaw: jest.Mock, llamada = 0): { sql: string; valores: unknown[] } {
  const [strings, ...valores] = queryRaw.mock.calls[llamada] as [
    readonly string[],
    ...unknown[],
  ];
  return { sql: textoDeSql(strings, valores), valores: aplanarValores(valores) };
}

const AHORA = new Date("2026-04-15T14:00:00.000Z");

describe("consultarSaldoCxcTableroEnTx (S10 cliente name + SD días, S12 search)", () => {
  it("joins CLIENTE tenant-pinned, projects the SD days column and keeps the R-C9 page cut", async () => {
    const { tx, queryRaw } = txCon([
      {
        facturaId: 7,
        clienteId: 3,
        clienteNombre: "Ferretería del Valle",
        dias: 12,
      },
    ]);

    await expect(
      consultarSaldoCxcTableroEnTx(tx, ctx, {
        pag: { offset: 0, limit: 25 },
        now: AHORA,
        busqueda: null,
      }),
    ).resolves.toHaveLength(1);

    expect(queryRaw).toHaveBeenCalledTimes(1);
    const { sql, valores } = sqlDe(queryRaw);
    // S10: the client-name join is TENANT-PINNED.
    expect(sql).toContain('LEFT JOIN "CLIENTE" c');
    expect(sql).toContain('c."nombre"');
    expect(sql).toContain('c."empresaId" =');
    // S10: the Días column is the SD calendar-day count (no manual hour math).
    expect(sql).toContain('AS "dias"');
    expect(sql).toContain("AT TIME ZONE 'America/Santo_Domingo'");
    expect(valores).toContain(AHORA);
    // R-C9: pinned order + the paging tail, unchanged.
    expect(sql).toContain('ORDER BY s."fechaEmision" DESC, s."facturaId" DESC');
    expect(sql).toContain("LIMIT");
    expect(sql).toContain("OFFSET");
    expect(valores).toContain(25);
    expect(valores).toContain(0);
    // The canonical ADR-017 fragment rides verbatim (single balance formula).
    expect(sql).toContain(`"estado" = 'APLICADO'`);
    expect(sql).toContain(`f."estado" = 'VIGENTE'`);
    expect(valores).toContain(ctx.empresaId);
    // No search → no LIKE predicate at all.
    expect(sql).not.toContain("ILIKE");
  });

  it("narrows by client name or invoice number with a normalized LIKE pattern", async () => {
    const { tx, queryRaw } = txCon([]);

    await consultarSaldoCxcTableroEnTx(tx, ctx, {
      now: AHORA,
      busqueda: "ferretería",
    });

    const { sql, valores } = sqlDe(queryRaw);
    expect(sql).toContain("ILIKE");
    expect(sql).toContain('c."nombre"');
    expect(sql).toContain('s."facturaId"::text');
    expect(valores).toContain("%ferretería%");
  });
});

describe("contarSaldoCxcEnTx (S11 KPI strip, global — never page-scoped)", () => {
  it("returns the pending-set sum/count plus the en-mora count/sum from ONE FILTER statement", async () => {
    const { tx, queryRaw } = txCon([
      {
        total: 9,
        pendientes: 6,
        saldoPendienteTotal: "4500.00",
        enMora: 2,
        saldoEnMora: "1500.00",
      },
    ]);

    await expect(
      contarSaldoCxcEnTx(tx, ctx, { now: AHORA, busqueda: null }),
    ).resolves.toEqual({
      total: 9,
      pendientes: 6,
      saldoPendienteTotal: "4500.00",
      enMora: 2,
      saldoEnMora: "1500.00",
    });

    expect(queryRaw).toHaveBeenCalledTimes(1);
    const { sql, valores } = sqlDe(queryRaw);
    expect(sql).toContain("COUNT(*) FILTER (WHERE");
    // Money sums stay numeric then cross as Decimal(12,2) text (never a float).
    expect(sql).toContain('SUM(s."saldoPendiente"::numeric)');
    expect(sql).toContain("::numeric(12, 2)::text");
    // Mora predicate: the SAME SD day expression, fires at ONE full SD day.
    expect(sql).toContain("AT TIME ZONE 'America/Santo_Domingo'");
    expect(sql).toContain("> 0");
    // The client term is the board's own resolution (client plazo, 0 when absent).
    expect(sql).toContain('COALESCE(c."plazoCreditoDias", 0)');
    expect(valores).toContain(AHORA);
    expect(valores).toContain(ctx.empresaId);
    // No LIMIT/OFFSET: the KPIs are global, not page-scoped.
    expect(sql).not.toContain("LIMIT");
    expect(sql).not.toContain("OFFSET");
  });

  it("falls back to zeroed KPI figures when the aggregate yields no row", async () => {
    const { tx } = txCon([]);
    await expect(
      contarSaldoCxcEnTx(tx, ctx, { now: AHORA, busqueda: null }),
    ).resolves.toEqual({
      total: 0,
      pendientes: 0,
      saldoPendienteTotal: "0.00",
      enMora: 0,
      saldoEnMora: "0.00",
    });
  });
});

describe("consultarProximasAVencerEnTx (S12 side panel)", () => {
  it("selects the open receivables nearest their due date inside a bounded window", async () => {
    const { tx, queryRaw } = txCon([
      {
        facturaId: 11,
        clienteId: 4,
        clienteNombre: "Colmado Ana",
        saldoPendiente: "900.00",
        fechaEmision: AHORA,
        plazoCreditoDias: 30,
      },
    ]);

    await expect(
      consultarProximasAVencerEnTx(tx, ctx, { now: AHORA, limite: 5 }),
    ).resolves.toHaveLength(1);

    expect(queryRaw).toHaveBeenCalledTimes(1);
    const { sql, valores } = sqlDe(queryRaw);
    // Only genuinely collectable invoices.
    expect(sql).toContain('s."saldoPendiente"::numeric > 0');
    expect(sql).toContain('s."cobrosAplicados"::numeric < s."total"::numeric');
    // Nearest due in EITHER direction, on the SD calendar, bounded both ways.
    expect(sql).toContain("BETWEEN");
    expect(sql).toContain("ABS(");
    expect(sql).toContain("ORDER BY");
    expect(valores).toContain(-30);
    expect(valores).toContain(7);
    expect(valores).toContain(5);
    // Tenant pins preserved on the fragment and the client join.
    expect(sql).toContain('c."empresaId" =');
    expect(valores).toContain(ctx.empresaId);
  });
});
