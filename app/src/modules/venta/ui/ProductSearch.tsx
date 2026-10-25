"use client";

/**
 * Product search panel (spec R-V14). Name/code search over the tenant's
 * active catalog via the existing producto read action; adding a result feeds
 * the ephemeral cart. Branch availability is surfaced on save through the
 * `STOCK_INSUFICIENTE` warning banner (R-V9) — 5b exposes no per-product
 * stock read, so the list itself stays rate-only.
 */

import { useState, type FormEvent } from "react";
import { listarProductosAction } from "@/modules/producto/http/actions";
import type { ProductoOpcion } from "./carro";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export function ProductSearch({ onAdd }: { readonly onAdd: (p: ProductoOpcion) => void }) {
  const [termino, setTermino] = useState("");
  const [resultados, setResultados] = useState<ProductoOpcion[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function buscar(e: FormEvent) {
    e.preventDefault();
    setBuscando(true);
    setError(null);
    const r = await listarProductosAction({ page: 1, limit: 25, descripcion: termino || undefined });
    if (r.ok) setResultados(r.data.items);
    else setError(r.error.message);
    setBuscando(false);
  }

  return (
    <Card aria-label="Product search">
      <CardHeader>
        <CardTitle className="text-sm font-semibold">Find product</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={buscar} className="flex gap-2">
          <Input
            value={termino}
            onChange={(e) => setTermino(e.target.value)}
            placeholder="Name or code"
            aria-label="Search products"
            className="flex-1"
          />
          <Button
            type="submit"
            disabled={buscando}
            className="self-end"
          >
            {buscando ? "Searching…" : "Search"}
          </Button>
        </form>
        {error !== null && <p role="alert" className="mt-2 text-sm text-danger">{error}</p>}
        {resultados.length > 0 && (
          <ul className="mt-4 max-h-64 divide-y divide-line overflow-y-auto">
            {resultados.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink">{p.nombre}</p>
                  <p className="text-xs text-ink-muted">
                    {p.codigo} · ITBIS {p.tasaItbis}%
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => onAdd(p)}
                  className="shrink-0 text-xs"
                >
                  Add
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
