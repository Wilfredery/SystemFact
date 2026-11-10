/**
 * Compras route (screens plan Step 6, `odd/tasks/compras.md` S4/S6).
 *
 * Server component shell: resolves the tenant context from the Supabase session
 * and redirects to `/login` when there is none, then reads the first page
 * through the same `listarComprasAction` the client island re-queries.
 *
 * Role gate (S3/S4): the Administrador manages purchases and Operador/Despachador
 * are view-only — they still see the list, because they receive purchases. The
 * Acciones column comes from the permission seam, which reads the named role
 * groups, so this page never names a role. A failed permission call hides it
 * (deny by default) but never breaks the read-only list. Every write action
 * re-checks on the server.
 *
 * The session's sucursal NAME (S1 read-only field of the purchase dialog) comes
 * from `getCurrentTenantHeader`, the same identity read with the display names
 * the shell header uses. The backend still takes `sucursalId` from the session
 * context — there is deliberately no branch selector here.
 *
 * T4/S8 — the read-only CxP (cuentas por pagar) section below the list. It is
 * Administrador-only (FIN-3, a Cobrador is denied) and that gate is SERVER-SIDE,
 * never CSS: the SAME permission seam the Acciones column uses (
 * `obtenerPermisosCompraAction`, whose `ROLES_GESTION_COMPRAS` group is exactly
 * Administrador) decides whether the report read is issued at all, and the
 * report's own use case re-checks its role gate before any aggregate. A refusal
 * or a failed gate simply renders no section. There is no payment-creation
 * surface: the view is read-only by design (YAGNI).
 */

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { getCurrentTenantHeader } from "@/modules/tenant/infrastructure/tenant-runtime";
import {
  listarComprasAction,
  obtenerPermisosCompraAction,
} from "@/modules/compra/http/actions";
import { consultarCxPAction } from "@/modules/reportes/http/actions.lectura";
import { ComprasScreen, type ComprasInicial } from "@/modules/compra/ui/ComprasScreen";
import { CxpPanel } from "@/modules/compra/ui/CxpPanel";
import {
  ESTADOS_COMPRA_FILTRO,
  TAMANO_PAGINA,
  TIPOS_COMPRA_FILTRO,
  construirHrefCxP,
  construirQueryCompras,
  type FiltrosCompras,
} from "@/modules/compra/ui/compras-filtros";

type Param = string | string[] | undefined;

function primero(valor: Param): string {
  return (Array.isArray(valor) ? valor[0] : valor) ?? "";
}

function enteroPositivo(valor: Param): number | null {
  const n = Number.parseInt(primero(valor), 10);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** Only a value the frozen enum offers may reach the query: no free strings. */
function opcionConocida(
  opciones: readonly { valor: string }[],
  valor: Param,
): string {
  const buscado = primero(valor);
  return opciones.some((o) => o.valor === buscado && o.valor !== "") ? buscado : "";
}

export default async function ComprasPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, Param>>;
}) {
  const supabase = await createClient();
  const ctx = await getCurrentTenantHeader(supabase);
  if (ctx === null) {
    redirect("/login");
  }

  const params = await searchParams;
  const page = enteroPositivo(params.page) ?? 1;
  const filtros: FiltrosCompras = {
    proveedorBusqueda: primero(params.proveedorBusqueda).trim().slice(0, 100),
    estado: opcionConocida(ESTADOS_COMPRA_FILTRO, params.estado),
    tipoCompra: opcionConocida(TIPOS_COMPRA_FILTRO, params.tipoCompra),
  };

  const [permisos, resultado] = await Promise.all([
    obtenerPermisosCompraAction().catch(() => null),
    // One query builder for the server first load and the island re-queries.
    listarComprasAction(construirQueryCompras(filtros, page)),
  ]);

  const puedeGestionar = permisos !== null && permisos.ok && permisos.data.puedeGestionar;
  const inicial: ComprasInicial = resultado.ok
    ? { ok: true, data: resultado.data }
    : { ok: false, message: resultado.error.message };

  // S8: the payable read is issued ONLY for the Administrador capability, and
  // the report use case re-checks its own gate. Anything but a successful read
  // yields no section — never an empty shell and never a client-side hide.
  const cxpPage = enteroPositivo(params.cxpPage) ?? 1;
  const cxp = puedeGestionar
    ? await consultarCxPAction({ page: cxpPage, pageSize: TAMANO_PAGINA })
    : null;
  const cxpPagina = cxp !== null && cxp.ok ? cxp.data : null;

  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-10">
      <div className="mb-6 flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Compras</h1>
      </div>
      <ComprasScreen
        inicial={inicial}
        filtrosIniciales={filtros}
        puedeGestionar={puedeGestionar}
        sucursalNombre={ctx.sucursalNombre}
      />
      {cxpPagina !== null && (
        <CxpPanel
          pagina={cxpPagina}
          hrefPagina={(page) => construirHrefCxP(filtros, page)}
        />
      )}
    </main>
  );
}
