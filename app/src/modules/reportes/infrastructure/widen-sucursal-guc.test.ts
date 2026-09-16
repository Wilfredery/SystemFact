/**
 * Unit — the company-wide widen/restore primitive (DB-4). No DB.
 *
 * A fake `tx` records every `set_config` statement, so we can prove the three DB-4
 * invariants WITHOUT a real session: (1) the branch GUC is cleared exactly once, (2) it
 * is restored to the caller's branch in `finally` on BOTH the success and the failure
 * path, and (3) the empresa GUC is NEVER cleared (the tenant anchor always holds).
 */

import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import { conSucursalAmpliadaEnTx } from "./widen-sucursal-guc";

interface LlamadaSetConfig {
  readonly clave: string;
  readonly valor: string;
}

interface Grabador {
  readonly llamadas: LlamadaSetConfig[];
}

/**
 * A `set_config(key, value, true)` recorder: it parses the tagged-template shape the
 * helper actually emits — `SELECT set_config('app.current_X', <inline-or-binding>, true)`
 * — and records {clave, valor}. A binding (`$...`) value is taken from the args array.
 */
function crearTxGrabador(grabador: Grabador): PrismaTx {
  const tx = {
    $executeRaw(
      strings: TemplateStringsArray,
      ...valores: unknown[]
    ): Promise<number> {
      const sql = strings.join("?");
      const m = /set_config\('([^']+)',\s*(?:''|\?)/.exec(sql);
      if (m !== null) {
        const clave = m[1] as string;
        // An inline `''` is the empty/clear value; a `?` binding carries the restore value.
        const esVacio = /set_config\('[^']+',\s*''/.test(sql);
        const valor = esVacio ? "" : String(valores[0] ?? "");
        grabador.llamadas.push({ clave, valor });
      }
      return Promise.resolve(1);
    },
  };
  return tx as unknown as PrismaTx;
}

function ctx(sucursalId: number): TenantCtx {
  return { empresaId: 7, sucursalId, usuarioId: 3, esAdmin: true };
}

describe("conSucursalAmpliadaEnTx — widen + restore (DB-4)", () => {
  it("clears ONLY the branch GUC, runs the read, then restores it (success path)", async () => {
    const grabador: Grabador = { llamadas: [] };
    const tx = crearTxGrabador(grabador);

    const salida = await conSucursalAmpliadaEnTx(tx, ctx(42), async () => "lecto");

    expect(salida).toBe("lecto");
    expect(grabador.llamadas).toEqual([
      { clave: "app.current_sucursal_id", valor: "" }, // cleared for the read
      { clave: "app.current_sucursal_id", valor: "42" }, // restored to the caller branch
    ]);
  });

  it("restores the branch GUC even when the read throws (failure path)", async () => {
    const grabador: Grabador = { llamadas: [] };
    const tx = crearTxGrabador(grabador);

    await expect(
      conSucursalAmpliadaEnTx(tx, ctx(9), async () => {
        throw new Error("fallo de lectura");
      }),
    ).rejects.toThrow("fallo de lectura");

    // The finally STILL restored — the tx is never left widened on failure.
    expect(grabador.llamadas).toEqual([
      { clave: "app.current_sucursal_id", valor: "" },
      { clave: "app.current_sucursal_id", valor: "9" },
    ]);
  });

  it("NEVER clears the empresa GUC on either path (tenant anchor always pinned)", async () => {
    const exito: Grabador = { llamadas: [] };
    await conSucursalAmpliadaEnTx(crearTxGrabador(exito), ctx(1), async () => null);

    const fracaso: Grabador = { llamadas: [] };
    await expect(
      conSucursalAmpliadaEnTx(crearTxGrabador(fracaso), ctx(1), async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    for (const g of [exito, fracaso]) {
      expect(
        g.llamadas.some((l) => l.clave === "app.current_empresa_id"),
      ).toBe(false);
    }
  });
});
