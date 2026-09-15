import { clasificarTableroCxc, paginar } from "./board";
import type { SaldoCxCVista } from "../application/consultar-saldo-cxc";
import type { EstadoPagoDerivado } from "../domain/pago";

function fila(over: Partial<SaldoCxCVista> & { facturaId: number }): SaldoCxCVista {
  return {
    clienteId: 1,
    total: "1000.00",
    cobrosAplicados: "0.00",
    saldoPendiente: "1000.00",
    estadoPago: "PENDIENTE" as EstadoPagoDerivado,
    enMora: false,
    vencimiento: "2026-01-31",
    creditoHabilitado: true,
    limiteCredito: "5000.00",
    ...over,
  };
}

describe("clasificarTableroCxc (R-C7 board buckets)", () => {
  it("splits Pendiente / Parcial / En Mora and drops settled (PAGADA) rows", () => {
    const filas: SaldoCxCVista[] = [
      fila({ facturaId: 1 }),
      fila({ facturaId: 2, estadoPago: "PARCIAL", cobrosAplicados: "400.00", saldoPendiente: "600.00" }),
      fila({ facturaId: 3, enMora: true }),
      fila({ facturaId: 4, estadoPago: "PAGADA", cobrosAplicados: "1000.00", saldoPendiente: "0.00" }),
    ];
    const tablero = clasificarTableroCxc(filas);
    expect(tablero.pendiente.map((f) => f.facturaId)).toEqual([1]);
    expect(tablero.parcial.map((f) => f.facturaId)).toEqual([2]);
    expect(tablero.enMora.map((f) => f.facturaId)).toEqual([3]);
    // PAGADA never appears in any bucket.
    expect(
      [...tablero.pendiente, ...tablero.parcial, ...tablero.enMora].some(
        (f) => f.estadoPago === "PAGADA",
      ),
    ).toBe(false);
  });

  it("mora takes precedence: a past-due partial lands in En Mora only, not Parcial", () => {
    const tablero = clasificarTableroCxc([
      fila({ facturaId: 5, estadoPago: "PARCIAL", cobrosAplicados: "400.00", saldoPendiente: "600.00", enMora: true }),
    ]);
    expect(tablero.enMora.map((f) => f.facturaId)).toEqual([5]);
    expect(tablero.parcial).toHaveLength(0);
    expect(tablero.pendiente).toHaveLength(0);
  });
});

describe("paginar (25/page default)", () => {
  const items = Array.from({ length: 60 }, (_, i) => i + 1);

  it("defaults to 25 per page (AGENTS.md list rule)", () => {
    const p1 = paginar(items, 1);
    expect(p1.page).toBe(1);
    expect(p1.items).toHaveLength(25);
    expect(p1.totalPages).toBe(3);
    expect(p1.total).toBe(60);
  });

  it("clamps an out-of-range page to the last page (stale deep link never crashes)", () => {
    expect(paginar(items, 999).page).toBe(3);
    expect(paginar(items, 0).page).toBe(1);
    expect(paginar(items, -5).page).toBe(1);
  });

  it("an empty list yields a single empty page", () => {
    const p = paginar<number>([], 1);
    expect(p.items).toHaveLength(0);
    expect(p.totalPages).toBe(1);
    expect(p.total).toBe(0);
  });

  it("the last page returns the remainder", () => {
    expect(paginar(items, 3).items).toHaveLength(10);
  });
});
