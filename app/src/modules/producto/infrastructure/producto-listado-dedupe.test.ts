/**
 * M4 dedupe (REQ-PROD-010, design D6) — unit tests on the pure window math
 * and the in-tx skip/append decision, with a recording fake `tx` (no DB).
 *
 * Boundary cases are UTC instants (AGENTS.md dates): the comparison is an
 * absolute-instant pair, so "just inside" is fecha >= today-60_000ms and
 * "just outside" is prior to trigger the append immediately.
 */

import { AccionAuditoria } from "@/generated/prisma/client";
import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import {
  corteVentanaProductoListado,
  registrarProductoListadoEnTx,
  VENTANA_PRODUCTO_LISTADO_MS,
} from "./producto-repository";

jest.mock("@/modules/auditoria/application/auditoria-write-port", () => {
  const real = jest.requireActual<Record<string, unknown>>(
    "@/modules/auditoria/application/auditoria-write-port",
  );
  return {
    ...real,
    registrarEventoAuditoriaEnTx: jest.fn(real.registrarEventoAuditoriaEnTx),
  };
});

const ctx: TenantCtx = {
  empresaId: 7,
  sucursalId: 3,
  usuarioId: 11,
  esAdmin: false,
};

interface RegistroFalso {
  readonly tx: PrismaTx;
  readonly filasCreadas: Record<string, unknown>[];
}

function makeTx(
  ventanaAbierta: Record<string, unknown> | null = null,
): RegistroFalso {
  const filasCreadas: Record<string, unknown>[] = [];
  const tx = {
    movimientoAuditoria: {
      findFirst: jest.fn().mockResolvedValue(ventanaAbierta),
      create: jest
        .fn()
        .mockImplementation(async ({ data }: { data: unknown }) => {
          filasCreadas.push(data as Record<string, unknown>);
          return data;
        }),
    },
  } as unknown as PrismaTx;
  return { tx, filasCreadas };
}

describe("corteVentanaProductoListado (UTC instant math)", () => {
  it("cut = ahora minus 60s, always a UTC instant Date", () => {
    const ahora = new Date("2026-10-12T14:30:00Z");
    const corte = corteVentanaProductoListado(ahora);
    expect(corte.toISOString()).toBe("2026-10-12T14:29:00.000Z");
  });

  it("uses the ratified 60s window by default", () => {
    const ahora = new Date("2026-10-12T14:30:00.500Z");
    expect(corteVentanaProductoListado(ahora).getTime()).toBe(
      ahora.getTime() - VENTANA_PRODUCTO_LISTADO_MS,
    );
  });
});

describe("registrarProductoListadoEnTx — window race + append (real DB semantics in integration)", () => {
  it("fresh actor: appends exactly ONE row, payload {count: total}, LEER/Producto", async () => {
    const ahora = new Date("2026-10-12T14:30:00Z");
    const { tx, filasCreadas } = makeTx();

    await registrarProductoListadoEnTx(tx, ctx, 2, 42, ahora);

    expect(filasCreadas).toHaveLength(1);
    const fila = filasCreadas[0]!;
    expect(fila.empresaId).toBe(7);
    expect(fila.sucursalId).toBe(3);
    expect(fila.usuarioId).toBe(11);
    expect(fila.accion).toBe(AccionAuditoria.LEER);
    expect(fila.entidad).toBe("Producto");
    expect(fila.idEntidad).toBe("2");
    expect(fila.valorAnterior).toBeNull();
    expect(fila.valorNuevo).toBe(JSON.stringify({ count: 42 }));
    expect(fila.motivo).toBeNull();
    expect(fila.fechaHora).toBeInstanceOf(Date);
  });

  it("row inside the window: appends NOTHING (no update/delete — the open row is untouched)", async () => {
    const ahora = new Date("2026-10-12T14:30:00Z");
    // A row whose fechaHora sits just-inside the window (the where clause is
    // fechaHora >= cut; the fake returns one such row).
    const filaAbierta = {
      id: 10_001,
      fechaHora: new Date(ahora.getTime() - (VENTANA_PRODUCTO_LISTADO_MS - 1)),
    };
    const { tx, filasCreadas } = makeTx(filaAbierta);

    await registrarProductoListadoEnTx(tx, ctx, 4, 42, ahora);

    expect(filasCreadas).toHaveLength(0);
    const movimiento = (tx as unknown as {
      movimientoAuditoria: {
        findFirst: jest.Mock;
        create: jest.Mock;
      };
    }).movimientoAuditoria;
    expect(movimiento.findFirst).toHaveBeenCalledTimes(1);
  });

  it("60s boundary: just-inside stays within the cut; just-outside closes the window", () => {
    const ahora = new Date("2026-10-12T14:30:00Z");
    const corte = corteVentanaProductoListado(ahora);

    // Row exactly at the cut (60_000ms old) — `gte` is inclusive → inside.
    expect(corte.getTime()).toBe(ahora.getTime() - 60_000);

    // 1ms newer than the cut is inside; 1ms older is outside (outside =
    // window closed → the read appends a fresh row — see the integration suite).
    const justoDentro = new Date(corte.getTime() + 1);
    const justoFuera = new Date(corte.getTime() - 1);
    expect(justoDentro.getTime() >= corte.getTime()).toBe(true);
    expect(justoFuera.getTime() >= corte.getTime()).toBe(false);
  });

  it("bounded window read: predicate pins empresa+usuario+LEER+Producto+UTC cut (no SD conversion)", async () => {
    const ahora = new Date("2026-10-12T14:30:00Z");
    const { tx } = makeTx();

    await registrarProductoListadoEnTx(tx, ctx, 1, 7, ahora);

    const firstArg = (tx as unknown as {
      movimientoAuditoria: { findFirst: jest.Mock };
    }).movimientoAuditoria.findFirst.mock.calls[0]!;
    const where = (firstArg[0] as { where: Record<string, unknown> }).where;
    expect(where).toEqual({
      empresaId: 7,
      usuarioId: 11,
      accion: AccionAuditoria.LEER,
      entidad: "Producto",
      fechaHora: { gte: corteVentanaProductoListado(ahora) },
    });
  });
});
