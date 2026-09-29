/**
 * Unit — the DGII fiscal period-parameter readers (U3). No DB.
 *
 * A recording fake `tx` returns a canned `ConfiguracionEmpresa` row per key, so the JSON-grammar
 * handling is provable without Postgres. The rule under test is the D5 one: the 607 Tipo-Ingreso
 * table is tenant data, and a value that is not a DGII 1–6 code (a zero-padded `"01"`, a `"7"`, a
 * non-number) must be DISCARDED at the boundary so the resolver can never write a code DGII would
 * reject — a bad map entry falls back to the documented default, it is never guessed or shipped.
 */

import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import { TIPO_INGRESO_POR_DEFECTO } from "../domain/dgii/tipo-ingreso";
import { leerMapaTipoIngreso607EnTx } from "./dgii-config-repository";

interface ConsultaFake {
  readonly where: { readonly clave: string };
  readonly select: { readonly valor: true };
}

function crearTxPorClave(valores: Readonly<Record<string, string>>): {
  readonly tx: PrismaTx;
  readonly consultas: ConsultaFake[];
} {
  const consultas: ConsultaFake[] = [];
  const tx = {
    configuracionEmpresa: {
      findFirst(args: ConsultaFake): Promise<{ valor: string } | null> {
        consultas.push(args);
        const valor = valores[args.where.clave];
        return Promise.resolve(valor === undefined ? null : { valor });
      },
    },
  };
  return { tx: tx as unknown as PrismaTx, consultas };
}

const CLAVE_TIPO_INGRESO_607 = "DGII_TIPO_INGRESO_607";
const AHORA = new Date("2026-04-15T12:00:00.000Z");

describe("leerMapaTipoIngreso607EnTx — only official 1–6 D5 codes survive (no DB)", () => {
  it("keeps a well-formed single-digit map verbatim", async () => {
    const { tx } = crearTxPorClave({
      [CLAVE_TIPO_INGRESO_607]: JSON.stringify({ B01: "1", B02: "2", B03: "3", B04: "4" }),
    });

    await expect(leerMapaTipoIngreso607EnTx(tx, 1, AHORA)).resolves.toEqual({
      B01: "1",
      B02: "2",
      B03: "3",
      B04: "4",
    });
  });

  it("normalises a numeric JSON value to its digit string", async () => {
    const { tx } = crearTxPorClave({ [CLAVE_TIPO_INGRESO_607]: JSON.stringify({ B01: 1, B02: 2 }) });

    await expect(leerMapaTipoIngreso607EnTx(tx, 1, AHORA)).resolves.toEqual({ B01: "1", B02: "2" });
  });

  it("DISCARDS zero-padded, out-of-range and non-numeric codes instead of shipping them", async () => {
    const { tx } = crearTxPorClave({
      [CLAVE_TIPO_INGRESO_607]: JSON.stringify({
        B01: "01", // zero-padded: 2 chars in a 1-char field
        B02: "7", // out of the 1–6 range
        B03: "0", // not a valid class
        B04: "x", // not a code at all
        B05: "6", // the only valid entry survives
      }),
    });

    await expect(leerMapaTipoIngreso607EnTx(tx, 1, AHORA)).resolves.toEqual({ B05: "6" });
  });

  it("returns an EMPTY map for an unparseable / non-object payload (never invents a code)", async () => {
    for (const valor of ["no-json", "[]", '"texto"', "null", "42"]) {
      const { tx } = crearTxPorClave({ [CLAVE_TIPO_INGRESO_607]: valor });
      await expect(leerMapaTipoIngreso607EnTx(tx, 1, AHORA)).resolves.toEqual({});
    }
  });

  it("returns an EMPTY map when the tenant configured nothing (the resolver then applies the default)", async () => {
    const { tx, consultas } = crearTxPorClave({});

    const mapa = await leerMapaTipoIngreso607EnTx(tx, 1, AHORA);

    expect(mapa).toEqual({});
    // Reads the empresa-anchored key, pinned to the tenant and to an active row.
    expect(consultas[0]?.where.clave).toBe(CLAVE_TIPO_INGRESO_607);
    // The documented fallback is the single valid 1-digit code, so an unconfigured tenant still
    // emits a well-formed D5.
    expect(TIPO_INGRESO_POR_DEFECTO).toBe("1");
  });
});
