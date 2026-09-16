/**
 * Unit — dashboard role gate + report role matrix + error catalog (DB-2). No DB.
 *
 * Pins the pure authorization decisions the http layer enforces: the exact tile set each
 * role may load (Admin all / Cobrador CxC-family only / other none), the per-report role
 * table (CxC widens to Cobrador, everything else is Admin-only, unlisted ids default
 * deny-to-Admin), and that every catalog error code yields a stable message.
 */

import {
  REPORTES_ERROR_CODES,
  REPORTE_NO_AUTORIZADO,
  REPORTE_VALIDACION,
  messageFor,
} from "./errors";
import {
  ROL,
  TILE_DASHBOARD,
  TILES_FAMILIA_CXC,
  alcanceDashboard,
  rolesPermitidosParaReporte,
  rolPermitidoParaReporte,
  tilesPermitidos,
} from "./roles";
import { CATALOGO_REPORTES, REPORTE_ID, esReporteId } from "./catalogo";

describe("tilesPermitidos — dashboard tile gate (DB-2)", () => {
  it("Administrador sees every tile", () => {
    expect(tilesPermitidos([ROL.ADMINISTRADOR])).toEqual(
      expect.arrayContaining([
        TILE_DASHBOARD.VENTAS_DIA,
        TILE_DASHBOARD.INVENTARIO,
        TILE_DASHBOARD.CXC,
      ]),
    );
    expect(tilesPermitidos([ROL.ADMINISTRADOR]).length).toBe(6);
  });

  it("Cobrador sees ONLY the CxC-family tiles", () => {
    expect(tilesPermitidos([ROL.COBRADOR])).toEqual([...TILES_FAMILIA_CXC]);
    expect(tilesPermitidos([ROL.COBRADOR]).includes(TILE_DASHBOARD.VENTAS_DIA)).toBe(
      false,
    );
  });

  it("Despachador / Operador / no-role see NO tiles", () => {
    expect(tilesPermitidos([ROL.DESPACHADOR])).toEqual([]);
    expect(tilesPermitidos([ROL.OPERADOR])).toEqual([]);
    expect(tilesPermitidos([])).toEqual([]);
  });

  it("Admin who also holds Cobrador is treated as Admin (wider wins)", () => {
    expect(tilesPermitidos([ROL.COBRADOR, ROL.ADMINISTRADOR]).length).toBe(6);
  });
});

describe("alcanceDashboard — widen-vs-pinned access scope (DB-2, DB-4)", () => {
  it("maps Admin→ADMIN, Cobrador→COBRADOR, everyone else→null (deny)", () => {
    expect(alcanceDashboard([ROL.ADMINISTRADOR])).toBe("ADMIN");
    expect(alcanceDashboard([ROL.COBRADOR])).toBe("COBRADOR");
    expect(alcanceDashboard([ROL.DESPACHADOR])).toBeNull();
    expect(alcanceDashboard([])).toBeNull();
  });
});

describe("rolesPermitidosParaReporte — per-report matrix (decision 5)", () => {
  it("the CxC family alone widens to include Cobrador", () => {
    expect(rolesPermitidosParaReporte(REPORTE_ID.CXC)).toEqual([
      ROL.ADMINISTRADOR,
      ROL.COBRADOR,
    ]);
    expect(rolPermitidoParaReporte([ROL.COBRADOR], REPORTE_ID.CXC)).toBe(true);
    expect(rolPermitidoParaReporte([ROL.COBRADOR], REPORTE_ID.VENTAS)).toBe(false);
    expect(rolPermitidoParaReporte([ROL.DESPACHADOR], REPORTE_ID.CXC)).toBe(false);
  });

  it("every catalog id defaults to Administrador-allowed", () => {
    for (const entrada of CATALOGO_REPORTES) {
      expect(rolPermitidoParaReporte([ROL.ADMINISTRADOR], entrada.id)).toBe(true);
    }
  });
});

describe("error catalog (19-directivas §9)", () => {
  it("every stable code yields a non-empty message", () => {
    expect(REPORTES_ERROR_CODES).toEqual([REPORTE_NO_AUTORIZADO, REPORTE_VALIDACION]);
    for (const code of REPORTES_ERROR_CODES) {
      expect(messageFor(code).length).toBeGreaterThan(0);
    }
  });

  it("esReporteId guards the deep-link transport", () => {
    expect(esReporteId(REPORTE_ID.CXC)).toBe(true);
    expect(esReporteId("noexiste")).toBe(false);
    expect(esReporteId(undefined)).toBe(false);
  });
});
