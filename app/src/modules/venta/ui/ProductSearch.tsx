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

export function ProductSearch({ onAdd }: { onAdd: (p: ProductoOpcion) => void }) {
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
    <section aria-label="Product search" className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="mb-3 text-sm font-semibold text-zinc-900 dark:text-zinc-50">Find product</h2>
      <form onSubmit={buscar} className="flex gap-2">
        <input
          value={termino}
          onChange={(e) => setTermino(e.target.value)}
          placeholder="Name or code"
          aria-label="Search products"
          className="h-10 flex-1 rounded-lg border border-zinc-300 px-3 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-50"
        />
        <button
          type="submit"
          disabled={buscando}
          className="h-10 rounded-lg bg-indigo-600 px-4 text-sm font-medium text-white disabled:opacity-50"
        >
          {buscando ? "Searching…" : "Search"}
        </button>
      </form>
      {error !== null && <p role="alert" className="mt-2 text-sm text-red-600">{error}</p>}
      {resultados.length > 0 && (
        <ul className="mt-3 max-h-64 divide-y divide-zinc-100 overflow-y-auto dark:divide-zinc-800">
          {resultados.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-50">{p.nombre}</p>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  {p.codigo} · ITBIS {p.tasaItbis}%
                </p>
              </div>
              <button
                type="button"
                onClick={() => onAdd(p)}
                className="h-8 shrink-0 rounded-lg border border-indigo-600 px-3 text-xs font-medium text-indigo-600 hover:bg-indigo-50 dark:hover:bg-zinc-800"
              >
                Add
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
