/**
 * Pure message builder of a refused branch deactivation
 * (odd/tasks/administracion-sucursales-activar.md S8, T2): every blocker with its
 * count, zero counts skipped, singular/plural, and the own-branch / last-branch
 * refusals reading their catalog text.
 */

import {
  TEN_CONCURRENCIA_CONFLICTO,
  TEN_SUCURSAL_CON_DOCUMENTOS_ABIERTOS,
  TEN_SUCURSAL_CON_SALDOS_PENDIENTES,
  TEN_SUCURSAL_CON_STOCK,
  TEN_SUCURSAL_CON_USUARIOS,
  TEN_SUCURSAL_PROPIA_NO_DESACTIVABLE,
  TEN_SUCURSAL_ULTIMA_ACTIVA,
  messageFor,
} from "../../domain/errors";
import {
  mensajeBloqueosSucursal,
  mensajeErrorCambioEstadoSucursal,
} from "../administracion-tabs";

const CERO = { usuarios: 0, stock: 0, documentosAbiertos: 0, saldos: 0 };

describe("mensajeBloqueosSucursal", () => {
  it("lists all four blockers with their counts, in a fixed order", () => {
    expect(
      mensajeBloqueosSucursal({ usuarios: 3, stock: 12, documentosAbiertos: 1, saldos: 2 }),
    ).toBe(
      "No se puede desactivar: 3 usuarios activos, 12 productos con existencias, 1 documento abierto, 2 facturas con saldo pendiente.",
    );
  });

  it("uses the singular for exactly one of each", () => {
    expect(
      mensajeBloqueosSucursal({ usuarios: 1, stock: 1, documentosAbiertos: 1, saldos: 1 }),
    ).toBe(
      "No se puede desactivar: 1 usuario activo, 1 producto con existencias, 1 documento abierto, 1 factura con saldo pendiente.",
    );
  });

  it.each([
    [{ ...CERO, usuarios: 2 }, "No se puede desactivar: 2 usuarios activos."],
    [{ ...CERO, stock: 5 }, "No se puede desactivar: 5 productos con existencias."],
    [{ ...CERO, documentosAbiertos: 4 }, "No se puede desactivar: 4 documentos abiertos."],
    [{ ...CERO, saldos: 1 }, "No se puede desactivar: 1 factura con saldo pendiente."],
  ])("a single blocker %j reads on its own", (conteos, esperado) => {
    expect(mensajeBloqueosSucursal(conteos)).toBe(esperado);
  });

  it("skips the zero counts", () => {
    expect(mensajeBloqueosSucursal({ usuarios: 3, stock: 0, documentosAbiertos: 0, saldos: 2 })).toBe(
      "No se puede desactivar: 3 usuarios activos, 2 facturas con saldo pendiente.",
    );
  });

  it("is null when nothing blocks", () => {
    expect(mensajeBloqueosSucursal(CERO)).toBeNull();
  });
});

describe("mensajeErrorCambioEstadoSucursal", () => {
  it("builds the multi-blocker sentence from detalle", () => {
    expect(
      mensajeErrorCambioEstadoSucursal({
        code: TEN_SUCURSAL_CON_USUARIOS,
        message: "servidor",
        detalle: {
          usuarios: 3,
          stock: 12,
          documentosAbiertos: 0,
          saldos: 2,
          codigos: [
            TEN_SUCURSAL_CON_USUARIOS,
            TEN_SUCURSAL_CON_STOCK,
            TEN_SUCURSAL_CON_SALDOS_PENDIENTES,
          ],
        },
      }),
    ).toBe(
      "No se puede desactivar: 3 usuarios activos, 12 productos con existencias, 2 facturas con saldo pendiente.",
    );
  });

  it("the own branch reads its catalog message", () => {
    expect(
      mensajeErrorCambioEstadoSucursal({
        code: TEN_SUCURSAL_PROPIA_NO_DESACTIVABLE,
        message: "servidor",
        detalle: { ...CERO, codigos: [TEN_SUCURSAL_PROPIA_NO_DESACTIVABLE] },
      }),
    ).toBe(messageFor(TEN_SUCURSAL_PROPIA_NO_DESACTIVABLE));
  });

  it("the last active branch reads its catalog message", () => {
    expect(
      mensajeErrorCambioEstadoSucursal({
        code: TEN_SUCURSAL_ULTIMA_ACTIVA,
        message: "servidor",
        detalle: { ...CERO, codigos: [TEN_SUCURSAL_ULTIMA_ACTIVA] },
      }),
    ).toBe(messageFor(TEN_SUCURSAL_ULTIMA_ACTIVA));
  });

  it("own branch wins over the data blockers when both apply", () => {
    expect(
      mensajeErrorCambioEstadoSucursal({
        code: TEN_SUCURSAL_PROPIA_NO_DESACTIVABLE,
        message: "servidor",
        detalle: {
          ...CERO,
          usuarios: 2,
          codigos: [TEN_SUCURSAL_PROPIA_NO_DESACTIVABLE, TEN_SUCURSAL_CON_USUARIOS],
        },
      }),
    ).toBe(messageFor(TEN_SUCURSAL_PROPIA_NO_DESACTIVABLE));
  });

  it("a blocker code without detalle falls back to its catalog message", () => {
    expect(
      mensajeErrorCambioEstadoSucursal({
        code: TEN_SUCURSAL_CON_DOCUMENTOS_ABIERTOS,
        message: "servidor",
      }),
    ).toBe(messageFor(TEN_SUCURSAL_CON_DOCUMENTOS_ABIERTOS));
  });

  it("other catalog codes use the catalog; unknown codes keep the server message", () => {
    expect(
      mensajeErrorCambioEstadoSucursal({ code: TEN_CONCURRENCIA_CONFLICTO, message: "x" }),
    ).toBe(messageFor(TEN_CONCURRENCIA_CONFLICTO));
    expect(
      mensajeErrorCambioEstadoSucursal({ code: "VALIDATION_ERROR", message: "Datos de entrada inválidos" }),
    ).toBe("Datos de entrada inválidos");
  });
});
