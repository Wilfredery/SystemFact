"use client";

/**
 * The switch confirm affordance (design D5 part 2, SEL-NAV-06-A/B).
 *
 * ONLY the client interactivity lives here: controlled F0 Select (current
 * branch preselected, touched targets ≥44px), confirm disabled on first
 * submit (double-submit safe), and on a successful switch the navigation
 * targets `/dashboard` (design D2) — the header re-resolves server-side by
 * re-reading `Usuario.sucursalId`, so no client state carries the new branch.
 * On a typed business failure the stable message renders inline; nothing else
 * happens (no redirect on error).
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  cambiarSucursalActivaAction,
  type CambiarSucursalActionResult,
} from "@/modules/tenant/http/actions.sucursal";
import type { SucursalResumen } from "@/modules/tenant/infrastructure/repo-sucursal";

export type UsuarioSucursalFormProps = {
  readonly sucursales: readonly SucursalResumen[];
  readonly sucursalActualId: number;
};

export function UsuarioSucursalForm({
  sucursales,
  sucursalActualId,
}: UsuarioSucursalFormProps) {
  const router = useRouter();
  const [sucursalId, setSucursalId] = useState<number>(sucursalActualId);
  const [pendiente, setPendiente] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirmar(): Promise<void> {
    if (pendiente) return;
    setPendiente(true);
    setError(null);
    const resultado: CambiarSucursalActionResult =
      await cambiarSucursalActivaAction({ sucursalId });
    if (resultado.ok) {
      // Post-switch anchor (D2): land on a real module route, session kept.
      router.push("/dashboard");
      return;
    }
    setError(resultado.message);
    setPendiente(false);
  }

  return (
    <div className="flex flex-col gap-4">
      <Select
        value={sucursalId}
        onValueChange={(value) => setSucursalId(Number(value))}
      >
        <SelectTrigger
          data-testid="selector-branch-select"
          aria-label="Sucursal activa"
          className="h-11 w-full"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {sucursales.map((s) => (
            <SelectItem key={s.id} value={s.id}>
              {s.id === sucursalActualId ? `${s.nombre} (actual)` : s.nombre}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {error !== null && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}

      <Button
        type="button"
        data-testid="selector-confirm"
        onClick={confirmar}
        disabled={pendiente}
        className="h-11 w-full"
      >
        {pendiente ? "Cambiando…" : "Confirmar"}
      </Button>
    </div>
  );
}
