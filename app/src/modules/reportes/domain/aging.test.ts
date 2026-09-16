/**
 * Unit — reportes CxC aging domain (FIN-2, slice C).
 *
 * Pure: no DB. Covers the exact bucket boundaries (Al día / 1–30 / 31–60 / 60+), the reuse of
 * the ratified `en-mora` SD rule via `construirFilaAging`, and the Decimal bucket reduction.
 * The `now` is injected and the emission instants are chosen at 14:00 UTC (10:00 SD) so every
 * SD calendar day is unambiguous (never a UTC-vs-SD boundary edge).
 */

import {
  BUCKET_AGING,
  ORDEN_BUCKETS,
  clasificarBucketAging,
  construirFilaAging,
  resumirAging,
  type FilaCxcAbierta,
} from "./aging";

describe("clasificarBucketAging (FIN-2 boundaries)", () => {
  it("0 days past due → Al día", () => {
    expect(clasificarBucketAging(0)).toBe(BUCKET_AGING.AL_DIA);
  });
  it("1–30 days → Vencido 1–30 (inclusive at both ends)", () => {
    expect(clasificarBucketAging(1)).toBe(BUCKET_AGING.VENCIDO_1_30);
    expect(clasificarBucketAging(30)).toBe(BUCKET_AGING.VENCIDO_1_30);
  });
  it("31–60 days → Vencido 31–60 (inclusive at both ends)", () => {
    expect(clasificarBucketAging(31)).toBe(BUCKET_AGING.VENCIDO_31_60);
    expect(clasificarBucketAging(60)).toBe(BUCKET_AGING.VENCIDO_31_60);
  });
  it("more than 60 days → 60+", () => {
    expect(clasificarBucketAging(61)).toBe(BUCKET_AGING.MAYOR_60);
    expect(clasificarBucketAging(200)).toBe(BUCKET_AGING.MAYOR_60);
  });
  it("a negative day count clamps to Al día (defensive, never mis-buckets)", () => {
    expect(clasificarBucketAging(-5)).toBe(BUCKET_AGING.AL_DIA);
  });
});

describe("construirFilaAging (reuses the ratified en-mora SD rule, FIN-2)", () => {
  it("15 days past a 30-day term → Vencido 1–30 with the SD due date", () => {
    // Emission 2026-01-01 (10:00 SD); term 30 → due 2026-01-31; now 2026-02-15 → 15 days past.
    const fila: FilaCxcAbierta = {
      facturaId: 1,
      clienteId: 7,
      saldoPendiente: "500.00",
      fechaEmision: new Date("2026-01-01T14:00:00.000Z"),
      plazoCreditoDias: 30,
    };
    const r = construirFilaAging(fila, new Date("2026-02-15T14:00:00.000Z"));
    expect(r.diasVencido).toBe(15);
    expect(r.bucket).toBe(BUCKET_AGING.VENCIDO_1_30);
    expect(r.vencimiento).toBe("2026-01-31");
    // The canonical pending balance passes through untouched (no re-derivation, FIN-1).
    expect(r.saldoPendiente).toBe("500.00");
  });

  it("63 days past a zero term → 60+", () => {
    // Emission 2026-01-01, no credit window (term 0) → due 2026-01-01; now 2026-03-05 → 63 days.
    const r = construirFilaAging(
      {
        facturaId: 2,
        clienteId: 8,
        saldoPendiente: "100.00",
        fechaEmision: new Date("2026-01-01T14:00:00.000Z"),
        plazoCreditoDias: 0,
      },
      new Date("2026-03-05T14:00:00.000Z"),
    );
    expect(r.diasVencido).toBe(63);
    expect(r.bucket).toBe(BUCKET_AGING.MAYOR_60);
  });
});

describe("resumirAging (Decimal bucket reduction, FIN-2)", () => {
  it("sums saldo and counts per bucket, excluding non-outstanding rows", () => {
    const filas = [
      { facturaId: 1, clienteId: 1, saldoPendiente: "100.00", vencimiento: "2026-02-01", diasVencido: 0, bucket: BUCKET_AGING.AL_DIA },
      { facturaId: 2, clienteId: 1, saldoPendiente: "250.00", vencimiento: "2026-02-01", diasVencido: 10, bucket: BUCKET_AGING.VENCIDO_1_30 },
      { facturaId: 3, clienteId: 2, saldoPendiente: "50.00", vencimiento: "2026-02-01", diasVencido: 45, bucket: BUCKET_AGING.VENCIDO_31_60 },
      { facturaId: 4, clienteId: 2, saldoPendiente: "1000.00", vencimiento: "2026-02-01", diasVencido: 90, bucket: BUCKET_AGING.MAYOR_60 },
      // A fully-settled invoice (saldo 0) contributes to nothing.
      { facturaId: 5, clienteId: 3, saldoPendiente: "0.00", vencimiento: "2026-02-01", diasVencido: 5, bucket: BUCKET_AGING.VENCIDO_1_30 },
    ];
    const r = resumirAging(filas);
    expect(r.saldoTotal).toBe("1400.00");
    expect(r.facturasAbiertas).toBe(4);
    expect(r.porBucket[BUCKET_AGING.AL_DIA]).toBe("100.00");
    expect(r.porBucket[BUCKET_AGING.VENCIDO_1_30]).toBe("250.00");
    expect(r.porBucket[BUCKET_AGING.VENCIDO_31_60]).toBe("50.00");
    expect(r.porBucket[BUCKET_AGING.MAYOR_60]).toBe("1000.00");
    expect(r.conteoPorBucket[BUCKET_AGING.VENCIDO_1_30]).toBe(1); // the 0-saldo row was skipped
    // Every bucket key is always present (stable summary shape for the panel/CSV).
    expect(Object.keys(r.porBucket).sort()).toEqual([...ORDEN_BUCKETS].sort());
  });

  it("an empty input yields all-zero totals with every bucket present", () => {
    const r = resumirAging([]);
    expect(r.saldoTotal).toBe("0.00");
    expect(r.facturasAbiertas).toBe(0);
    for (const b of ORDEN_BUCKETS) expect(r.porBucket[b]).toBe("0.00");
  });
});
