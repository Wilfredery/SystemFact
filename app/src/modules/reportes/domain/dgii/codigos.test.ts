/**
 * Unit tests — the DB-backed 607 Tipo-Ingreso resolution + the conservative 608 reason map + the
 * 606 code derivations (FIS-3/FIS-4/FIS-5; U3 backing, tasks 5.1/5.2/5.4/5.5).
 *
 * PURE (no DB). These pin the two config-seam rules the binding decision requires: Tipo-Ingreso and
 * the 608 reason code are resolved from DATA (a passed-in DB map / a reason TEXT), never a hardcoded
 * per-document constant, with a single documented safe default; and the 606 B11/ITBIS and code
 * derivations follow FIS-1/FIS-4 exactly.
 */

import {
  TIPO_INGRESO_POR_DEFECTO,
  resolverTipoIngreso,
} from "./tipo-ingreso";
import {
  TIPO_ANULACION,
  TIPO_ANULACION_POR_DEFECTO,
  esTipoAnulacionValido,
  mapearTipoAnulacion,
} from "./tipo-anulacion";
import {
  FORMA_PAGO_606,
  TIPO_BIENES_SERVICIOS,
  derivarFormaPago606,
  derivarItbis606,
  derivarTipoBienesServicios,
  derivarTipoRetencionISR,
  correspondeA606,
} from "./mapeo-606";

describe("dgii/tipo-ingreso — U3 backed by a DB map, safe default otherwise (task 5.2)", () => {
  it("returns the configured code for a class present in the map", () => {
    const mapa = { B01: "01", B02: "02", B04: "04" };
    expect(resolverTipoIngreso("B01", mapa)).toBe("01");
    expect(resolverTipoIngreso("B04", mapa)).toBe("04");
  });
  it("falls back to the SINGLE documented default for an unconfigured class (never a per-row guess)", () => {
    expect(resolverTipoIngreso("B99", { B01: "01" })).toBe(TIPO_INGRESO_POR_DEFECTO);
    expect(resolverTipoIngreso("B01", {})).toBe(TIPO_INGRESO_POR_DEFECTO);
    // An empty configured value is treated as unset, not as a real code.
    expect(resolverTipoIngreso("B01", { B01: "" })).toBe(TIPO_INGRESO_POR_DEFECTO);
  });
});

describe("dgii/tipo-anulacion — 608 reason code from free-text motivo, conservative default (5.5)", () => {
  it("maps a keyword-matched reason to its DGII code, accent/case-insensitive", () => {
    expect(mapearTipoAnulacion("Devolución de productos")).toBe(TIPO_ANULACION.DEVOLUCION_PRODUCTOS); // 6
    expect(mapearTipoAnulacion("devuelta por cliente")).toBe(TIPO_ANULACION.DEVOLUCION_PRODUCTOS);
    expect(mapearTipoAnulacion("Cambio de producto")).toBe(TIPO_ANULACION.CAMBIO_PRODUCTOS); // 5
    expect(mapearTipoAnulacion("error de secuencia")).toBe(TIPO_ANULACION.ERRORES_SECUENCIA); // 8
    expect(mapearTipoAnulacion("cese de operaciones")).toBe(TIPO_ANULACION.CESE_OPERACIONES); // 9
    expect(mapearTipoAnulacion("hurto de talonario")).toBe(TIPO_ANULACION.PERDIDA_HURTO); // 10
    expect(mapearTipoAnulacion("Error de captura")).toBe(TIPO_ANULACION.CORRECCION_INFORMACION); // 4
  });
  it("an unknown or blank reason resolves to the conservative default (code 4), never blank", () => {
    expect(mapearTipoAnulacion("motivo sin palabra clave")).toBe(TIPO_ANULACION_POR_DEFECTO);
    expect(mapearTipoAnulacion("")).toBe(TIPO_ANULACION_POR_DEFECTO);
    expect(mapearTipoAnulacion(null)).toBe(TIPO_ANULACION_POR_DEFECTO);
  });
  it("every mapped code is a valid 1–10 DGII reason", () => {
    for (const m of ["Devolución", "Cambio", "secuencia", "cese", "hurto", "nada"]) {
      expect(esTipoAnulacionValido(mapearTipoAnulacion(m))).toBe(true);
    }
  });
});

describe("dgii/mapeo-606 — the 606 code derivations (FIS-4/FIS-1, task 5.4)", () => {
  it("derivaTipoBienesServicios maps tipoCompra to the NG 06-2014 category (09/02/03), 06 otherwise", () => {
    expect(derivarTipoBienesServicios("MERCANCIA")).toBe(TIPO_BIENES_SERVICIOS.COSTO_DE_VENTA); // 09
    expect(derivarTipoBienesServicios("SERVICIO_PROFESIONAL")).toBe(TIPO_BIENES_SERVICIOS.TRABAJOS_SUMINISTROS_SERVICIOS); // 02
    expect(derivarTipoBienesServicios("ALQUILER")).toBe(TIPO_BIENES_SERVICIOS.ARRENDAMIENTOS); // 03
    expect(derivarTipoBienesServicios(null)).toBe(TIPO_BIENES_SERVICIOS.OTRAS_DEDUCCIONES); // 06
  });

  it("derivarItbis606 carries the WHOLE ITBIS to cost for an INFORMAL (B11) purchase — no credit", () => {
    const informal = derivarItbis606({ itbisFacturado: "354.00", proveedorInformal: true });
    expect(informal.itbisAlCosto).toBe("354.00");
    expect(informal.itbisPorAdelantar).toBe("0.00");
    expect(informal.itbisProporcionalidad).toBe("0.00");
  });

  it("derivarItbis606 takes the ITBIS as advance (D15) for a FORMAL purchase", () => {
    const formal = derivarItbis606({ itbisFacturado: "354.00", proveedorInformal: false });
    expect(formal.itbisAlCosto).toBe("0.00");
    expect(formal.itbisPorAdelantar).toBe("354.00");
  });

  it("derivarTipoRetencionISR returns 0 when no ISR was withheld, else classifies; DB map wins", () => {
    expect(derivarTipoRetencionISR({ tipoCompra: "MERCANCIA", montoRetencionIsr: "0.00" })).toBe(0);
    expect(derivarTipoRetencionISR({ tipoCompra: "SERVICIO_PROFESIONAL", montoRetencionIsr: "90.00" })).toBe(1);
    expect(derivarTipoRetencionISR({ tipoCompra: "ALQUILER", montoRetencionIsr: "100.00" })).toBe(2);
    // A configured DB value overrides the pure classification (config seam).
    expect(derivarTipoRetencionISR({ tipoCompra: "ALQUILER", montoRetencionIsr: "100.00", mapa: { ALQUILER: "5" } })).toBe(5);
  });

  it("derivarFormaPago606 → Efectivo when paid, Crédito when a RECIBIDA is still unpaid", () => {
    expect(derivarFormaPago606({ estado: "PAGADA", pagado: "0.00" })).toBe(FORMA_PAGO_606.EFECTIVO);
    expect(derivarFormaPago606({ estado: "RECIBIDA", pagado: "500.00" })).toBe(FORMA_PAGO_606.EFECTIVO);
    expect(derivarFormaPago606({ estado: "RECIBIDA", pagado: "0.00" })).toBe(FORMA_PAGO_606.CREDITO);
  });

  it("correspondeA606 admits ONLY RECIBIDA/PAGADA and rejects the rest (FIS-4 draft excluded)", () => {
    expect(correspondeA606("RECIBIDA")).toBe(true);
    expect(correspondeA606("PAGADA")).toBe(true);
    for (const e of ["BORRADOR", "PENDIENTE", "CANCELADA"]) expect(correspondeA606(e)).toBe(false);
  });
});
