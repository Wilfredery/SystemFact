/**
 * @jest-environment jsdom
 */
/**
 * RTL — printable fiscal-invoice island (factura-print.md T2, S2/S3/S4).
 *
 * Pins the DGII 254-06 document contract on the public interface: denomination
 * per type top-right, the NCF clearly visible, the NCF expiry date rendered
 * when present, emisor RNC, ITBIS desglosado per rate, total, forma de pago
 * derived from the canonical balance, the CANCELADA/ANULADA fiscal banners
 * (S4), the typed error path (no provider leakage), and a print button whose
 * only effect is window.print(). The print isolation `<style>` ships with
 * `@media print` rules (new capability in the app) — asserted structurally.
 */

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

import { FacturaPrintScreen } from "@/modules/venta/ui/FacturaPrintScreen";
import { consultarFacturaParaImpresionAction } from "@/modules/venta/http/actions.lectura";
import type { FacturaParaImpresionVista } from "@/modules/venta/application/consultar-factura-impresion";

jest.mock("next/link", () => ({
  __esModule: true,
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

jest.mock("@/modules/venta/http/actions.lectura", () => ({
  consultarFacturaParaImpresionAction: jest.fn(),
}));

const mockAction = jest.mocked(consultarFacturaParaImpresionAction);

const VISTA_BASE: FacturaParaImpresionVista = {
  facturaId: 77,
  ventaId: 501,
  tipoNcf: "B02",
  ncf: "B0200000522",
  correlativoInterno: "F-2026-0031",
  estado: "VIGENTE",
  fechaEmision: "2026-01-10T14:00:00.000Z",
  ventaFecha: "2026-01-10T14:00:00.000Z",
  ncfVigenciaFin: "2030-06-30",
  empresa: {
    nombreComercial: "Abarrotes SS",
    razonSocial: "Abarrotes SS SRL",
    rnc: "131045677",
    direccionFiscal: "Av. Duarte 45, Santo Domingo",
    telefono: "809-555-0101",
    regimenFiscal: "ORDINARIO",
  },
  sucursal: { nombre: "Matriz", direccion: "Av. Duarte 45", telefono: "809-555-0101" },
  cliente: { nombre: "Consumidor Final", identificacionFiscal: null, esConsumidorFinal: true },
  usuarioNombre: "Ana",
  lineas: [
    {
      productoNombre: "Arroz 25 lb",
      cantidad: "2",
      precioUnitario: "100.00",
      tasaItbis: "18.00",
      descuentoLinea: "0.00",
      descuentoTipo: "PORCENTAJE",
      itbisLinea: "36.00",
      subtotalLinea: "236.00",
    },
    {
      productoNombre: "Aceite 1 gal (tarifa reducida)",
      cantidad: "1",
      precioUnitario: "50.00",
      tasaItbis: "16.00",
      descuentoLinea: "0.00",
      descuentoTipo: "PORCENTAJE",
      itbisLinea: "8.00",
      subtotalLinea: "58.00",
    },
  ],
  desgloseItbis: [
    { tasa: "18.00", itbis: "36.00" },
    { tasa: "16.00", itbis: "8.00" },
  ],
  subtotalGravado: "250.00",
  subtotalExento: "0.00",
  descuento: "0.00",
  itbis: "44.00",
  total: "294.00",
  saldo: { total: "294.00", cobrosAplicados: "294.00", saldoPendiente: "0.00" },
};

afterEach(() => {
  cleanup();
  mockAction.mockReset();
});

describe("FacturaPrintScreen (factura-print.md T2)", () => {
  it("renders the DGII header: denomination per type, visible NCF, expiry, emisor RNC", async () => {
    mockAction.mockResolvedValue({ ok: true, data: VISTA_BASE });
    render(<FacturaPrintScreen facturaId={77} />);
    await screen.findByTestId("factura-print");

    expect(screen.getByTestId("factura-denominacion").textContent).toBe("Factura de Consumo");
    expect(screen.getByTestId("factura-ncf").textContent).toContain("B0200000522");
    expect(screen.getByTestId("factura-ncf-vigencia").textContent).toContain("2030-06-30");
    expect(screen.getByTestId("factura-empresa-rnc").textContent).toContain("131045677");
    expect(screen.getByTestId("factura-cliente-nombre").textContent).toBe("Consumidor Final");
  });

  it("uses the B01 denomination for a crédito-fiscal invoice", async () => {
    mockAction.mockResolvedValue({
      ok: true,
      data: { ...VISTA_BASE, tipoNcf: "B01", ncf: "B0100000077" },
    });
    render(<FacturaPrintScreen facturaId={77} />);
    await screen.findByTestId("factura-print");

    expect(screen.getByTestId("factura-denominacion").textContent).toBe(
      "Factura de Crédito Fiscal",
    );
  });

  it("renders the ITBIS desglosado per rate and the total", async () => {
    mockAction.mockResolvedValue({ ok: true, data: VISTA_BASE });
    render(<FacturaPrintScreen facturaId={77} />);
    await screen.findByTestId("factura-print");

    expect(screen.getByTestId("factura-itbis-18_00").textContent).toContain("36.00");
    expect(screen.getByTestId("factura-itbis-18_00").textContent).toContain("ITBIS 18%");
    expect(screen.getByTestId("factura-itbis-16_00").textContent).toContain("8.00");
    expect(screen.getByTestId("factura-total").textContent).toMatch(/294\.00/);
    expect(screen.getByTestId("factura-subtotal-gravado").textContent).toMatch(/250\.00/);
  });

  it("derives the payment status from the canonical balance (paid → Pagada)", async () => {
    mockAction.mockResolvedValue({ ok: true, data: VISTA_BASE });
    render(<FacturaPrintScreen facturaId={77} />);
    await screen.findByTestId("factura-print");

    expect(screen.getByTestId("factura-forma-pago").textContent).toBe("Pagada");
    expect(screen.queryByTestId("factura-saldo-pendiente")).toBeNull();
  });

  it("shows the pending balance for a credit invoice", async () => {
    mockAction.mockResolvedValue({
      ok: true,
      data: {
        ...VISTA_BASE,
        saldo: { total: "294.00", cobrosAplicados: "94.00", saldoPendiente: "200.00" },
      },
    });
    render(<FacturaPrintScreen facturaId={77} />);
    await screen.findByTestId("factura-print");

    expect(screen.getByTestId("factura-forma-pago").textContent).toBe("Saldo pendiente");
    expect(screen.getByTestId("factura-saldo-pendiente").textContent).toMatch(/200\.00/);
  });

  it("prints a negative balance (credit note after full payment) with the RD$ prefix, as before", async () => {
    mockAction.mockResolvedValue({
      ok: true,
      data: {
        ...VISTA_BASE,
        saldo: { total: "294.00", cobrosAplicados: "294.00", saldoPendiente: "-50.00" },
      },
    });
    render(<FacturaPrintScreen facturaId={77} />);
    await screen.findByTestId("factura-print");

    expect(screen.getByTestId("factura-saldo-pendiente").textContent).toBe("RD$ -50.00");
  });

  it("never claims Contado or Crédito: the data does not store the sale's payment condition", async () => {
    // A settled credit sale (partial cobro, refund, credit note => balance 0) used to print "Contado".
    mockAction.mockResolvedValue({
      ok: true,
      data: {
        ...VISTA_BASE,
        tipoNcf: "B01",
        saldo: { total: "47.20", cobrosAplicados: "23.60", saldoPendiente: "0.00" },
      },
    });
    render(<FacturaPrintScreen facturaId={92} />);
    await screen.findByTestId("factura-print");

    const fila = screen.getByTestId("factura-forma-pago").parentElement as HTMLElement;
    expect(fila.textContent).toContain("Estado del pago");
    expect(fila.textContent).not.toMatch(/Contado|Crédito|Forma de pago/);
  });

  it("a CANCELLED invoice renders the no-fiscal-effect banner INSIDE the printed article", async () => {
    mockAction.mockResolvedValue({ ok: true, data: { ...VISTA_BASE, estado: "CANCELADA", saldo: null } });
    render(<FacturaPrintScreen facturaId={77} />);
    await screen.findByTestId("factura-print");

    const banner = screen.getByTestId("factura-banner-estado");
    // S4 regression guard (JD round 2, A): the banner must live INSIDE the
    // print-isolated article — outside it, the printed copy loses the banner.
    const article = screen.getByTestId("factura-print");
    expect(article.contains(banner)).toBe(true);
    expect(banner.textContent).toContain("sin efecto fiscal");
    expect(screen.queryByTestId("factura-forma-pago")).not.toBeNull();
    expect(screen.getByTestId("factura-forma-pago").textContent).toBe("—");
  });

  it("an ANNULLED invoice renders the reported-in-608 banner (S4)", async () => {
    mockAction.mockResolvedValue({ ok: true, data: { ...VISTA_BASE, estado: "ANULADA", saldo: null } });
    render(<FacturaPrintScreen facturaId={77} />);
    await screen.findByTestId("factura-print");

    expect(screen.getByTestId("factura-banner-estado").textContent).toContain("608");
  });

  it("a transport-level rejection lands in the typed error state without masquerading as not-found", async () => {
    mockAction.mockRejectedValue(new Error("network down"));
    render(<FacturaPrintScreen facturaId={77} />);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("No se pudo cargar la factura");
    expect(alert.textContent).not.toContain("Factura no encontrada");
    expect(alert.textContent).not.toMatch(/network down/);
  });

  it("maps a missing/foreign invoice to the typed catalog message, no provider leakage", async () => {
    mockAction.mockResolvedValue({
      ok: false,
      error: { code: "FACTURA_NO_ENCONTRADA", message: "Factura no encontrada" },
    });
    render(<FacturaPrintScreen facturaId={999} />);
    await screen.findByRole("alert");

    const alert = screen.getByRole("alert");
    expect(alert.textContent).toBe("Factura no encontrada");
    expect(alert.textContent).not.toMatch(/Prisma|Error:|at /);
  });

  it("ships print isolation: an inline style with @media print and @page rules", async () => {
    mockAction.mockResolvedValue({ ok: true, data: VISTA_BASE });
    const { container } = render(<FacturaPrintScreen facturaId={77} />);
    await screen.findByTestId("factura-print");

    const styles = container.querySelectorAll("style");
    const css = [...styles].map((s) => s.textContent ?? "").join("\n");
    expect(css).toContain("@media print");
    expect(css).toContain("@page");
    expect(css).toContain(".factura-print-doc");
    expect(css).toContain("no-print");
    // Dark-mode print legibility (JD round 1, B): the printed document is
    // forced light-on-white and the banner keeps its red identity.
    expect(css).toContain("background: #ffffff !important");
    expect(css).toContain("color: #18181b !important");
  });

  it("the print button calls window.print and nothing else", async () => {
    mockAction.mockResolvedValue({ ok: true, data: VISTA_BASE });
    render(<FacturaPrintScreen facturaId={77} />);
    await screen.findByTestId("factura-print");

    const printSpy = jest.spyOn(window, "print").mockImplementation(() => undefined);
    await act(async () => {
      fireEvent.click(screen.getByTestId("factura-boton-imprimir"));
    });
    expect(printSpy).toHaveBeenCalledTimes(1);
    printSpy.mockRestore();
  });

  it("prints grouped money exactly and keeps a 0.01 balance/discount visible (Decimal-safe zero checks)", async () => {
    mockAction.mockResolvedValue({
      ok: true,
      data: {
        ...VISTA_BASE,
        total: "123456789.10",
        subtotalGravado: "123456789.10",
        descuento: "0.01",
        saldo: { total: "123456789.10", cobrosAplicados: "123456789.09", saldoPendiente: "0.01" },
      },
    });
    render(<FacturaPrintScreen facturaId={77} />);
    await screen.findByTestId("factura-print");

    expect(screen.getByTestId("factura-total").textContent).toBe("RD$ 123,456,789.10");
    expect(screen.getByTestId("factura-descuento").textContent).toBe("−RD$ 0.01");
    expect(screen.getByTestId("factura-saldo-pendiente").textContent).toBe("RD$ 0.01");
    expect(screen.getByTestId("factura-forma-pago").textContent).toBe("Saldo pendiente");
  });

  it("hides zero discount, exempt subtotal and balance written as 0, 0.0 or 0.00", async () => {
    mockAction.mockResolvedValue({
      ok: true,
      data: {
        ...VISTA_BASE,
        descuento: "0.0",
        subtotalExento: "0",
        saldo: { total: "294.00", cobrosAplicados: "294.00", saldoPendiente: "0.00" },
      },
    });
    render(<FacturaPrintScreen facturaId={77} />);
    await screen.findByTestId("factura-print");

    expect(screen.queryByTestId("factura-descuento")).toBeNull();
    expect(screen.queryByTestId("factura-subtotal-exento")).toBeNull();
    expect(screen.queryByTestId("factura-saldo-pendiente")).toBeNull();
    expect(screen.getByTestId("factura-forma-pago").textContent).toBe("Pagada");
  });
});
