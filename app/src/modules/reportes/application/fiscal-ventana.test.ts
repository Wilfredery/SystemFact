/**
 * Unit — the DGII export window guard is wired BEFORE any query runs, for ALL THREE formats.
 * No DB.
 *
 * The pure rule lives in `domain/dgii/ventana`; this file proves the SEAM, which is where the
 * real defect lives. An over-wide 607/608/606 request used to reach the aggregate, run for
 * minutes and die as an unhandled `Prisma` `P2028` (interactive transaction timeout) — an
 * infrastructure error for what is really a business rule. Two things must therefore hold:
 *
 *   1. a window that is not contained in ONE `America/Santo_Domingo` calendar month returns the
 *      STABLE window code as a typed `ReportResult` — never a `P2028`, never a thrown error
 *      escaping the use case;
 *   2. the refusal happens BEFORE any read at all. The fake `tx` here is STRICT: every model
 *      reader THROWS, so if the validator were ever moved inside the gate or the transaction, the
 *      very first read would blow up and fail this suite. `expect(lecturas).toEqual([])` then
 *      proves the invariant independently. A softer assertion that merely exempts the role read
 *      would still pass with the guard inside the transaction, which is exactly the regression
 *      this file exists to prevent.
 *
 * 606 is bounded too: it shares the same single-`PERIODO` header, so a cross-month window would
 * mislabel its rows exactly like 607/608. A legal single-month window must still export for all
 * three, or the guard has over-blocked.
 */

import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import { REPORTE_DGII_VENTANA_EXCEDIDA } from "../domain/errors";
import { ROL } from "../domain/roles";
import { normalizarFiltro } from "../domain/reporte-filtro";
import { generarTxt606, generarTxt607, generarTxt608 } from "./fiscal";

interface Lectura {
  readonly modelo: string;
}

/**
 * A recording `tx` with two modes:
 *   - `estricto: true` (refusal cases): every model read THROWS, so a read that happens before the
 *     window is validated is a loud failure rather than a quietly-accepted regression;
 *   - `estricto: false` (legal-window cases): reads succeed, the role read authorizes an
 *     Administrador, and the DGII aggregate comes back EMPTY (one en-cero part). GUC
 *     `set_config` calls are NOT recorded — they are not data reads.
 */
function crearTx(lecturas: Lectura[], estricto: boolean): PrismaTx {
  const leer = (modelo: string): void => {
    lecturas.push({ modelo });
    if (estricto) throw new Error(`lectura a "${modelo}" antes de validar la ventana`);
  };
  const tx = {
    $executeRaw(): Promise<number> {
      return Promise.resolve(1);
    },
    $queryRaw(): Promise<unknown[]> {
      leer("agregado");
      return Promise.resolve([]);
    },
    usuario: {
      findFirst(): Promise<{ roles: { rol: { nombre: string } }[] } | null> {
        leer("usuario");
        return Promise.resolve({ roles: [{ rol: { nombre: ROL.ADMINISTRADOR } }] });
      },
    },
    empresa: {
      findFirst(): Promise<{ rnc: string } | null> {
        leer("empresa");
        return Promise.resolve({ rnc: "130000001" });
      },
    },
    configuracionEmpresa: {
      findFirst(): Promise<{ valor: string } | null> {
        leer("configuracionEmpresa");
        return Promise.resolve(null);
      },
    },
  };
  return tx as unknown as PrismaTx;
}

function ctxAdmin(): TenantCtx {
  return { empresaId: 1, sucursalId: 1, usuarioId: 1, esAdmin: true };
}

/** The three DGII TXT exporters, so no format can silently lose the guard. */
const EXPORTADORES = [
  { nombre: "606", exportar: generarTxt606 },
  { nombre: "607", exportar: generarTxt607 },
  { nombre: "608", exportar: generarTxt608 },
] as const;

const ABRIL = { desde: "2026-04-01", hasta: "2026-04-30" }; // inside ONE month — legal
const CRUCE = { desde: "2026-04-01", hasta: "2026-05-01" }; // two months — refused
const SIN_FIN = { desde: "2026-04-01" }; // unbounded — refused

describe("DGII export window guard — a typed refusal, NEVER a P2028 (606, 607, 608)", () => {
  it.each(EXPORTADORES)("$nombre: refuses a cross-month window", async ({ exportar }) => {
    const lecturas: Lectura[] = [];
    const r = await exportar(crearTx(lecturas, true), ctxAdmin(), normalizarFiltro(CRUCE));

    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("unreachable");
    expect(r.code).toBe(REPORTE_DGII_VENTANA_EXCEDIDA);
    expect(r.message.length).toBeGreaterThan(0);
    // A P2028 is a Prisma failure that would surface as a THROWN error, never as a typed result.
    expect(JSON.stringify(r)).not.toContain("P2028");
  });

  it.each(EXPORTADORES)("$nombre: refuses an unbounded window", async ({ exportar }) => {
    const lecturas: Lectura[] = [];
    const r = await exportar(crearTx(lecturas, true), ctxAdmin(), normalizarFiltro(SIN_FIN));

    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("unreachable");
    expect(r.code).toBe(REPORTE_DGII_VENTANA_EXCEDIDA);
    expect(JSON.stringify(r)).not.toContain("P2028");
  });

  it.each(EXPORTADORES)("$nombre: refused BEFORE any DB read (zero reads, strict tx)", async ({ exportar }) => {
    const lecturas: Lectura[] = [];
    // The strict tx would have THROWN on the first read, so reaching here already proves the
    // validator ran first; this assertion pins it independently of that mechanism.
    const r = await exportar(crearTx(lecturas, true), ctxAdmin(), normalizarFiltro(CRUCE));

    expect(r.ok).toBe(false);
    expect(lecturas).toEqual([]);
  });

  it.each(EXPORTADORES)("$nombre: still exports a legal single-month window (no over-blocking)", async ({ exportar }) => {
    const lecturas: Lectura[] = [];
    const r = await exportar(crearTx(lecturas, false), ctxAdmin(), normalizarFiltro(ABRIL));

    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("unreachable");
    expect(r.data.codigo).toBeTruthy();
    expect(r.data.cantidadArchivos).toBe(1); // the en-cero part
    expect(lecturas.map((l) => l.modelo)).toContain("agregado");
  });
});
