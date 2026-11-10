/**
 * @jest-environment jsdom
 *
 * CxP read-only panel (odd/tasks/compras.md, T4: S8). The panel is a pure SERVER
 * presentational component: it renders the `Pagina<CxpFila>` the report action
 * already returned, with its Decimal STRINGS formatted for display only (S6).
 *
 * S8: columns proveedor / documento / fecha / sucursal / saldoPendiente / estado,
 * the applied-payments summary the row shape provides (`pagado`), the
 * page-independent total from `resumen`, the empty state, and link pagination
 * over `consultarCxPAction`'s `Pagina` contract. The view is read-only: no write
 * control exists anywhere in it (no payment creation — YAGNI).
 */

import "@testing-library/jest-dom";
import { render, screen, within } from "@testing-library/react";
import { CxpPanel } from "../CxpPanel";

type FilaCxP = Parameters<typeof CxpPanel>[0]["pagina"]["filas"][number];

const PENDIENTE: FilaCxP = {
  compraId: 31,
  proveedorId: 4,
  proveedorNombre: "Distribuidora Norte",
  sucursalId: 1,
  sucursalNombre: "Principal",
  fechaSD: "2026-11-09",
  estado: "PENDIENTE",
  total: "1234.50",
  pagado: "234.50",
  saldoPendiente: "1000.00",
};

const RECIBIDA: FilaCxP = {
  compraId: 32,
  proveedorId: 5,
  proveedorNombre: "Suplidor Sur",
  sucursalId: 2,
  sucursalNombre: "Sucursal Este",
  fechaSD: "2026-11-10",
  estado: "RECIBIDA",
  total: "5000.00",
  pagado: "0.00",
  saldoPendiente: "5000.00",
};

function pagina(parcial: Partial<Parameters<typeof CxpPanel>[0]["pagina"]> = {}) {
  return {
    filas: [PENDIENTE, RECIBIDA],
    total: 30,
    page: 1,
    pageSize: 25,
    totalPages: 2,
    resumen: { saldoTotal: "6000.00", comprasAbiertas: "30" },
    ...parcial,
  };
}

const href = (page: number): string => `/compras?cxpPage=${page}`;

function montar(p: Partial<Parameters<typeof CxpPanel>[0]["pagina"]> = {}) {
  return render(<CxpPanel pagina={pagina(p)} hrefPagina={href} />);
}

describe("CxpPanel (S8)", () => {
  it("renders the CxP table with supplier, document, date, branch, balance and state", () => {
    montar();

    const seccion = screen.getByRole("region", { name: "Cuentas por pagar" });
    const fila = within(seccion).getByTestId("cxp-fila-31");

    expect(within(fila).getByText("Distribuidora Norte")).toBeInTheDocument();
    expect(within(fila).getByText("31")).toBeInTheDocument();
    expect(within(fila).getByText("09/11/2026")).toBeInTheDocument();
    expect(within(fila).getByText("Principal")).toBeInTheDocument();
    expect(within(fila).getByText("RD$ 1,000.00")).toBeInTheDocument();
    expect(within(fila).getByText("Pendiente")).toBeInTheDocument();
    // The row shape carries the applied payments, so the summary is shown.
    expect(within(fila).getByText("RD$ 234.50")).toBeInTheDocument();
  });

  it("formats the page-independent totals from the Decimal strings of `resumen`", () => {
    montar();

    expect(screen.getByText(/RD\$ 6,000\.00/)).toBeInTheDocument();
    expect(screen.getByText(/30 compras abiertas/)).toBeInTheDocument();
  });

  it("renders the empty state when no payable is open", () => {
    montar({
      filas: [],
      total: 0,
      totalPages: 0,
      resumen: { saldoTotal: "0.00", comprasAbiertas: "0" },
    });

    expect(screen.getByText("No hay cuentas por pagar pendientes.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("paginates with next/previous links over the action's Pagina contract", () => {
    montar();

    const nav = screen.getByRole("navigation", { name: "Paginación cuentas por pagar" });
    expect(within(nav).getByText("Página 1 de 2 · 30 resultados")).toBeInTheDocument();
    expect(within(nav).getByRole("link", { name: "Siguiente" })).toHaveAttribute(
      "href",
      "/compras?cxpPage=2",
    );
    expect(within(nav).queryByRole("link", { name: "Anterior" })).not.toBeInTheDocument();
  });

  it("offers no write control: the CxP view is read-only", () => {
    montar();

    const seccion = screen.getByRole("region", { name: "Cuentas por pagar" });
    expect(within(seccion).queryAllByRole("button")).toHaveLength(0);
    expect(within(seccion).queryAllByRole("textbox")).toHaveLength(0);
    // No payment-creation affordance either (S8: YAGNI, read-only view).
    expect(
      within(seccion).queryByRole("link", { name: /pagar|registrar|crear/i }),
    ).not.toBeInTheDocument();
    expect(
      within(seccion).queryByText(/registrar pago|crear pago|pagar compra/i),
    ).not.toBeInTheDocument();
  });
});
