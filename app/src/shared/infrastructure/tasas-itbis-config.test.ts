import { TasasItbisConfigError } from "@/shared/domain/tasas-itbis";
import { leerTasasItbisEnTx } from "./tasas-itbis-config";
import { leerConfigActivaEnTx } from "./configuracion-empresa";

jest.mock("./configuracion-empresa", () => ({
  leerConfigActivaEnTx: jest.fn(),
}));

const leer = leerConfigActivaEnTx as jest.MockedFunction<typeof leerConfigActivaEnTx>;
const tx = {} as never;
const FECHA = new Date("2026-06-01T16:00:00.000Z");

beforeEach(() => leer.mockReset());

describe("leerTasasItbisEnTx", () => {
  it("returns the parsed list in config order and passes key, empresa and fecha through", async () => {
    leer.mockResolvedValue({ clave: "TASA_ITBIS", valor: "18,16,0" });
    await expect(leerTasasItbisEnTx(tx, 7, FECHA)).resolves.toEqual(["18", "16", "0"]);
    expect(leer).toHaveBeenCalledTimes(1);
    expect(leer).toHaveBeenCalledWith(tx, 7, "TASA_ITBIS", FECHA);
  });

  it("throws motivo ausente when no active row covers the instant", async () => {
    leer.mockResolvedValue(null);
    const err = await leerTasasItbisEnTx(tx, 7, FECHA).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TasasItbisConfigError);
    expect(err).toMatchObject({ code: "TASA_ITBIS_CONFIG_FALTANTE", motivo: "ausente" });
  });

  it("throws motivo valor_invalido with the parser reason in detalle", async () => {
    leer.mockResolvedValue({ clave: "TASA_ITBIS", valor: "18,,0" });
    const err = await leerTasasItbisEnTx(tx, 7, FECHA).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TasasItbisConfigError);
    expect(err).toMatchObject({
      code: "TASA_ITBIS_CONFIG_FALTANTE",
      motivo: "valor_invalido",
      detalle: "elemento vacío en la lista",
    });
  });
});
