/**
 * Application unit tests — `consultarConfiguracion` (adapter mocked).
 *
 * The Configuración tab is a READ-ONLY view, so the use case only formats what
 * the existing tenant readers already return:
 *   - retention rates come from compra's `leerTasasRetencionEnTx` (the reader
 *     hard-fails on a missing required key; here that gap becomes `null`, never
 *     a fabricated "0%" — the screen must show "no configurada");
 *   - NCF sequences come from the ncf module reader (active row per type), with
 *     bigint ranges rendered as decimal strings and "% used" computed by the
 *     pure domain helper;
 *   - ITBIS rates in use come from the repository's single product aggregation
 *     and are ordered/flagged by the pure domain (`itbisEnUso`); no empresa has
 *     a fabricated rate: no active products means an empty list.
 */

import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import {
  leerConfiguracionAdministracionEnTx,
  type ConfiguracionAdministracionLeida,
} from "../infrastructure/administracion-config-repository";
import { consultarConfiguracion } from "./consultar-configuracion";

jest.mock("../infrastructure/administracion-config-repository", () => ({
  leerConfiguracionAdministracionEnTx: jest.fn(),
}));

const tx = {} as unknown as PrismaTx;
const empresaId = 1;

function leida(
  overrides: Partial<ConfiguracionAdministracionLeida> = {},
): ConfiguracionAdministracionLeida {
  return {
    retenciones: { isr15: "15", isr2: "2", itbis100: "100", itbis30: "30" },
    secuenciasNcf: [],
    tasasItbis: [],
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  (leerConfiguracionAdministracionEnTx as jest.Mock).mockResolvedValue(leida());
});

describe("consultarConfiguracion", () => {
  it("passes the session empresaId to the adapter (never a caller-supplied one)", async () => {
    await consultarConfiguracion(tx, empresaId);

    expect(leerConfiguracionAdministracionEnTx).toHaveBeenCalledWith(tx, empresaId);
  });

  it("returns the retention rates exactly as the existing reader exposes them", async () => {
    const result = await consultarConfiguracion(tx, empresaId);

    expect(result).toEqual({
      ok: true,
      data: {
        retenciones: { isr15: "15", isr2: "2", itbis100: "100", itbis30: "30" },
        ncf: [],
        itbisEnUso: [],
      },
    });
  });

  it("renders a missing retention configuration as null (no invented 0%)", async () => {
    (leerConfiguracionAdministracionEnTx as jest.Mock).mockResolvedValue(
      leida({ retenciones: null }),
    );

    const result = await consultarConfiguracion(tx, empresaId);

    expect(result.ok === true && result.data.retenciones).toBeNull();
  });

  it("renders one NCF row per active sequence with strings and the % used", async () => {
    (leerConfiguracionAdministracionEnTx as jest.Mock).mockResolvedValue(
      leida({
        secuenciasNcf: [
          {
            tipo: "B01",
            rangoInicio: 1n,
            rangoFin: 1000n,
            secuenciaActual: 250n,
            vigenciaFin: new Date("2027-12-31T00:00:00.000Z"),
          },
          {
            tipo: "B02",
            rangoInicio: 1n,
            rangoFin: 100n,
            secuenciaActual: 0n,
            vigenciaFin: new Date("2027-12-31T00:00:00.000Z"),
          },
        ],
      }),
    );

    const result = await consultarConfiguracion(tx, empresaId);

    expect(result).toEqual({
      ok: true,
      data: {
        retenciones: { isr15: "15", isr2: "2", itbis100: "100", itbis30: "30" },
        ncf: [
          {
            tipo: "B01",
            rangoInicio: "1",
            rangoFin: "1000",
            secuenciaActual: "250",
            vigenciaFin: "2027-12-31T00:00:00.000Z",
            porcentajeUsado: 25,
          },
          {
            tipo: "B02",
            rangoInicio: "1",
            rangoFin: "100",
            secuenciaActual: "0",
            vigenciaFin: "2027-12-31T00:00:00.000Z",
            porcentajeUsado: 0,
          },
        ],
        itbisEnUso: [],
      },
    });
  });

  it("shapes the ITBIS rates in use: ordered, string rate, flagged for today's SD day", async () => {
    const desde = new Date("2026-01-01T04:00:00.000Z");
    (leerConfiguracionAdministracionEnTx as jest.Mock).mockResolvedValue(
      leida({
        tasasItbis: [
          { tasaItbis: "16.00", vigenteDesde: desde, vigenteHasta: new Date("2026-06-01T04:00:00.000Z"), productos: 2 },
          { tasaItbis: "18.00", vigenteDesde: desde, vigenteHasta: null, productos: 5 },
        ],
      }),
    );

    const result = await consultarConfiguracion(tx, empresaId, new Date("2026-11-14T15:00:00.000Z"));

    expect(result.data.itbisEnUso).toEqual([
      {
        tasaItbis: "18.00",
        vigenteDesde: "2026-01-01T04:00:00.000Z",
        vigenteHasta: null,
        productos: 5,
        vigenteHoy: true,
      },
      {
        tasaItbis: "16.00",
        vigenteDesde: "2026-01-01T04:00:00.000Z",
        vigenteHasta: "2026-06-01T04:00:00.000Z",
        productos: 2,
        vigenteHoy: false,
      },
    ]);
  });
});
