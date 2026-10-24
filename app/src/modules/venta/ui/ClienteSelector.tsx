"use client";

/**
 * Client picker (spec R-V14): defaults to "Consumidor Final" — choosing it
 * submits `clienteId: null` and the SAVE PIPELINE resolves the CF through the
 * 5a seam (resolver-cliente-venta → getOrCreateConsumidorFinalEnTx); the UI
 * never calls the resolver directly. Inline registration goes through the
 * existing `crearClienteAction`.
 *
 * F2 (D6, R-V19/R-V27): options carry the credit profile already shipped by
 * `listarClientesAction` (no extra fetch); the selected profile is reported up
 * via `onPerfilSeleccionado` so PosScreen derives the credit indicator from
 * owned state. The profile block renders ONLY for the derived-credit client
 * (backend mirror rule via `derivarFormaVenta`) — never a toggle.
 */

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { crearClienteAction, listarClientesAction } from "@/modules/cliente/http/actions";
import { TIPO_CLIENTE, type TipoCliente } from "@/modules/cliente/domain/cliente";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { formatearMonto } from "@/shared/ui/format";
import { CONSUMIDOR_FINAL_LABEL, type SeleccionCliente } from "./carro";
import { derivarFormaVenta } from "./credito";

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
  tipoCliente: string;
  esConsumidorFinal: boolean;
  creditoHabilitado: boolean;
  /** Decimal-string money (DTO contract) — never parsed to number/float. */
  limiteCredito: string;
  plazoCreditoDias: number;
}

/** The selected client's credit facts, without identity. */
export type PerfilClienteSeleccion = Omit<ClienteOpcion, "id" | "nombre">;

export function ClienteSelector({
  value,
  onChange,
  onPerfilSeleccionado,
}: {
  readonly value: SeleccionCliente;
  readonly onChange: (s: SeleccionCliente) => void;
  readonly onPerfilSeleccionado?: (p: PerfilClienteSeleccion | null) => void;
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
        setClientes(
          r.data.items.map((c) => ({
            id: c.id,
            nombre: c.nombre,
            tipoCliente: c.tipoCliente,
            esConsumidorFinal: c.esConsumidorFinal,
            creditoHabilitado: c.creditoHabilitado,
            limiteCredito: c.limiteCredito,
            plazoCreditoDias: c.plazoCreditoDias,
          })),
        );
      }
    });
    return () => {
      cancelado = true;
    };
  }, []);

  // Report the selected profile upward (owned state in PosScreen) whenever the
  // selection or the loaded list changes; `null` = no client (CF default).
  // Deps anchor on the selection identity, NOT the derived object — a fresh
  // object every render would re-fire the effect forever.
  const seleccionado = useMemo(
    () => (value.id === null ? null : clientes.find((c) => c.id === value.id) ?? null),
    [value.id, clientes],
  );
  const perfilSeleccionado: PerfilClienteSeleccion | null =
    seleccionado === null
      ? null
      : {
          tipoCliente: seleccionado.tipoCliente,
          esConsumidorFinal: seleccionado.esConsumidorFinal,
          creditoHabilitado: seleccionado.creditoHabilitado,
          limiteCredito: seleccionado.limiteCredito,
          plazoCreditoDias: seleccionado.plazoCreditoDias,
        };
  useEffect(() => {
    onPerfilSeleccionado?.(perfilSeleccionado);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seleccionado]);

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
      // Quick-add only offers MINORISTA/MAYORISTA → definitionally contado:
      // zero-credit literal defaults keep the option shape coherent.
      setClientes((prev) => [
        ...prev,
        {
          id: r.data.id,
          nombre: r.data.nombre,
          tipoCliente: r.data.tipoCliente,
          esConsumidorFinal: r.data.esConsumidorFinal,
          creditoHabilitado: false,
          limiteCredito: "0.00",
          plazoCreditoDias: 30,
        },
      ]);
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

  const esCredito = derivarFormaVenta(perfilSeleccionado) === "CREDITO";

  return (
    <Card aria-label="Client">
      <CardHeader>
        <CardTitle className="text-sm font-semibold">Client</CardTitle>
      </CardHeader>
      <CardContent>
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
            className="min-h-11 flex-1 rounded-lg border border-line bg-surface px-2.5 text-sm text-ink"
          >
            <option value="">{CONSUMIDOR_FINAL_LABEL} (default)</option>
            {clientes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre}
              </option>
            ))}
          </select>
          <Button
            type="button"
            variant="outline"
            onClick={() => setRegistroAbierto((v) => !v)}
            className="shrink-0 text-xs"
          >
            {registroAbierto ? "Close" : "New client"}
          </Button>
        </div>
        {/* Derived-credit profile facts (D6, R-V19) — display only, no toggle. */}
        {perfilSeleccionado !== null && esCredito && (
          <div className="mt-2 flex items-center gap-3 text-sm text-ink">
            <Badge variant="secondary">CREDITO</Badge>
            <span>Limite: {formatearMonto(perfilSeleccionado.limiteCredito)}</span>
            <span>Plazo: {perfilSeleccionado.plazoCreditoDias} días</span>
          </div>
        )}
        {perfilSeleccionado !== null && perfilSeleccionado.esConsumidorFinal && (
          <p className="mt-2 text-sm text-muted">
            Consumidor Final — cash sale (no credit facts apply)
          </p>
        )}
      </CardContent>

      {registroAbierto && (
        <CardContent className="mt-3">
          <form onSubmit={registrar} className="flex flex-col gap-4">
            <Input
              required
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              aria-label="New client name"
              placeholder="Name"
            />
            <Input
              required
              value={telefono}
              onChange={(e) => setTelefono(e.target.value)}
              aria-label="New client phone"
              placeholder="Phone"
            />
            <Input
              required
              value={direccion}
              onChange={(e) => setDireccion(e.target.value)}
              aria-label="New client address"
              placeholder="Address"
            />
            <select
              aria-label="New client type"
              value={tipoCliente}
              onChange={(e) => setTipoCliente(e.target.value as TipoCliente)}
              className="min-h-11 w-full rounded-lg border border-line bg-surface px-2.5 text-sm text-ink"
            >
              {TIPOS_ALTA_RAPIDA.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            {error !== null && <p role="alert" className="text-sm text-danger">{error}</p>}
            <Button type="submit" size="pos" disabled={guardando}>
              {guardando ? "Saving…" : "Create and select"}
            </Button>
          </form>
        </CardContent>
      )}
    </Card>
  );
}
