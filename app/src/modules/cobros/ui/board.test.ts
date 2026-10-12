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

describe("paginar (composition over server pages, R-C9)", () => {
  const items = Array.from({ length: 60 }, (_, i) => i + 1);

  it("passes the page-scoped bucket through — NO in-memory slicing happens here", () => {
    const p = paginar(items, { page: 1, totalPages: 3 });
    expect(p.items).toBe(items); // the bucket IS the server page's slice
    expect(p.total).toBe(60);
    expect(p.page).toBe(1);
    expect(p.totalPages).toBe(3);
  });

  it("page display comes from the SERVER metadata, clamped into [1, totalPages]", () => {
    expect(paginar([], { page: 2, totalPages: 3 }).page).toBe(2);
    // A stale snapshot never crashes the board.
    expect(paginar([], { page: 999, totalPages: 3 }).page).toBe(3);
    expect(paginar([], { page: 0, totalPages: 3 }).page).toBe(1);
    expect(paginar([], { page: -5, totalPages: 3 }).page).toBe(1);
  });

  it("an empty board still yields a single empty page (min-1 board semantics)", () => {
    const p = paginar<number>([], { page: 1, totalPages: 0 });
    expect(p.items).toHaveLength(0);
    expect(p.totalPages).toBe(1);
    expect(p.total).toBe(0);
  });
});
