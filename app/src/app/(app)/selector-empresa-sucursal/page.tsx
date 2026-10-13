/**
 * `/selector-empresa-sucursal` route (design D5) — Admin-only board 02 inside
 * AuthShell ((app) group). The page is the thin async seam: guards + one S1
 * read live in `./data.ts`; the board renders plain data only.
 */

import { SelectorEmpresaSucursal } from "@/app/(app)/selector-empresa-sucursal/board";
import { loadSelectorData } from "@/app/(app)/selector-empresa-sucursal/data";
import { resolvePlanForVersion } from "@/shared/version-plan";

export default async function SelectorEmpresaSucursalPage() {
  const data = await loadSelectorData();
  const plan = resolvePlanForVersion();

  return (
    <SelectorEmpresaSucursal
      empresaNombre={data.empresaNombre}
      sucursales={data.sucursales}
      sucursalActualId={data.sucursalActualId}
      plan={plan}
    />
  );
}
