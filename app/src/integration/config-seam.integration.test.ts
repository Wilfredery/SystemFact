/**
 * Integration — the shared ConfiguracionEmpresa reader seam pinned on REAL
 * Postgres (R-QC-08 / R-C4; design D8).
 *
 * This is the seam's own verification (not a fake-tx unit): real validity
 * windows prove the behavior consumers depend on —
 *   1. a valid window resolves the row;
 *   2. OVERLAPPING windows resolve to the NEWEST `vigenciaInicio` (R-V17);
 *   3. an EXPIRED window is absent from the read (expired-as-missing — the
 *      customer's hard-fail / statutory-default semantics live above the seam);
 *   4. the batched multi-key read returns ONLY the found keys, never a
 *      cross-tenant row.
 *
 * The cutoff instant is fixed at `2026-06-01T16:00:00.000Z` — 12:00 local in
 * `America/Santo_Domingo` (UTC−4, DST-free). The seam compares timestamptz
 * instances by design (risk #8); SD resolution stays at the callers.
 */

import { withTenantTransaction } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import {
  leerConfigActivaEnTx,
  leerConfigsActivasEnTx,
} from "@/shared/infrastructure/configuracion-empresa";
import { getHarnessDb, seedTenantFixture, type TenantFixture } from "./setup/fixtures";

const FECHA_CORTE = new Date("2026-06-01T16:00:00.000Z");
const INICIO_VIEJO = new Date("2000-01-01T00:00:00.000Z");
const INICIO_NUEVO = new Date("2026-01-01T00:00:00.000Z");
const FIN_LEJANO = new Date("2099-12-31T23:59:59.000Z");
const FIN_EXPIRADO = new Date("2026-03-01T23:59:59.000Z");

let fixture: TenantFixture;
let ctx: TenantCtx;

async function sembrarFila(params: {
  clave: string;
  valor: string;
  vigenciaInicio: Date;
  vigenciaFin: Date;
}): Promise<void> {
  await getHarnessDb().configuracionEmpresa.create({
    data: { empresaId: ctx.empresaId, activa: true, ...params },
  });
}

describe("seam leerConfigActivaEnTx (real DB, RLS on)", () => {
  beforeEach(async () => {
    fixture = await seedTenantFixture();
    ctx = {
      empresaId: fixture.empresaA.id,
      sucursalId: fixture.sucursalA1.id,
      usuarioId: fixture.usuarios.adminA.id,
      esAdmin: true,
    };
  });

  it("resolves the row whose validity window covers the cutoff instant", async () => {
    await sembrarFila({
      clave: "SEAM_SOLAPA",
      valor: "unica",
      vigenciaInicio: INICIO_VIEJO,
      vigenciaFin: FIN_LEJANO,
    });
    const fila = await withTenantTransaction(ctx, (tx) =>
      leerConfigActivaEnTx(tx, ctx.empresaId, "SEAM_SOLAPA", FECHA_CORTE),
    );
    expect(fila).toMatchObject({ clave: "SEAM_SOLAPA", valor: "unica" });
  });

  it("overlapping windows resolve DETERMINISTICALLY to the newest vigenciaInicio (R-V17)", async () => {
    await sembrarFila({
      clave: "SEAM_SOLAPA",
      valor: "ventana-vieja",
      vigenciaInicio: INICIO_VIEJO,
      vigenciaFin: FIN_LEJANO,
    });
    await sembrarFila({
      clave: "SEAM_SOLAPA",
      valor: "ventana-nueva",
      vigenciaInicio: INICIO_NUEVO,
      vigenciaFin: FIN_LEJANO,
    });
    const fila = await withTenantTransaction(ctx, (tx) =>
      leerConfigActivaEnTx(tx, ctx.empresaId, "SEAM_SOLAPA", FECHA_CORTE),
    );
    expect(fila?.valor).toBe("ventana-nueva");
  });

  it("an EXPIRED window (vigenciaFin strictly before the cutoff) reads as absent", async () => {
    await sembrarFila({
      clave: "SEAM_SOLAPA",
      valor: "caducada",
      vigenciaInicio: INICIO_VIEJO,
      vigenciaFin: FIN_EXPIRADO,
    });
    const fila = await withTenantTransaction(ctx, (tx) =>
      leerConfigActivaEnTx(tx, ctx.empresaId, "SEAM_SOLAPA", FECHA_CORTE),
    );
    expect(fila).toBeNull();
  });

  it("never serves a row of ANOTHER empresa (tenant pin inside the seam)", async () => {
    const db = getHarnessDb();
    await db.configuracionEmpresa.create({
      data: {
        empresaId: fixture.empresaB.id,
        clave: "SEAM_SOLAPA",
        valor: "de-empresa-B",
        activa: true,
        vigenciaInicio: INICIO_VIEJO,
        vigenciaFin: FIN_LEJANO,
      },
    });
    const fila = await withTenantTransaction(ctx, (tx) =>
      leerConfigActivaEnTx(tx, ctx.empresaId, "SEAM_SOLAPA", FECHA_CORTE),
    );
    expect(fila).toBeNull();
  });
});

describe("seam leerConfigsActivasEnTx (real DB, RLS on)", () => {
  beforeEach(async () => {
    fixture = await seedTenantFixture();
    ctx = {
      empresaId: fixture.empresaA.id,
      sucursalId: fixture.sucursalA1.id,
      usuarioId: fixture.usuarios.adminA.id,
      esAdmin: true,
    };
  });

  it("returns ONLY the (active, in-window) found keys — no synthesis, no cross-tenant leak", async () => {
    await sembrarFila({
      clave: "SEAM_BATCH_1",
      valor: "10.00",
      vigenciaInicio: INICIO_VIEJO,
      vigenciaFin: FIN_LEJANO,
    });
    await sembrarFila({
      clave: "SEAM_BATCH_2",
      valor: "caducada",
      vigenciaInicio: INICIO_VIEJO,
      vigenciaFin: FIN_EXPIRADO,
    });
    await getHarnessDb().configuracionEmpresa.create({
      data: {
        empresaId: fixture.empresaB.id,
        clave: "SEAM_BATCH_3",
        valor: "de-empresa-B",
        activa: true,
        vigenciaInicio: INICIO_VIEJO,
        vigenciaFin: FIN_LEJANO,
      },
    });

    const filas = await withTenantTransaction(ctx, (tx) =>
      leerConfigsActivasEnTx(
        tx,
        ctx.empresaId,
        ["SEAM_BATCH_1", "SEAM_BATCH_2", "SEAM_BATCH_3"],
        FECHA_CORTE,
      ),
    );

    // BATCH_1 = found; BATCH_2 = expired → absent; BATCH_3 = foreign tenant → invisible.
    expect(filas).toEqual([{ clave: "SEAM_BATCH_1", valor: "10.00" }]);
  });
});
