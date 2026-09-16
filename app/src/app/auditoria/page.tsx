/**
 * `/auditoria` route — SERVER component shell (Slice D, task 4.1; AC-1 / AC-4).
 *
 * Server by default (AGENTS.md "server components by default"). It resolves the tenant
 * context from the Supabase session (the SAME `getCurrentTenantContext` the actions use)
 * and redirects to `/login` when there is none — a not-signed-in visitor never reaches
 * the read. For an authenticated user it maps the awaited `searchParams` onto the
 * transport filter and fetches the FIRST render through the Server Action, which is the
 * single thin adapter owning Zod validation, the tenant transaction and the Admin role
 * gate (AC-1). The page itself queries NOTHING directly — no `prisma`, no repository —
 * so all tenant/RLS/authorization enforcement lives in exactly one place.
 *
 * The non-admin case is NOT a redirect: the action returns the stable
 * `AUDITORIA_NO_AUTORIZADO` code and the shell renders a plain access message (server
 * gate is authoritative; hiding the route would not be, per AC-1). The client filter
 * form re-pushes onto the URL on submit, so any filter/pagination change re-runs THIS
 * server fetch with fresh `searchParams` — the newest-first, tenant-pinned page and the
 * active-filter total always come from the canonical read, never a client cache (AC-4).
 */

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { getCurrentTenantContext } from "@/modules/tenant/infrastructure/tenant-runtime";
import { AUDITORIA_NO_AUTORIZADO } from "@/modules/auditoria/domain/errors";
import { consultarAuditoriaAction } from "@/modules/auditoria/http/actions";
import { AuditFilters } from "@/modules/auditoria/ui/AuditFilters";
import { AuditTable } from "@/modules/auditoria/ui/AuditTable";
import {
  filtroDesdeSearchParams,
  type SearchParamsInput,
} from "@/modules/auditoria/ui/url";

/** Next 16 hands `searchParams` to a server page as a Promise. */
interface PageProps {
  readonly searchParams: Promise<SearchParamsInput>;
}

export default async function AuditoriaPage({ searchParams }: PageProps) {
  const supabase = await createClient();
  const ctx = await getCurrentTenantContext(supabase);
  if (ctx === null) {
    redirect("/login");
  }

  const filtro = filtroDesdeSearchParams(await searchParams);
  const resultado = await consultarAuditoriaAction(filtro);

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-10">
      <h1 className="mb-1 text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
        Auditoría
      </h1>
      <p className="mb-6 text-sm text-zinc-500 dark:text-zinc-400">
        Registro de auditoría — solo lectura, ordenado del más reciente al más antiguo.
      </p>

      {resultado.ok ? (
        <>
          <AuditFilters filtroInicial={filtro} />
          <div className="mt-6">
            <AuditTable pagina={resultado.data} filtro={filtro} />
          </div>
        </>
      ) : (
        <p
          role="alert"
          className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-200"
        >
          {resultado.error.code === AUDITORIA_NO_AUTORIZADO
            ? "Solo el administrador puede consultar el registro de auditoría."
            : resultado.error.message}
        </p>
      )}
    </main>
  );
}
