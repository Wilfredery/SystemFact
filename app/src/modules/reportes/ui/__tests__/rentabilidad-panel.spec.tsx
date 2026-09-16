/**
 * @jest-environment jsdom
 *
 * Reportes UI — the rentabilidad result panel (REN-3; slice D, task 4.3). Same boundary-mock
 * convention as `auditoria/ui/__tests__/auditoria-ui.spec.tsx`: the panel renders against the read
 * DTO contract ONLY — never a database. `next/link` is stubbed to a plain anchor (no App Router
 * context in the test host).
 *
 * Pins the REN-3 half the integration suite cannot prove (the on-screen render): the cost-basis
 * limitation disclaimer is VISIBLE in the panel using the SAME frozen string the CSV footer writes,
 * the per-product figures render from the Decimal strings AS-IS (money formatted, never recomputed),
 * and the Exportar affordance points at the shared `/reportes/exportar` seam carrying the rentabilidad
 * id (EXP-5 gate-identical export link).
 */

import "@testing-library/jest-dom";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { PanelRentabilidad } from "@/modules/reportes/ui/rentabilidad-panel";
import { NOTA_LIMITACION_RENTABILIDAD } from "@/modules/reportes/domain/margen";
import type { RentabilidadFila } from "@/modules/reportes/domain/margen";
import type { Pagina } from "@/modules/reportes/domain/reporte-resultado";
import type { SeleccionReporte } from "@/modules/reportes/ui/url";
import { REPORTE_ID } from "@/modules/reportes/domain/catalogo";

// next/link renders a plain anchor in the test host (no App Router context).
jest.mock("next/link", () => ({
  __esModule: true,
  default: ({ href, children }: { readonly href?: string; readonly children?: ReactNode }) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const React = require("react");
    return React.createElement("a", { href: href ?? "#" }, children);
  },
}));

afterEach(cleanup);

const filaArroz: RentabilidadFila = {
  productoId: 7,
  nombre: "Arroz",
  precioCosto: "60.00",
  precioSalida: "92.00",
  unidadesVendidas: "50.000",
  unidadesCompradas: "50.000",
  ventas: "4600.00",
  inversion: "2600.00",
  capital: "300.00",
  margen: "1600.00",
  margenPorciento: "34.78",
};

function pagina(over: Partial<Pagina<RentabilidadFila>> = {}): Pagina<RentabilidadFila> {
  return {
    filas: [filaArroz],
    total: 1,
    page: 1,
    pageSize: 25,
    totalPages: 1,
    resumen: {
      productos: "1",
      unidadesVendidas: "50.000",
      unidadesCompradas: "50.000",
      ventas: "4600.00",
      inversion: "2600.00",
      capital: "300.00",
      margen: "1600.00",
      margenPorciento: "34.78",
    },
    ...over,
  };
}

const seleccion: SeleccionReporte = {
  reporte: REPORTE_ID.RENTABILIDAD,
  filtro: { desde: "2026-04-01", hasta: "2026-04-30" },
};

describe("PanelRentabilidad (REN-3 disclaimer in-panel + figures + export link)", () => {
  it("renders the cost-basis limitation verbatim — the SAME string the CSV writes", () => {
    render(<PanelRentabilidad pagina={pagina()} seleccion={seleccion} />);
    // The disclaimer text is present exactly as the domain constant (no drift, no paraphrase).
    expect(screen.getByText(NOTA_LIMITACION_RENTABILIDAD)).toBeInTheDocument();
  });

  it("renders the per-product figures from the Decimal strings (money formatted, never recomputed)", () => {
    render(<PanelRentabilidad pagina={pagina()} seleccion={seleccion} />);
    const row = screen.getByText("Arroz").closest("tr");
    expect(row?.textContent).toContain("1,600.00"); // margen (DOP display of 1600.00)
    expect(row?.textContent).toContain("92.00"); // weighted salida price
    expect(row?.textContent).toContain("34.78%"); // margin %
  });

  it("points the export affordance at the shared /reportes/exportar seam with the rentabilidad id", () => {
    render(<PanelRentabilidad pagina={pagina()} seleccion={seleccion} />);
    const link = screen.getByRole("link", { name: "Exportar CSV" });
    const href = link.getAttribute("href") ?? "";
    expect(href).toContain("/reportes/exportar");
    expect(href).toContain(`reporte=${REPORTE_ID.RENTABILIDAD}`);
    // EXP-2: an export is the full filtered dataset — no page param leaks into the export href.
    expect(href).not.toContain("page=");
  });
});
