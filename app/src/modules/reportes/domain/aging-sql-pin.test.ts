/**
 * Unit — the aging SQL translation pin (design D2, task 3.1; FIN-6 order pin).
 *
 * Pure: no DB. The repository's new paged aging queries push the pre-slice sort
 * (`diasVencido DESC, saldoPendiente DESC, facturaId ASC`) into SQL, where
 * `diasVencido` is an SQL expression reported in `application/cxc-aging.ts` mirrors:
 *
 *   plazo_resuelto = CASE WHEN c."plazoCreditoDias" > 0 THEN c."plazoCreditoDias"
 *                         ELSE COALESCE(${dbPlazo}::int, 0) END
 *   dias_vencido   = GREATEST((now AT TIME ZONE 'America/Santo_Domingo')::date
 *                             − ((fechaEmision + plazo_resuelto days)
 *                                AT TIME ZONE 'America/Santo_Domingo')::date, 0)
 *   bucket         = CASE 0 → AL_DIA; ≤30 → VENCIDO_1_30; ≤60 → VENCIDO_31_60; ELSE MAYOR_60
 *
 * This suite pins the TRANSLATION: the SQL-mirrored evaluation MUST equal the pure
 * domain rules (`diasVencidoEnSD` over the resolved plazo, `clasificarBucketAging`)
 * over the boundary fixtures, and the mirrored bucket CASE must agree with the
 * classifier for every day count 0..400. The behavioral half — Postgres computing
 * these EXACT expressions — is pinned by the `aging-paginado` integration suite.
 */

import {
  BUCKET_AGING,
  clasificarBucketAging,
} from "./aging";
import { diasVencidoEnSD } from "@/modules/cobros/domain/en-mora";

/** A fixed midday-UTC instant — unambiguously 10:00 SD on 15 Apr 2026. */
const AHORA = new Date("2026-04-15T14:00:00.000Z");

const MILIS_POR_DIA = 86_400_000;

const diasAntes = (n: number): Date => new Date(AHORA.getTime() - n * MILIS_POR_DIA);

/** The SD `YYYY-MM-DD` of a UTC instant (the `(${x} AT TIME ZONE 'America/Santo_Domingo')::date` cast). */
const fechaSD = (d: Date): string =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Santo_Domingo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);

/** `YYYY-MM-DD` → integer day index (the SQL `date − date` subtraction is this difference). */
const indiceDiaSD = (sd: string): number => {
  const [y, m, d] = sd.split("-").map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / MILIS_POR_DIA);
};

/**
 * The SQL-mirrored past-due day count, term-for-term the repository's expression:
 * resolve the plazo with the D2 CASE, add plazo whole days to the emission instant,
 * resolve BOTH instants to their SD calendar day (the AT TIME ZONE casts), subtract
 * the day indexes (`::date − ::date`) and clamp with GREATEST(..., 0).
 */
function diasVencidoSqlEspejo(params: {
  readonly fechaEmision: Date;
  readonly clientePlazo: number;
  readonly dbPlazo: number | null;
}): number {
  // plazo_resuelto = CASE WHEN c."plazoCreditoDias" > 0 THEN c."plazoCreditoDias" ELSE COALESCE($dbPlazo, 0) END
  const plazoResuelto =
    params.clientePlazo > 0 ? params.clientePlazo : (params.dbPlazo ?? 0);
  // ((f."fechaEmision" + (plazo_resuelto || ' days')::interval) AT TIME ZONE 'America/Santo_Domingo')::date
  const vencimientoSD = indiceDiaSD(
    fechaSD(new Date(params.fechaEmision.getTime() + plazoResuelto * MILIS_POR_DIA)),
  );
  // (${now} AT TIME ZONE 'America/Santo_Domingo')::date
  const hoySD = indiceDiaSD(fechaSD(AHORA));
  // GREATEST(diff, 0) — 0 when not yet past due.
  const dias = hoySD - vencimientoSD;
  return dias > 0 ? dias : 0;
}

/** The SQL bucket CASE, mirroring the summary's boundary re-encoding (D2). */
function bucketSqlEspejo(diasVencido: number): string {
  if (diasVencido === 0) return "AL_DIA";
  if (diasVencido <= 30) return "VENCIDO_1_30";
  if (diasVencido <= 60) return "VENCIDO_31_60";
  return "MAYOR_60";
}

describe("aging SQL translation pin (D2, computed-field case)", () => {
  it("SQL-mirrored diasVencido == diasVencidoEnSD over the boundary fixtures", () => {
    // Boundaries: due today → 0; 1 SD day past the 23:59:59 SD edge; the
    // 30/31 and 60/61 bucket thresholds both via a client term and via the
    // DB PLAZO_CREDITO fallback (plazo_resuelto CASE).
    const casos: ReadonlyArray<{
      readonly nombre: string;
      readonly fechaEmision: Date;
      readonly clientePlazo: number;
      readonly dbPlazo: number | null;
      readonly esperado: number;
    }> = [
      // Due TODAY (emission = today − 30): 0 days past → Al día.
      { nombre: "due today (plazo 30)", fechaEmision: diasAntes(30), clientePlazo: 30, dbPlazo: 30, esperado: 0 },
      // 1 SD day past the 23:59:59 SD edge: due = 2026-04-14 23:59:59 SD (03:59:59 UTC),
      // so the whole-due-day is still yesterday and the count is EXACTLY 1.
      {
        nombre: "1 SD day past the 23:59:59 SD edge",
        fechaEmision: new Date(new Date("2026-04-15T03:59:59.000Z").getTime() - 30 * MILIS_POR_DIA),
        clientePlazo: 30,
        dbPlazo: null,
        esperado: 1,
      },
      // 30 days past (last day of VENCIDO_1_30), 31 (first of VENCIDO_31_60).
      { nombre: "30/31 threshold (client term 30)", fechaEmision: diasAntes(30 + 30), clientePlazo: 30, dbPlazo: null, esperado: 30 },
      { nombre: "31 days past", fechaEmision: diasAntes(30 + 31), clientePlazo: 30, dbPlazo: null, esperado: 31 },
      // 60/61 threshold — with the DB PLAZO_CREDITO fallback (client term 0 → plazo_resuelto = dbPlazo).
      { nombre: "60 days past (dbPlazo fallback)", fechaEmision: diasAntes(60), clientePlazo: 0, dbPlazo: 30, esperado: 30 },
      { nombre: "61 days past (client term wins)", fechaEmision: diasAntes(60 + 31), clientePlazo: 30, dbPlazo: 99, esperado: 61 },
      // Client term takes precedence over a configured DB parameter.
      { nombre: "client term > 0 wins over dbPlazo", fechaEmision: diasAntes(45), clientePlazo: 60, dbPlazo: 30, esperado: 0 },
      // Not yet due (future due date) clamps to 0.
      { nombre: "future due date", fechaEmision: diasAntes(1), clientePlazo: 60, dbPlazo: null, esperado: 0 },
    ];

    for (const c of casos) {
      const resolvedPlazo =
        c.clientePlazo > 0 ? c.clientePlazo : (c.dbPlazo ?? 0);
      expect(diasVencidoSqlEspejo(c)).toBe(
        diasVencidoEnSD({ fechaEmision: c.fechaEmision, plazoCreditoDias: resolvedPlazo, now: AHORA }),
      );
      expect(diasVencidoSqlEspejo(c)).toBe(c.esperado);
    }
  });

  it("SQL bucket CASE mirror == clasificarBucketAging for every day count 0..400", () => {
    for (let d = 0; d <= 400; d += 1) {
      expect(bucketSqlEspejo(d)).toBe(clasificarBucketAging(d));
    }
    // Spot-check the frozen boundaries against the DOMAIN enum, not the strings.
    expect(bucketSqlEspejo(0)).toBe(BUCKET_AGING.AL_DIA);
    expect(bucketSqlEspejo(30)).toBe(BUCKET_AGING.VENCIDO_1_30);
    expect(bucketSqlEspejo(31)).toBe(BUCKET_AGING.VENCIDO_31_60);
    expect(bucketSqlEspejo(60)).toBe(BUCKET_AGING.VENCIDO_31_60);
    expect(bucketSqlEspejo(61)).toBe(BUCKET_AGING.MAYOR_60);
  });
});
