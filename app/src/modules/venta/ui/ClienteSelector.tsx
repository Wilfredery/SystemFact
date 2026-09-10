"use client";

/**
 * Client picker (spec R-V14): defaults to "Consumidor Final" — choosing it
 * submits `clienteId: null` and the SAVE PIPELINE resolves the CF through the
 * 5a seam (resolver-cliente-venta → getOrCreateConsumidorFinalEnTx); the UI
 * never calls the resolver directly. Inline registration goes through the
 * existing `crearClienteAction`.
 */

import { useEffect, useState, type FormEvent } from "react";
import { crearClienteAction, listarClientesAction } from "@/modules/cliente/http/actions";
import { TIPO_CLIENTE, type TipoCliente } from "@/modules/cliente/domain/cliente";
import { CONSUMIDOR_FINAL_LABEL, type SeleccionCliente } from "./carro";

/**
 * Non-credit client classifications offered at inline registration. `CREDITO`
 * is intentionally excluded: it requires an RNC and credit terms that belong in
 * the dedicated client screen, not the POS quick-add. The labels are the frozen
 * domain enum (no free strings); the default is the cash-capable minorista.
 */
const TIPOS_ALTA_RAPIDA = [TIPO_CLIENTE.MINORISTA, TIPO_CLIENTE.MAYORISTA] as const;

interface ClienteOpcion {
  id: number;
  nombre: string;
}

export function ClienteSelector({
  value,
  onChange,
}: {
  value: SeleccionCliente;
  onChange: (s: SeleccionCliente) => void;
}) {
  const [clientes, setClientes] = useState<ClienteOpcion[]>([]);
  const [registroAbierto, setRegistroAbierto] = useState(false);
  const [nombre, setNombre] = useState("");
  const [telefono, setTelefono] = useState("");
  const [direccion, setDireccion] = useState("");
  const [tipoCliente, setTipoCliente] = useState<TipoCliente>(TIPO_CLIENTE.MINORISTA);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    let cancelado = false;
    void listarClientesAction({ page: 1, limit: 100 }).then((r) => {
      if (!cancelado && r.ok) {
        setClientes(r.data.items.map((c) => ({ id: c.id, nombre: c.nombre })));
      }
    });
    return () => {
      cancelado = true;
    };
  }, []);

  async function registrar(e: FormEvent) {
    e.preventDefault();
    setGuardando(true);
    setError(null);
    const r = await crearClienteAction({
      nombre,
      telefono,
      direccion,
      tipoCliente,
    });
    if (r.ok) {
      setClientes((prev) => [...prev, { id: r.data.id, nombre: r.data.nombre }]);
      onChange({ id: r.data.id, nombre: r.data.nombre });
      setRegistroAbierto(false);
      setNombre("");
      setTelefono("");
      setDireccion("");
      setTipoCliente(TIPO_CLIENTE.MINORISTA);
    } else {
      setError(r.error.message);
    }
    setGuardando(false);
  }

  return (
    <section aria-label="Client" className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="mb-3 text-sm font-semibold text-zinc-900 dark:text-zinc-50">Client</h2>
      <div className="flex items-center gap-2">
        <select
          aria-label="Client selection"
          value={value.id === null ? "" : String(value.id)}
          onChange={(e) => {
            if (e.target.value === "") {
              onChange({ id: null, nombre: CONSUMIDOR_FINAL_LABEL });
            } else {
              const id = Number(e.target.value);
              const c = clientes.find((x) => x.id === id);
              onChange({ id, nombre: c?.nombre ?? `#${id}` });
            }
          }}
          className="h-10 flex-1 rounded-lg border border-zinc-300 px-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-50"
        >
          <option value="">{CONSUMIDOR_FINAL_LABEL} (default)</option>
          {clientes.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nombre}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => setRegistroAbierto((v) => !v)}
          className="h-10 shrink-0 rounded-lg border border-zinc-300 px-3 text-xs font-medium text-zinc-700 dark:border-zinc-700 dark:text-zinc-300"
        >
          {registroAbierto ? "Close" : "New client"}
        </button>
      </div>

      {registroAbierto && (
        <form onSubmit={registrar} className="mt-3 flex flex-col gap-2">
          <input
            required
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            aria-label="New client name"
            placeholder="Name"
            className="h-9 w-full rounded-lg border border-zinc-300 px-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-50"
          />
          <input
            required
            value={telefono}
            onChange={(e) => setTelefono(e.target.value)}
            aria-label="New client phone"
            placeholder="Phone"
            className="h-9 w-full rounded-lg border border-zinc-300 px-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-50"
          />
          <input
            required
            value={direccion}
            onChange={(e) => setDireccion(e.target.value)}
            aria-label="New client address"
            placeholder="Address"
            className="h-9 w-full rounded-lg border border-zinc-300 px-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-50"
          />
          <select
            aria-label="New client type"
            value={tipoCliente}
            onChange={(e) => setTipoCliente(e.target.value as TipoCliente)}
            className="h-9 w-full rounded-lg border border-zinc-300 px-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-50"
          >
            {TIPOS_ALTA_RAPIDA.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          {error !== null && <p role="alert" className="text-sm text-red-600">{error}</p>}
          <button
            type="submit"
            disabled={guardando}
            className="h-9 rounded-lg bg-indigo-600 px-3 text-sm font-medium text-white disabled:opacity-50"
          >
            {guardando ? "Saving…" : "Create and select"}
          </button>
        </form>
      )}
    </section>
  );
}
