import { registrarAuditCategoriaEnTx } from "./categoria-repository";
import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";

// The generated Prisma client is ESM-only; tests replace it with the minimal
// runtime surface the audit adapter touches (categoria-repository.test.ts precedent).
jest.mock("@/generated/prisma/client", () => ({
  Prisma: {},
  AccionAuditoria: {
    CREAR: "CREAR",
    ACTUALIZAR: "ACTUALIZAR",
    CANCELAR: "CANCELAR",
    LEER: "LEER",
  },
}));

// MOVIMIENTO_AUDITORIA.valorAnterior / valorNuevo are VarChar(255): Postgres
// rejects a longer value (22001) and the owning transaction aborts.
const LIMITE_COLUMNA = 255;

const ctx: TenantCtx = {
  empresaId: 1,
  sucursalId: 1,
  usuarioId: 1,
  esAdmin: true,
};

function makeTx() {
  const create = jest.fn().mockResolvedValue({});
  const tx = { movimientoAuditoria: { create } } as unknown as PrismaTx;
  return { tx, create };
}

function valoresEscritos(create: jest.Mock): {
  anterior: string | null;
  nuevo: string | null;
} {
  const data = create.mock.calls[0][0].data as {
    valorAnterior: string | null;
    valorNuevo: string | null;
  };
  return { anterior: data.valorAnterior, nuevo: data.valorNuevo };
}

describe("registrarAuditCategoriaEnTx", () => {
  it("keeps a short name verbatim in the audit values", async () => {
    const { tx, create } = makeTx();

    await registrarAuditCategoriaEnTx(
      tx,
      ctx,
      "ACTUALIZAR",
      7,
      { nombre: "Granos" },
      {
        nombre: "Cereales",
      },
    );

    const { anterior, nuevo } = valoresEscritos(create);
    expect(JSON.parse(anterior as string)).toEqual({ nombre: "Granos" });
    expect(JSON.parse(nuevo as string)).toEqual({ nombre: "Cereales" });
  });

  it("marks a cut name with an ellipsis so a truncated audit copy is never mistaken for the full value", async () => {
    const { tx, create } = makeTx();
    const largo = "N".repeat(150);

    await registrarAuditCategoriaEnTx(tx, ctx, "ACTUALIZAR", 7, { nombre: largo }, { nombre: largo + "X" });

    const { anterior, nuevo } = valoresEscritos(create);
    const copiaAnterior = (JSON.parse(anterior as string) as { nombre: string }).nombre;
    const copiaNueva = (JSON.parse(nuevo as string) as { nombre: string }).nombre;
    expect(copiaAnterior).toBe("N".repeat(100) + "…");
    expect(copiaNueva).toBe("N".repeat(100) + "…");
  });

  it("never splits an emoji (surrogate pair) at the cut point", async () => {
    const { tx, create } = makeTx();
    // 99 chars + one 2-unit emoji straddling the 100-unit boundary.
    const nombre = "A".repeat(99) + "😀" + "B".repeat(50);

    await registrarAuditCategoriaEnTx(tx, ctx, "CREAR", 7, null, { id: 7, nombre });

    const { nuevo } = valoresEscritos(create);
    const copia = (JSON.parse(nuevo as string) as { nombre: string }).nombre;
    expect(copia).toBe("A".repeat(99) + "…");
    expect(copia).not.toMatch(/[�-�](?![�-�])|(?<![�-�])[�-�]/);
  });

  it("keeps non-string values (booleans, counts) untouched", async () => {
    const { tx, create } = makeTx();

    await registrarAuditCategoriaEnTx(
      tx,
      ctx,
      "CANCELAR",
      7,
      { activa: true },
      {
        activa: false,
      },
    );

    const { anterior, nuevo } = valoresEscritos(create);
    expect(JSON.parse(anterior as string)).toEqual({ activa: true });
    expect(JSON.parse(nuevo as string)).toEqual({ activa: false });
  });

  it.each([
    ["a 255-char name", "N".repeat(255)],
    [
      "a 255-char name made only of quotes (JSON doubles each one)",
      '"'.repeat(255),
    ],
    ["a 255-char name made only of backslashes", "\\".repeat(255)],
    ["a 255-char name made only of control characters (6 chars each in JSON)", String.fromCharCode(1).repeat(255)],
  ])(
    "never writes a value longer than the VarChar(255) column for %s",
    async (_label, nombre) => {
      const { tx, create } = makeTx();

      await registrarAuditCategoriaEnTx(tx, ctx, "CREAR", 2147483647, null, {
        id: 2147483647,
        nombre,
      });
      await registrarAuditCategoriaEnTx(
        tx,
        ctx,
        "ACTUALIZAR",
        2147483647,
        { nombre },
        { nombre },
      );

      for (const call of create.mock.calls) {
        const data = call[0].data as {
          valorAnterior: string | null;
          valorNuevo: string | null;
        };
        for (const valor of [data.valorAnterior, data.valorNuevo]) {
          if (valor !== null) {
            expect(valor.length).toBeLessThanOrEqual(LIMITE_COLUMNA);
            expect(() => JSON.parse(valor)).not.toThrow();
          }
        }
      }
    },
  );
});
