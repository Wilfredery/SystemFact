/**
 * Colocated unit tests — pure original-line resolver (quality-polish 1e).
 *
 * Locks the behavior of `resolverLineasContraVentaOriginal`, extracted verbatim
 * from the inline loop that R-V15/R-D5 pinned: each requested return line must
 * name a product present in the ORIGINAL sale (else LINEA_INVALIDA), the NC
 * money/rate freeze from the original row, quantities keep their raw string
 * (re-validated through the Decimal-grammar probe), and a product may appear in
 * several lines (VENDIBLE + DANADO) — each resolved against the same original.
 * The cumulative cap, idempotency gate and consume→write ordering run later in
 * the use case and stay under the devolucion integration suites.
 */

import { Decimal } from "decimal.js";
import {
  LINEA_INVALIDA,
  VentaDomainError,
} from "../../venta/domain/errors";
import { TIPO_REPOSICION, type TipoReposicion } from "../domain/devolucion";
import {
  resolverLineasContraVentaOriginal,
  type LineaDevolucionInput,
} from "./crear-devolucion";

// The helper under test is pure; stub the use case's DB-facing graph so the
// module loads without touching the (jest-stubbed) generated Prisma enums —
// the same isolation `venta-service.test.ts` uses. None of these are called.
jest.mock("../../venta/infrastructure/config-repository", () => ({
  leerPlazoDevolucionEnTx: jest.fn(),
  PLAZO_DEVOLUCION_FALTANTE: "PLAZO_DEVOLUCION_FALTANTE",
  VentaConfigError: class VentaConfigError extends Error {},
}));
jest.mock("../../venta/infrastructure/venta-repository", () => ({
  leerVentaParaDevolucionEnTx: jest.fn(),
}));
jest.mock("@/modules/ncf/application/consumir-ncf", () => ({
  consumirNcfEnTx: jest.fn(),
  NcfConsumoError: class NcfConsumoError extends Error {},
}));
jest.mock("@/modules/inventario/application/registrar-salidas-venta", () => ({
  registrarDevolucion: jest.fn(),
}));
jest.mock("../infrastructure/devolucion-repository", () => ({
  crearDetalleNotaCreditoEnTx: jest.fn(),
  crearNotaCreditoEnTx: jest.fn(),
  existeDevolucionIdenticaEnTx: jest.fn(),
  leerPriorNCsPorFacturaEnTx: jest.fn(),
  leerStockSucursalEnTx: jest.fn(),
  registrarAuditNotaCreditoEnTx: jest.fn(),
}));

const ventaLinea = (
  productoId: number,
  cantidad: string,
  precioUnitario = "120.00",
  tasaItbis = "18",
) => ({ productoId, cantidad, precioUnitario, tasaItbis });

const retorno = (
  productoId: number,
  cantidad: string,
  tipoReposicion: TipoReposicion = TIPO_REPOSICION.VENDIBLE,
): LineaDevolucionInput => ({ productoId, cantidad, tipoReposicion });

describe("resolverLineasContraVentaOriginal (pure frozen-mirror resolver)", () => {
  it("freezes price and rate from the ORIGINAL line and keeps input order", () => {
    const resultado = resolverLineasContraVentaOriginal(
      [retorno(2, "1.5", TIPO_REPOSICION.DANADO), retorno(1, "2")],
      [ventaLinea(1, "10", "50.00", "0"), ventaLinea(2, "4", "80.00", "16")],
    );

    expect(resultado.lineas).toEqual([
      {
        productoId: 2,
        cantidad: "1.5",
        precioUnitario: "80.00",
        tasaItbis: "16",
        tipoReposicion: TIPO_REPOSICION.DANADO,
      },
      {
        productoId: 1,
        cantidad: "2",
        precioUnitario: "50.00",
        tasaItbis: "0",
        tipoReposicion: TIPO_REPOSICION.VENDIBLE,
      },
    ]);
    expect(resultado.cantidades.map((c) => c.toString())).toEqual(["1.5", "2"]);
    expect(resultado.originales.map((o) => o.toString())).toEqual(["4", "10"]);
  });

  it("resolves the same product twice (VENDIBLE + DANADO) against one original row", () => {
    const resultado = resolverLineasContraVentaOriginal(
      [retorno(1, "1"), retorno(1, "2", TIPO_REPOSICION.DANADO)],
      [ventaLinea(1, "5")],
    );
    expect(resultado.lineas).toHaveLength(2);
    expect(resultado.lineas[0]?.precioUnitario).toBe("120.00");
    expect(resultado.lineas[1]?.precioUnitario).toBe("120.00");
    expect(resultado.cantidades.map((c) => c.toString())).toEqual(["1", "2"]);
    expect(resultado.originales.map((o) => o.toString())).toEqual(["5", "5"]);
  });

  it("returns empty arrays for an empty line list (the use case gates LINEAS_VACIAS separately)", () => {
    const resultado = resolverLineasContraVentaOriginal([], [ventaLinea(1, "5")]);
    expect(resultado.lineas).toEqual([]);
    expect(resultado.cantidades).toEqual([]);
    expect(resultado.originales).toEqual([]);
  });

  it("throws LINEA_INVALIDA for a product never sold in the original", () => {
    expect(() =>
      resolverLineasContraVentaOriginal([retorno(99, "1")], [ventaLinea(1, "5")]),
    ).toThrow(VentaDomainError);
    expect(() =>
      resolverLineasContraVentaOriginal([retorno(99, "1")], [ventaLinea(1, "5")]),
    ).toThrow(
      expect.objectContaining({
        code: LINEA_INVALIDA,
        details: { productoId: 99 },
      }),
    );
  });

  it("rejects a quantity outside the Decimal(12,3) grammar with LINEA_INVALIDA", () => {
    expect(() =>
      resolverLineasContraVentaOriginal([retorno(1, "1.2345")], [ventaLinea(1, "5")]),
    ).toThrow(expect.objectContaining({ code: LINEA_INVALIDA, details: { productoId: 1 } }));
  });

  it("rejects an unknown reposicion type with LINEA_INVALIDA before any other work", () => {
    const linea = { productoId: 1, cantidad: "1", tipoReposicion: "OTRO" } as const;
    expect(() =>
      resolverLineasContraVentaOriginal(
        [linea as unknown as LineaDevolucionInput],
        [ventaLinea(1, "5")],
      ),
    ).toThrow(expect.objectContaining({ code: LINEA_INVALIDA, details: { tipoReposicion: "OTRO" } }));
  });

  it("keeps quantities and originals aligned by index with the returned lines", () => {
    const resultado = resolverLineasContraVentaOriginal(
      [retorno(1, "0.5"), retorno(2, "3")],
      [ventaLinea(1, "5"), ventaLinea(2, "8")],
    );
    resultado.lineas.forEach((linea, i) => {
      expect(resultado.cantidades[i]?.toString()).toBe(linea.cantidad);
      expect(resultado.originales[i]?.toString()).toBe(linea.productoId === 1 ? "5" : "8");
    });
    expect(resultado.cantidades[0]).toBeInstanceOf(Decimal);
  });
});
