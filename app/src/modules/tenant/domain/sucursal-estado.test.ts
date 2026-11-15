import {
  decidirCambioEstadoSucursal,
  type HechosCambioEstadoSucursal,
} from "./sucursal-gestion";

const LIBRE = { usuarios: 0, stock: 0, documentosAbiertos: 0, saldos: 0 };

function hechos(over: Partial<HechosCambioEstadoSucursal> = {}): HechosCambioEstadoSucursal {
  return {
    sucursalId: 7,
    activaActual: true,
    activaSolicitada: false,
    conteos: LIBRE,
    sucursalSesionId: 1,
    sucursalesActivas: 3,
    ...over,
  };
}

describe("decidirCambioEstadoSucursal", () => {
  it("APLICAR a deactivation of an empty, non-session, non-last branch", () => {
    expect(decidirCambioEstadoSucursal(hechos())).toEqual({ tipo: "APLICAR" });
  });

  it.each([
    ["usuarios", { usuarios: 3 }, "USUARIOS"],
    ["stock", { stock: 12 }, "STOCK"],
    ["documentosAbiertos", { documentosAbiertos: 1 }, "DOCUMENTOS_ABIERTOS"],
    ["saldos", { saldos: 2 }, "SALDOS"],
  ] as const)("a blocker alone (%s) refuses with exactly its reason", (_n, conteo, motivo) => {
    expect(
      decidirCambioEstadoSucursal(hechos({ conteos: { ...LIBRE, ...conteo } })),
    ).toEqual({ tipo: "RECHAZAR", motivos: [motivo] });
  });

  it("reports ALL blockers together, not first-fail", () => {
    expect(
      decidirCambioEstadoSucursal(
        hechos({ conteos: { usuarios: 1, stock: 2, documentosAbiertos: 3, saldos: 4 } }),
      ),
    ).toEqual({
      tipo: "RECHAZAR",
      motivos: ["USUARIOS", "STOCK", "DOCUMENTOS_ABIERTOS", "SALDOS"],
    });
  });

  it("refuses the session's own branch, with its own reason", () => {
    expect(decidirCambioEstadoSucursal(hechos({ sucursalSesionId: 7 }))).toEqual({
      tipo: "RECHAZAR",
      motivos: ["SUCURSAL_PROPIA"],
    });
  });

  it("refuses the company's last active branch, with its own reason", () => {
    expect(decidirCambioEstadoSucursal(hechos({ sucursalesActivas: 1 }))).toEqual({
      tipo: "RECHAZAR",
      motivos: ["ULTIMA_ACTIVA"],
    });
  });

  it("own branch + last branch + blockers are all reported together", () => {
    expect(
      decidirCambioEstadoSucursal(
        hechos({
          sucursalSesionId: 7,
          sucursalesActivas: 1,
          conteos: { ...LIBRE, usuarios: 1, saldos: 1 },
        }),
      ),
    ).toEqual({
      tipo: "RECHAZAR",
      motivos: ["SUCURSAL_PROPIA", "ULTIMA_ACTIVA", "USUARIOS", "SALDOS"],
    });
  });

  it("an already inactive branch asked to deactivate is a no-op, even with leftovers or own branch", () => {
    expect(
      decidirCambioEstadoSucursal(
        hechos({
          activaActual: false,
          sucursalSesionId: 7,
          conteos: { usuarios: 5, stock: 5, documentosAbiertos: 5, saldos: 5 },
        }),
      ),
    ).toEqual({ tipo: "SIN_CAMBIO" });
  });

  it("an already active branch asked to activate is a no-op", () => {
    expect(
      decidirCambioEstadoSucursal(hechos({ activaSolicitada: true })),
    ).toEqual({ tipo: "SIN_CAMBIO" });
  });

  it("reactivation is never refused, whatever the counts", () => {
    expect(
      decidirCambioEstadoSucursal(
        hechos({
          activaActual: false,
          activaSolicitada: true,
          sucursalSesionId: 7,
          sucursalesActivas: 0,
          conteos: { usuarios: 9, stock: 9, documentosAbiertos: 9, saldos: 9 },
        }),
      ),
    ).toEqual({ tipo: "APLICAR" });
  });
});
