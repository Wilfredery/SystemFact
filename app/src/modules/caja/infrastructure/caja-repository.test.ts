/**
 * Unit — the Caja read repository SQL CONTRACT (S6). No DB.
 *
 * A recording fake `tx` captures the tagged-template SQL text and the bound parameters of every
 * aggregate, so this test pins what the integration suite (T5) cannot: that each statement
 *
 *   - pins `empresaId` (first defense) and narrows by branch only through the explicit optional
 *     `sucursalId` bind (a `null` drops the branch predicate, NEVER the tenant pin — the
 *     company-wide Admin path clears the branch GUC via `conSucursalAmpliadaEnTx` upstream);
 *   - filters the Santo-Domingo day with the HALF-OPEN window `inicio <= fecha < fin` (zona.ts
 *     exposes `[inicio, fin)`; a `<=`/`BETWEEN` on the exclusive bound would double-count the
 *     next day's first instant);
 *   - carries only the spec's own predicates: `tipo`/`estado`/`metodoPago` for PAGO and
 *     `estado = 'CONFIRMADA'` for VENTA;
 *   - casts money to `::numeric(12,2)::text` (a Decimal STRING crosses SQL, never a float) and
 *     counts to `::int`;
 *   - binds NO date string and NO extra parameter: the only date binds are the two window
 *     instants, so a retroactive day cannot ride the query through any seam.
 */

import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import type { VentanaDiaSD } from "../domain/zona";
import {
  cobrosEfectivoPorMetodoEnTx,
  costoVendidoDiaEnTx,
  reembolsosEfectivoEnTx,
  totalesVentaDiaEnTx,
} from "./caja-repository";

interface Captura {
  readonly sql: string;
  readonly params: readonly unknown[];
}

interface FragmentoSql {
  readonly strings: readonly string[];
  readonly values: readonly unknown[];
}

function esFragmento(v: unknown): v is FragmentoSql {
  return (
    typeof v === "object" &&
    v !== null &&
    Array.isArray((v as FragmentoSql).strings) &&
    Array.isArray((v as FragmentoSql).values)
  );
}

/** Flatten a tagged template (with nested `Prisma.sql` fragments) into `$n` text + params. */
function aplanar(strings: readonly string[], valores: readonly unknown[]): Captura {
  let sql = strings[0] ?? "";
  const params: unknown[] = [];
  valores.forEach((valor, i) => {
    if (esFragmento(valor)) {
      const inner = aplanar(valor.strings, valor.values);
      sql += inner.sql;
      params.push(...inner.params);
    } else {
      params.push(valor);
      sql += `$${params.length}`;
    }
    sql += strings[i + 1] ?? "";
  });
  return { sql, params };
}

/** A fake `tx` whose `$queryRaw` records the statement and returns queued canned rows. */
function crearTxGrabador(capturas: Captura[], respuestas: unknown[][]): PrismaTx {
  const tx = {
    $queryRaw(
      strings: TemplateStringsArray,
      ...valores: unknown[]
    ): Promise<unknown[]> {
      capturas.push(aplanar(strings as unknown as string[], valores));
      return Promise.resolve(respuestas.shift() ?? []);
    },
  };
  return tx as unknown as PrismaTx;
}

function ctx(esAdmin = false, sucursalId = 3): TenantCtx {
  return { empresaId: 7, sucursalId, usuarioId: 11, esAdmin };
}

const VENTANA: VentanaDiaSD = {
  fechaSD: "2026-11-11",
  inicio: new Date("2026-11-11T04:00:00.000Z"),
  fin: new Date("2026-11-12T04:00:00.000Z"),
};

/** Assert the shared contract every Caja aggregate must satisfy. */
function assertContrato(captura: Captura, sucursal: number | null): void {
  // Only these binds: empresa, then the branch bound TWICE (the house `IS NULL OR =` pattern, as in
  // reportes/operacional-repository), then inicio, fin. Nothing else can ride the statement.
  expect(captura.params).toHaveLength(5);
  expect(captura.params[0]).toBe(7);
  expect(captura.params[1]).toBe(sucursal);
  expect(captura.params[2]).toBe(sucursal);
  expect(captura.params[3]).toEqual(VENTANA.inicio);
  expect(captura.params[4]).toEqual(VENTANA.fin);
  // HALF-OPEN window: >= inicio AND < fin (never <= / BETWEEN).
  expect(captura.sql).toContain(`>= $4`);
  expect(captura.sql).toContain(`< $5`);
  // Tenant pin + optional branch narrowing.
  expect(captura.sql).toContain(`= $1`);
  expect(captura.sql).toContain(`$2::int IS NULL`);
  // No date STRING binding anywhere (no retroactive day can travel as data).
  expect(captura.params.filter((p) => typeof p === "string")).toEqual([]);
  expect(captura.params.filter((p) => p instanceof Date)).toHaveLength(2);
}

describe("cobrosEfectivoPorMetodoEnTx", () => {
  it("pins the tenant, the COBRO/APLICADO/EFECTIVO predicates and the day window", async () => {
    const capturas: Captura[] = [];
    const tx = crearTxGrabador(capturas, [[]]);

    await cobrosEfectivoPorMetodoEnTx(tx, ctx(), VENTANA, 3);

    expect(capturas).toHaveLength(1);
    const [{ sql }] = capturas;
    expect(sql).toContain(`FROM "PAGO"`);
    expect(sql).toContain(`"tipo" = 'COBRO'`);
    expect(sql).toContain(`"estado" = 'APLICADO'`);
    expect(sql).toContain(`"metodoPago" = 'EFECTIVO'`);
    expect(sql).toMatch(/GROUP BY/);
    // Money as Decimal TEXT, count as int.
    expect(sql).toMatch(/::numeric\(12,\s*2\)::text/);
    expect(sql).toMatch(/COUNT\(\*\)::int/);
    assertContrato(capturas[0]!, 3);
  });

  it("drops the branch narrowing for a company-wide (null) read, keeping the tenant pin", async () => {
    const capturas: Captura[] = [];
    const tx = crearTxGrabador(capturas, [[]]);

    await cobrosEfectivoPorMetodoEnTx(tx, ctx(true), VENTANA, null);

    assertContrato(capturas[0]!, null);
  });

  it("returns the aggregated rows as-is (Decimal strings + int counts)", async () => {
    const filas = [{ metodo: "EFECTIVO", cobros: "1500.25", cantidad: 4 }];
    const tx = crearTxGrabador([], [filas]);

    await expect(cobrosEfectivoPorMetodoEnTx(tx, ctx(), VENTANA, 3)).resolves.toEqual(filas);
  });
});

describe("reembolsosEfectivoEnTx", () => {
  it("pins the REEMBOLSO/APLICADO/EFECTIVO predicates and the day window", async () => {
    const capturas: Captura[] = [];
    const tx = crearTxGrabador(capturas, [[]]);

    await reembolsosEfectivoEnTx(tx, ctx(), VENTANA, 3);

    expect(capturas).toHaveLength(1);
    const [{ sql }] = capturas;
    expect(sql).toContain(`FROM "PAGO"`);
    expect(sql).toContain(`"tipo" = 'REEMBOLSO'`);
    expect(sql).toContain(`"estado" = 'APLICADO'`);
    expect(sql).toContain(`"metodoPago" = 'EFECTIVO'`);
    expect(sql).toMatch(/COALESCE\(SUM\([^)]*\),\s*0\)::numeric\(12,\s*2\)::text/);
    assertContrato(capturas[0]!, 3);
  });

  it("returns a zero day as ZERO facts, never undefined", async () => {
    const tx = crearTxGrabador([], [[]]);

    await expect(reembolsosEfectivoEnTx(tx, ctx(), VENTANA, 3)).resolves.toEqual({
      devoluciones: "0.00",
      cantidad: 0,
    });
  });

  it("returns the aggregated magnitude (refunds stored positive) with its count", async () => {
    const tx = crearTxGrabador([], [[{ devoluciones: "250.00", cantidad: 2 }]]);

    await expect(reembolsosEfectivoEnTx(tx, ctx(), VENTANA, 3)).resolves.toEqual({
      devoluciones: "250.00",
      cantidad: 2,
    });
  });
});

describe("totalesVentaDiaEnTx", () => {
  it("sums only CONFIRMADA sales in the day window, tenant-pinned", async () => {
    const capturas: Captura[] = [];
    const tx = crearTxGrabador(capturas, [[]]);

    await totalesVentaDiaEnTx(tx, ctx(), VENTANA, 3);

    expect(capturas).toHaveLength(1);
    const [{ sql }] = capturas;
    expect(sql).toContain(`FROM "VENTA"`);
    expect(sql).toContain(`"estado" = 'CONFIRMADA'`);
    expect(sql).toMatch(/COALESCE\(SUM\([^)]*"total"\),\s*0\)::numeric\(12,\s*2\)::text/);
    expect(sql).toMatch(/COUNT\(\*\)::int/);
    assertContrato(capturas[0]!, 3);
  });

  it("returns a zero day as ZERO facts", async () => {
    const tx = crearTxGrabador([], [[]]);

    await expect(totalesVentaDiaEnTx(tx, ctx(), VENTANA, 3)).resolves.toEqual({
      totalFacturado: "0.00",
      operaciones: 0,
    });
  });

  it("returns the day's facturado + operation count", async () => {
    const tx = crearTxGrabador([], [[{ totalFacturado: "3200.00", operaciones: 5 }]]);

    await expect(totalesVentaDiaEnTx(tx, ctx(), VENTANA, 3)).resolves.toEqual({
      totalFacturado: "3200.00",
      operaciones: 5,
    });
  });
});

describe("costoVendidoDiaEnTx", () => {
  it("joins DETALLE_VENTA × PRODUCTO over CONFIRMADA sales, valorizing at costoPromedio", async () => {
    const capturas: Captura[] = [];
    const tx = crearTxGrabador(capturas, [[]]);

    await costoVendidoDiaEnTx(tx, ctx(), VENTANA, 3);

    expect(capturas).toHaveLength(1);
    const [{ sql }] = capturas;
    expect(sql).toContain(`FROM "DETALLE_VENTA"`);
    expect(sql).toContain(`JOIN "VENTA"`);
    expect(sql).toContain(`JOIN "PRODUCTO"`);
    expect(sql).toContain(`"costoPromedio"`);
    expect(sql).toContain(`"cantidad"`);
    expect(sql).toContain(`"estado" = 'CONFIRMADA'`);
    expect(sql).toMatch(/COALESCE\(SUM\([^)]*\),\s*0\)::numeric\(12,\s*2\)::text/);
    // ONE aggregate for the whole day: no per-row fetch, no grouping needed.
    expect(sql).not.toMatch(/GROUP BY/);
    assertContrato(capturas[0]!, 3);
  });

  it("returns a zero day as \"0.00\"", async () => {
    const tx = crearTxGrabador([], [[]]);

    await expect(costoVendidoDiaEnTx(tx, ctx(), VENTANA, 3)).resolves.toEqual({
      costoVendido: "0.00",
    });
  });

  it("returns the aggregated cost", async () => {
    const tx = crearTxGrabador([], [[{ costoVendido: "674.00" }]]);

    await expect(costoVendidoDiaEnTx(tx, ctx(), VENTANA, 3)).resolves.toEqual({
      costoVendido: "674.00",
    });
  });
});
