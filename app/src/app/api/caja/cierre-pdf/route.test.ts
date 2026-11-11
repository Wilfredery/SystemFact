/**
 * Unit — `/api/caja/cierre-pdf` route handler (S4 / S9).
 *
 * The handler is a thin adapter: session → tenant transaction → role gate → the SAME
 * `consultarCierreDiario` use case the /caja screen calls → PDF bytes. These tests mock every
 * collaborator (no DB, no auth) and pin the transport contract: 401 without a session, 403 for a
 * non-Administrador (BEFORE the use case runs), 200 + `application/pdf` + the attachment filename
 * for an Administrador, and no PDF on a typed use-case refusal.
 */

import { GET } from "./route";
import { consultarCierreDiario } from "@/modules/caja/application/consultar-cierre-diario";
import { tieneRolPermitidoEnTx } from "@/modules/venta/infrastructure/venta-repository";
import { createClient } from "@/lib/supabase/client";
import { getCurrentTenantHeader } from "@/modules/tenant/infrastructure/tenant-runtime";

jest.mock("@/lib/supabase/client", () => ({ createClient: jest.fn() }));
jest.mock("@/modules/tenant/infrastructure/tenant-runtime", () => ({
  getCurrentTenantHeader: jest.fn(),
}));
jest.mock("@/modules/tenant/infrastructure/withTenantTransaction", () => ({
  withTenantTransaction: jest.fn((_ctx: unknown, fn: (t: unknown) => Promise<unknown>) => fn({})),
}));
jest.mock("@/modules/venta/infrastructure/venta-repository", () => ({
  tieneRolPermitidoEnTx: jest.fn(),
}));
jest.mock("@/modules/caja/application/consultar-cierre-diario", () => ({
  consultarCierreDiario: jest.fn(),
}));

const ctx = {
  empresaId: 7,
  sucursalId: 3,
  usuarioId: 11,
  esAdmin: true,
  empresaNombre: "Comercial Demo SRL",
  sucursalNombre: "Sucursal Centro",
};

const cierre = {
  fechaSD: "2026-11-11",
  totalFacturado: "2000.00",
  totalCobrado: "1500.50",
  efectivoEsperado: "1000.25",
  diferencia: "-499.50",
  metodos: [{ metodo: "EFECTIVO", cobros: "1500.50", cantidad: 3 }],
  corte: { cobros: "1500.50", devoluciones: "500.25" },
};

beforeEach(() => {
  jest.clearAllMocks();
  (createClient as jest.Mock).mockResolvedValue({});
  (getCurrentTenantHeader as jest.Mock).mockResolvedValue(ctx);
  (tieneRolPermitidoEnTx as jest.Mock).mockResolvedValue(true);
  (consultarCierreDiario as jest.Mock).mockResolvedValue({ ok: true, data: cierre });
});

describe("GET /api/caja/cierre-pdf", () => {
  it("returns 401 JSON when there is no session", async () => {
    (getCurrentTenantHeader as jest.Mock).mockResolvedValue(null);

    const res = await GET();

    expect(res.status).toBe(401);
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("SESION_INVALIDA");
    expect(consultarCierreDiario).not.toHaveBeenCalled();
  });

  it("returns 403 when the caller is not an Administrador, before the use case runs", async () => {
    (tieneRolPermitidoEnTx as jest.Mock).mockResolvedValue(false);

    const res = await GET();

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("CAJA_NO_AUTORIZADO");
    expect(tieneRolPermitidoEnTx).toHaveBeenCalledWith(expect.anything(), 11, 7, [
      "Administrador",
    ]);
    expect(consultarCierreDiario).not.toHaveBeenCalled();
  });

  it("returns the PDF for an Administrador, from the SAME use case the screen reads", async () => {
    const res = await GET();

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toBe(
      'attachment; filename="cierre-caja-2026-11-11.pdf"',
    );
    const bytes = Buffer.from(await res.arrayBuffer());
    expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    // pdfkit writes text runs as HEX strings in the uncompressed content stream: look for the
    // title's encoded form, which is the same bytes the browser receives. "..."
    expect(bytes.toString("latin1")).toContain(
      Buffer.from("Cierre diario de caja", "latin1").toString("hex"),
    );
    expect(consultarCierreDiario).toHaveBeenCalledWith(expect.anything(), ctx);
  });

  it("returns a coded JSON failure instead of a PDF when the use case refuses", async () => {
    (consultarCierreDiario as jest.Mock).mockResolvedValue({
      ok: false,
      code: "CAJA_VALIDACION",
      message: "La fecha del cierre no es válida",
    });

    const res = await GET();

    expect(res.headers.get("content-type")).toContain("application/json");
    expect(res.status).not.toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("CAJA_VALIDACION");
  });
});
