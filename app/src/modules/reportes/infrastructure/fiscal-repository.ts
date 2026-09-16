/**
 * Reportes infrastructure — the DGII fiscal register reads (607/606/608) + the ITBIS summary
 * aggregate (FIS-1/FIS-3/FIS-4/FIS-5; slice E).
 *
 * ONE tenant-pinned SQL read per fiscal artifact inside `infrastructure/` (ADR-013): a `GROUP BY`/
 * `UNION ALL` aggregate with NO fetch-then-sum and NO N+1 (AGENTS.md "Reports/KPIs via SQL
 * aggregation"). Money crosses as `numeric(12,2)::text` (Decimal string — never a JS float); every
 * statement pins `empresaId` (first defense) AND runs inside the caller's `withTenantTransaction`
 * (RLS, second defense — DB-3), adding only the OPTIONAL SD-window + branch narrowing (ANDed).
 * The company-wide vs branch scope is the CALLER's (the use case wraps an Admin read in the ratified
 * widen) — these queries only apply the explicit filter.
 *
 * THE FISCAL SCOPE DECISIONS LIVE HERE AS SQL PREDICATES (they are row-selection rules, not math):
 *   - 607 (ventas): VIGENTE sales documents only — B01/B02 from `FACTURA`, B03 from `NOTA_DEBITO`,
 *     B04 from `NOTA_CREDITO` (its base/ITBIS emitted NEGATIVE so the register nets down, research
 *     §7). `CANCELADA`/`ANULADA` documents are excluded (FIS-5: Cancelada is in NEITHER 607 nor 608;
 *     Anulada is 608-only). The B02 ≥ threshold detail filter is applied in the PURE domain
 *     (`debeDetallarseEn607`) on these rows, not here, so the threshold logic stays testable.
 *   - 606 (compras): `Compra.estado ∈ {RECIBIDA, PAGADA}` ONLY (FIS-4; BORRADOR/PENDIENTE/CANCELADA
 *     excluded). The supplier's `tipoProveedor` drives the B11-no-credit ITBIS split in the domain.
 *   - 608 (anulados): `FACTURA.estado = 'ANULADA'` ONLY, joined to its `ANULACION` for the reason
 *     text (FIS-5). The original issue date is `Factura.fechaEmision`; 608 carries NO amounts.
 */

import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import type { VentanaFiltro } from "./dashboard-repository";
import type { MapaTipoIngreso } from "../domain/dgii/tipo-ingreso";

/** A `[desde,hasta]` UTC window + optional branch, normalised to SQL-null bindables. */
function paramVentana(ventana: VentanaFiltro): {
  sucursal: number | null;
  desde: Date | null;
  hasta: Date | null;
} {
  return { sucursal: ventana.sucursalId ?? null, desde: ventana.desde ?? null, hasta: ventana.hasta ?? null };
}

/**
 * A raw 607 detail input row. The three sales-document sources are UNIONed into this one shape;
 * amounts are ALREADY sign-applied (B04 negative). `ncfModificado` is the original invoice NCF for
 * a B03/B04 (via `facturaOriginalId`), null for a B01/B02.
 */
export interface Fila607Leida {
  readonly tipoNcf: string;
  readonly ncf: string;
  readonly ncfModificado: string | null;
  readonly identificacionFiscal: string | null;
  readonly esConsumidorFinal: boolean;
  readonly fechaComprobante: Date;
  readonly montoFacturado: string; // base, excl. ITBIS (signed)
  readonly itbis: string; // ITBIS facturado (signed)
  readonly totalBruto: string; // gross incl. ITBIS (signed) — the cross-foot target
  readonly cobrosEfectivo: string; // Σ applied cash cobros (0 for a nota)
}

/** The VIGENTE sales documents for the 607 register (full, un-paged; ordered by NCF). */
export async function filas607EnTx(
  tx: PrismaTx,
  ctx: TenantCtx,
  ventana: VentanaFiltro,
): Promise<Fila607Leida[]> {
  const { sucursal, desde, hasta } = paramVentana(ventana);
  const e = ctx.empresaId;
  return tx.$queryRaw<Fila607Leida[]>`
    SELECT * FROM (
      SELECT
        f."tipoNcf"::text                                              AS "tipoNcf",
        f."ncf"                                                        AS "ncf",
        NULL                                                           AS "ncfModificado",
        c."identificacionFiscal"                                       AS "identificacionFiscal",
        c."esConsumidorFinal"                                          AS "esConsumidorFinal",
        f."fechaEmision"                                               AS "fechaComprobante",
        (f."subtotalGravado" + f."subtotalExento")::numeric(12,2)::text AS "montoFacturado",
        f."itbis"::numeric(12,2)::text                                 AS "itbis",
        f."total"::numeric(12,2)::text                                 AS "totalBruto",
        COALESCE(pg."cobros", 0)::numeric(12,2)::text                  AS "cobrosEfectivo"
      FROM "FACTURA" f
      JOIN "CLIENTE" c ON c."id" = f."clienteId"
      LEFT JOIN (
        SELECT "facturaId", SUM("monto") AS "cobros"
        FROM "PAGO"
        WHERE "empresaId" = ${e}
          AND "metodoPago" = 'EFECTIVO'
          AND "estado" = 'APLICADO'
          AND "tipo" = 'COBRO'
        GROUP BY "facturaId"
      ) pg ON pg."facturaId" = f."id"
      WHERE f."empresaId" = ${e}
        AND f."estado" = 'VIGENTE'
        AND (${desde}::timestamptz IS NULL OR f."fechaEmision" >= ${desde})
        AND (${hasta}::timestamptz IS NULL OR f."fechaEmision" <= ${hasta})
        AND (${sucursal}::int IS NULL OR f."sucursalId" = ${sucursal})

      UNION ALL

      SELECT
        'B04',
        nc."ncf",
        fo."ncf",
        c."identificacionFiscal",
        c."esConsumidorFinal",
        nc."fechaEmision",
        (-nc."monto")::numeric(12,2)::text,
        (-nc."itbis")::numeric(12,2)::text,
        (-(nc."monto" + nc."itbis"))::numeric(12,2)::text,
        0::numeric(12,2)::text
      FROM "NOTA_CREDITO" nc
      JOIN "FACTURA" fo ON fo."id" = nc."facturaOriginalId"
      JOIN "CLIENTE" c ON c."id" = nc."clienteId"
      WHERE nc."empresaId" = ${e}
        AND nc."estado" = 'VIGENTE'
        AND (${desde}::timestamptz IS NULL OR nc."fechaEmision" >= ${desde})
        AND (${hasta}::timestamptz IS NULL OR nc."fechaEmision" <= ${hasta})
        AND (${sucursal}::int IS NULL OR nc."sucursalId" = ${sucursal})

      UNION ALL

      SELECT
        'B03',
        nd."ncf",
        fo."ncf",
        c."identificacionFiscal",
        c."esConsumidorFinal",
        nd."fechaEmision",
        (nd."monto")::numeric(12,2)::text,
        (nd."itbis")::numeric(12,2)::text,
        (nd."monto" + nd."itbis")::numeric(12,2)::text,
        0::numeric(12,2)::text
      FROM "NOTA_DEBITO" nd
      JOIN "FACTURA" fo ON fo."id" = nd."facturaOriginalId"
      JOIN "CLIENTE" c ON c."id" = nd."clienteId"
      WHERE nd."empresaId" = ${e}
        AND nd."estado" = 'VIGENTE'
        AND (${desde}::timestamptz IS NULL OR nd."fechaEmision" >= ${desde})
        AND (${hasta}::timestamptz IS NULL OR nd."fechaEmision" <= ${hasta})
        AND (${sucursal}::int IS NULL OR nd."sucursalId" = ${sucursal})
    ) reg
    ORDER BY "ncf" ASC`;
}

/** A raw 606 purchase row (the goods/services + ITBIS split happens purely in the domain). */
export interface Fila606Leida {
  readonly compraId: number;
  readonly rncProveedor: string | null;
  readonly tipoProveedor: string; // FORMAL | INFORMAL
  readonly tipoPersona: string; // FISICA | JURIDICA
  readonly tipoCompra: string; // MERCANCIA | SERVICIO_* | ALQUILER
  readonly estado: string; // Compra.estado (RECIBIDA | PAGADA) — drives the D23 form-pago
  readonly ncf: string | null;
  readonly tipoNcf: string | null; // B01 | B11
  readonly fechaComprobante: Date;
  readonly fechaPago: Date | null;
  readonly pagado: string; // Σ applied supplier payments (form-pago derivation)
  readonly subtotalGravado: string;
  readonly subtotalExento: string;
  readonly itbis: string;
  readonly retencionItbis: string;
  readonly retencionIsr: string;
  readonly total: string;
}

/** The RECIBIDA/PAGADA purchases for the 607... 606 register (full, un-paged; ordered by NCF). */
export async function filas606EnTx(
  tx: PrismaTx,
  ctx: TenantCtx,
  ventana: VentanaFiltro,
): Promise<Fila606Leida[]> {
  const { sucursal, desde, hasta } = paramVentana(ventana);
  const e = ctx.empresaId;
  const [a, b] = ["RECIBIDA", "PAGADA"] as const;
  return tx.$queryRaw<Fila606Leida[]>`
    SELECT
      c."id"::int                                                      AS "compraId",
      pr."rnc"                                                         AS "rncProveedor",
      pr."tipoProveedor"::text                                         AS "tipoProveedor",
      pr."tipoPersona"::text                                           AS "tipoPersona",
      c."tipoCompra"::text                                             AS "tipoCompra",
      c."estado"::text                                                 AS "estado",
      c."ncf"                                                          AS "ncf",
      c."tipoNcf"::text                                                AS "tipoNcf",
      c."fecha"                                                        AS "fechaComprobante",
      pp."fechaUltimo"                                                 AS "fechaPago",
      COALESCE(pp."pagos", 0)::numeric(12,2)::text                     AS "pagado",
      c."subtotalGravado"::numeric(12,2)::text                         AS "subtotalGravado",
      c."subtotalExento"::numeric(12,2)::text                          AS "subtotalExento",
      c."itbis"::numeric(12,2)::text                                   AS "itbis",
      c."retencionItbis"::numeric(12,2)::text                          AS "retencionItbis",
      c."retencionIsr"::numeric(12,2)::text                            AS "retencionIsr",
      c."total"::numeric(12,2)::text                                   AS "total"
    FROM "COMPRA" c
    JOIN "PROVEEDOR" pr ON pr."id" = c."proveedorId"
    LEFT JOIN (
      SELECT "compraId", SUM("monto") AS "pagos", MAX("fecha") AS "fechaUltimo"
      FROM "PAGO_PROVEEDOR"
      WHERE "empresaId" = ${e}
        AND "estado" = 'APLICADO'
      GROUP BY "compraId"
    ) pp ON pp."compraId" = c."id"
    WHERE c."empresaId" = ${e}
      AND c."estado" IN (${a}, ${b})
      AND (${desde}::timestamptz IS NULL OR c."fecha" >= ${desde})
      AND (${hasta}::timestamptz IS NULL OR c."fecha" <= ${hasta})
      AND (${sucursal}::int IS NULL OR c."sucursalId" = ${sucursal})
    ORDER BY c."ncf" ASC NULLS LAST, c."id" ASC`;
}

/** A raw 608 annulled-invoice row (3 columns, no amounts). */
export interface Fila608Leida {
  readonly ncf: string;
  readonly fechaComprobante: Date; // the original issue date (Factura.fechaEmision)
  readonly motivo: string | null; // Anulacion.motivo → mapped to the DGII reason code
}

/** The ANULADA invoices for the 608 register (full, un-paged; ordered by NCF). */
export async function filas608EnTx(
  tx: PrismaTx,
  ctx: TenantCtx,
  ventana: VentanaFiltro,
): Promise<Fila608Leida[]> {
  const { sucursal, desde, hasta } = paramVentana(ventana);
  const e = ctx.empresaId;
  return tx.$queryRaw<Fila608Leida[]>`
    SELECT
      f."ncf"                                                          AS "ncf",
      f."fechaEmision"                                                 AS "fechaComprobante",
      a."motivo"                                                       AS "motivo"
    FROM "FACTURA" f
    JOIN "ANULACION" a ON a."tipoDocumento" = 'FACTURA' AND a."documentoId" = f."id"
    WHERE f."empresaId" = ${e}
      AND f."estado" = 'ANULADA'
      AND (${desde}::timestamptz IS NULL OR f."fechaEmision" >= ${desde})
      AND (${hasta}::timestamptz IS NULL OR f."fechaEmision" <= ${hasta})
      AND (${sucursal}::int IS NULL OR f."sucursalId" = ${sucursal})
    ORDER BY f."ncf" ASC`;
}

/** The ITBIS-summary aggregate inputs (FIS-1) — already-signed sales net + purchase rollup. */
export interface ResumenITBISLeido {
  readonly itbisVentas: string; // ΣFACTURA.itbis − ΣNC.itbis + ΣND.itbis (VIGENTE)
  readonly baseGravadaVentas: string;
  readonly itbisComprasFacturado: string; // Σ606.itbis (RECIBIDA/PAGADA)
  readonly itbisComprasAdelantar: string; // Σ FORMAL itbis (B11 → 0)
  readonly itbisRetenidoCompras: string; // Σ retencionItbis
  readonly isrRetenidoCompras: string; // Σ retencionIsr
}

/**
 * The one-shot ITBIS summary aggregate (FIS-1). Two pinned sub-aggregates (signed sales net +
 * purchase rollup) joined by a cross-join of single-row scalars — no per-invoice loop, no N+1.
 */
export async function resumenITBISenTx(
  tx: PrismaTx,
  ctx: TenantCtx,
  ventana: VentanaFiltro,
): Promise<ResumenITBISLeido> {
  const { sucursal, desde, hasta } = paramVentana(ventana);
  const e = ctx.empresaId;
  const [a, b] = ["RECIBIDA", "PAGADA"] as const;
  const [fila] = await tx.$queryRaw<ResumenITBISLeido[]>`
    WITH ventas AS (
      SELECT
        COALESCE(SUM("itbis_signed"), 0) AS "itbis",
        COALESCE(SUM("base_signed"), 0)  AS "base"
      FROM (
        SELECT f."itbis" AS "itbis_signed", (f."subtotalGravado" + f."subtotalExento") AS "base_signed"
        FROM "FACTURA" f
        WHERE f."empresaId" = ${e} AND f."estado" = 'VIGENTE'
          AND (${desde}::timestamptz IS NULL OR f."fechaEmision" >= ${desde})
          AND (${hasta}::timestamptz IS NULL OR f."fechaEmision" <= ${hasta})
          AND (${sucursal}::int IS NULL OR f."sucursalId" = ${sucursal})
        UNION ALL
        SELECT -nc."itbis", -nc."monto"
        FROM "NOTA_CREDITO" nc
        WHERE nc."empresaId" = ${e} AND nc."estado" = 'VIGENTE'
          AND (${desde}::timestamptz IS NULL OR nc."fechaEmision" >= ${desde})
          AND (${hasta}::timestamptz IS NULL OR nc."fechaEmision" <= ${hasta})
          AND (${sucursal}::int IS NULL OR nc."sucursalId" = ${sucursal})
        UNION ALL
        SELECT nd."itbis", nd."monto"
        FROM "NOTA_DEBITO" nd
        WHERE nd."empresaId" = ${e} AND nd."estado" = 'VIGENTE'
          AND (${desde}::timestamptz IS NULL OR nd."fechaEmision" >= ${desde})
          AND (${hasta}::timestamptz IS NULL OR nd."fechaEmision" <= ${hasta})
          AND (${sucursal}::int IS NULL OR nd."sucursalId" = ${sucursal})
      ) s
    ),
    compras AS (
      SELECT
        COALESCE(SUM(c."itbis"), 0) AS "itbis_facturado",
        COALESCE(SUM(CASE WHEN pr."tipoProveedor" = 'FORMAL' THEN c."itbis" ELSE 0 END), 0) AS "itbis_adelantar",
        COALESCE(SUM(c."retencionItbis"), 0) AS "itbis_retenido",
        COALESCE(SUM(c."retencionIsr"), 0)   AS "isr_retenido"
      FROM "COMPRA" c
      JOIN "PROVEEDOR" pr ON pr."id" = c."proveedorId"
      WHERE c."empresaId" = ${e}
        AND c."estado" IN (${a}, ${b})
        AND (${desde}::timestamptz IS NULL OR c."fecha" >= ${desde})
        AND (${hasta}::timestamptz IS NULL OR c."fecha" <= ${hasta})
        AND (${sucursal}::int IS NULL OR c."sucursalId" = ${sucursal})
    )
    SELECT
      v."itbis"::numeric(12,2)::text         AS "itbisVentas",
      v."base"::numeric(12,2)::text          AS "baseGravadaVentas",
      co."itbis_facturado"::numeric(12,2)::text AS "itbisComprasFacturado",
      co."itbis_adelantar"::numeric(12,2)::text AS "itbisComprasAdelantar",
      co."itbis_retenido"::numeric(12,2)::text  AS "itbisRetenidoCompras",
      co."isr_retenido"::numeric(12,2)::text    AS "isrRetenidoCompras"
    FROM ventas v CROSS JOIN compras co`;
  return fila ?? {
    itbisVentas: "0.00",
    baseGravadaVentas: "0.00",
    itbisComprasFacturado: "0.00",
    itbisComprasAdelantar: "0.00",
    itbisRetenidoCompras: "0.00",
    isrRetenidoCompras: "0.00",
  };
}

/** Re-export so a caller mapping the raw rows to the income code needs no second import. */
export type { MapaTipoIngreso };
