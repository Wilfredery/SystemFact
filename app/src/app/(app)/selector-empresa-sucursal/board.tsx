/**
 * Board 02 "Selector Empresa-Sucursal" — presentational shell (design D5,
 * SEL-RENDER-02-A/B/C).
 *
 * Composition is F0-ONLY: Card frame, Badge (plan), Select option list, Button
 * confirm. Colors route through the F0 semantic tokens exclusively
 * (light-only — no raw palette classes, no dark-mode variants anywhere). The
 * empresa is a STATIC read-only heading (P6): it is never a select/option/interactive node.
 * Empty active set ⇒ empty state message and the confirm affordance is
 * UNRENDERED (SEL-EMPTY-04-A) — you cannot navigate into a stateless selector.
 */

import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { UsuarioSucursalForm } from "./usuario-sucursal-form";
import type { SucursalResumen } from "@/modules/tenant/infrastructure/repo-sucursal";

export type SelectorEmpresaSucursalProps = {
  readonly empresaNombre: string;
  readonly sucursales: readonly SucursalResumen[];
  readonly sucursalActualId: number;
  readonly plan: string;
};

export function SelectorEmpresaSucursal({
  empresaNombre,
  sucursales,
  sucursalActualId,
  plan,
}: SelectorEmpresaSucursalProps) {
  return (
    <div className="flex flex-1 flex-col items-center px-4 py-8">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Selector de sucursal</CardTitle>
          <CardDescription>
            Elige la sucursal donde vas a operar.
          </CardDescription>
          <CardAction>
            <Badge variant="secondary" data-testid="selector-plan-badge">
              {plan}
            </Badge>
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {/* P6 / SEL-RENDER-02-A: the empresa appears ONCE, static + inert. */}
          <h2
            data-testid="selector-empresa"
            className="text-sm font-semibold text-ink"
          >
            {empresaNombre}
          </h2>

          {sucursales.length === 0 ? (
            <p
              data-testid="selector-empty"
              className="text-sm text-ink-muted"
            >
              No hay sucursales activas disponibles para cambiar. Contacta al
              administrador de la empresa.
            </p>
          ) : (
            <UsuarioSucursalForm
              sucursales={sucursales}
              sucursalActualId={sucursalActualId}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
