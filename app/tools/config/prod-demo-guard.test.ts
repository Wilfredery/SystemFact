/**
 * Guard logic of the production DEMO lane (odd/tasks/prod-demo-lane.md S4/S5).
 *
 * ¿Por qué existe? Ese lane ESCRIBE en producción (ventas, NCF, cobros,
 * devoluciones). Lo único que lo mantiene dentro de la empresa demo es que la UI
 * muestre el nombre esperado ANTES de la primera escritura. Esa decisión vive en
 * funciones puras (`e2e-prod-demo/demo-env.ts`, sin Playwright) para poder
 * probarla sin navegador ni base de datos: si alguien la afloja, esto se rompe.
 */

import {
  cabeceraPerteneceAEmpresa,
  leerEntornoDemo,
} from "../../e2e-prod-demo/demo-env";

describe("leerEntornoDemo — credenciales y empresa esperada por entorno", () => {
  it("devuelve los tres valores cuando están todos", () => {
    expect(
      leerEntornoDemo({
        DEMO_USER: "demo.operador",
        DEMO_PASSWORD: "secreto-de-prueba",
        DEMO_EMPRESA_NAME: "SistemaFact Demo",
      }),
    ).toEqual({
      user: "demo.operador",
      password: "secreto-de-prueba",
      empresaName: "SistemaFact Demo",
    });
  });

  it.each(["DEMO_USER", "DEMO_PASSWORD", "DEMO_EMPRESA_NAME"])(
    "falla (nunca saltea) y nombra %s cuando falta o está vacía",
    (faltante) => {
      const env: Record<string, string> = {
        DEMO_USER: "u",
        DEMO_PASSWORD: "p",
        DEMO_EMPRESA_NAME: "E",
      };
      env[faltante] = "  ";
      expect(() => leerEntornoDemo(env)).toThrow(faltante);
    },
  );

  it("el mensaje de error nombra variables pero jamás valores", () => {
    let mensaje = "";
    try {
      leerEntornoDemo({ DEMO_USER: "usuario-visible", DEMO_PASSWORD: "clave-visible" });
    } catch (error) {
      mensaje = (error as Error).message;
    }
    expect(mensaje).toContain("DEMO_EMPRESA_NAME");
    expect(mensaje).not.toContain("usuario-visible");
    expect(mensaje).not.toContain("clave-visible");
  });
});

describe("cabeceraPerteneceAEmpresa — guard de empresa antes de escribir", () => {
  const esperada = "SistemaFact Demo";

  it("acepta la cabecera del shell de la empresa demo", () => {
    expect(
      cabeceraPerteneceAEmpresa(`${esperada} · Sucursal Principal`, esperada),
    ).toBe(true);
  });

  it("tolera espacios y saltos de línea alrededor del texto", () => {
    expect(
      cabeceraPerteneceAEmpresa(`\n  ${esperada}  ·  Sucursal Principal \n`, esperada),
    ).toBe(true);
  });

  it("rechaza otra empresa", () => {
    expect(
      cabeceraPerteneceAEmpresa("Colmado Real SRL · Sucursal Principal", esperada),
    ).toBe(false);
  });

  it("rechaza una empresa cuyo nombre solo EMPIEZA igual", () => {
    expect(
      cabeceraPerteneceAEmpresa(`${esperada} Dos · Sucursal Principal`, esperada),
    ).toBe(false);
  });

  it("rechaza una cabecera vacía y un nombre esperado vacío", () => {
    expect(cabeceraPerteneceAEmpresa("", esperada)).toBe(false);
    expect(cabeceraPerteneceAEmpresa(" · Sucursal Principal", "")).toBe(false);
  });
});
