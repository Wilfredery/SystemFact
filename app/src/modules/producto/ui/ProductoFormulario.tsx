"use client";

/**
 * Productos create/edit dialog (plan Step 2, S1).
 *
 * Client island for the interactivity only: the page already refused to render
 * the manage controls for a view-only role, and each write action re-checks the
 * role on the server. The price is a Decimal(12,2) STRING end to end (never a
 * float); the form stops a value the server would refuse, with the same reason.
 *
 * Editing sends back the `version` the single-product read returned, so a
 * concurrent edit is refused instead of silently overwritten (S4).
 */

import { useState, type FormEvent } from "react";
import {
  crearProductoAction,
  actualizarProductoAction,
} from "@/modules/producto/http/actions";
import type { ProductoConsultaItem } from "@/modules/producto/application/producto-consulta-projection";
import type { TasaItbis } from "@/modules/producto/domain/producto";
import {
  Button,
} from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  MENSAJE_PRECIO_INVALIDO,
  esPrecioValido,
} from "./productos-filtros";

const MENSAJE_FALLO_ACCION = "No se pudo guardar el producto. Intente de nuevo.";
const CLASE_CONTROL =
  "min-h-11 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50";
const CLASE_ALERTA =
  "rounded-md bg-red-50 px-4 py-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-200";

const TASAS: readonly { valor: TasaItbis; etiqueta: string }[] = [
  { valor: "18", etiqueta: "18%" },
  { valor: "16", etiqueta: "16%" },
  { valor: "0", etiqueta: "0% (exento)" },
];

export interface ProductoFormularioProps {
  readonly producto: ProductoConsultaItem | null;
  readonly categorias: readonly { id: number; nombre: string }[];
  readonly onGuardado: () => void;
  readonly onCancelar: () => void;
}

export function ProductoFormulario({
  producto,
  categorias,
  onGuardado,
  onCancelar,
}: ProductoFormularioProps) {
  const editando = producto !== null;
  const [codigo, setCodigo] = useState(producto?.codigo ?? "");
  const [nombre, setNombre] = useState(producto?.nombre ?? "");
  const [categoriaId, setCategoriaId] = useState(
    producto === null ? "" : String(producto.categoriaId),
  );
  const [unidad, setUnidad] = useState(producto?.unidadMedida ?? "");
  const [precio, setPrecio] = useState(producto?.precioVenta ?? "");
  const [itbis, setItbis] = useState<TasaItbis>(producto?.tasaItbis ?? "18");
  const [descripcion, setDescripcion] = useState(producto?.descripcion ?? "");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const precioInvalido = precio.trim() !== "" && !esPrecioValido(precio);
  const completo =
    codigo.trim() !== "" &&
    nombre.trim() !== "" &&
    categoriaId !== "" &&
    esPrecioValido(precio) &&
    !enviando;

  async function guardar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (!completo) return;

    const detalle = descripcion.trim();
    setEnviando(true);
    setError(null);
    try {
      const r = producto === null
        ? await crearProductoAction({
            categoriaId: Number(categoriaId),
            codigo: codigo.trim(),
            nombre: nombre.trim(),
            ...(detalle === "" ? {} : { descripcion: detalle }),
            unidadMedida: unidad.trim(),
            precioVenta: precio.trim(),
            itbisTasa: itbis,
          })
        : await actualizarProductoAction({
            id: producto.id,
            version: producto.version,
            codigo: codigo.trim(),
            nombre: nombre.trim(),
            categoriaId: Number(categoriaId),
            unidadMedida: unidad.trim(),
            precioVenta: precio.trim(),
            itbisTasa: itbis,
            descripcion: detalle === "" ? null : detalle,
          });
      if (r.ok) {
        onGuardado();
        return;
      }
      setError(r.error.message);
      setEnviando(false);
    } catch {
      setError(MENSAJE_FALLO_ACCION);
      setEnviando(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(abierto) => {
        if (!abierto && !enviando) onCancelar();
      }}
    >
      <DialogContent aria-label={editando ? "Editar producto" : "Nuevo producto"}>
        <form onSubmit={(e) => void guardar(e)} noValidate className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{editando ? "Editar producto" : "Nuevo producto"}</DialogTitle>
            <DialogDescription>
              {editando
                ? "Los cambios se guardan sobre la versión leída; un cambio simultáneo se rechaza."
                : "Código, nombre, categoría y precio son obligatorios."}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-2">
            <Label htmlFor="producto-codigo">Código *</Label>
            <Input
              id="producto-codigo"
              value={codigo}
              onChange={(e) => setCodigo(e.target.value)}
              maxLength={255}
              autoComplete="off"
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="producto-nombre">Nombre *</Label>
            <Input
              id="producto-nombre"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              maxLength={255}
              autoComplete="off"
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="producto-categoria">Categoría *</Label>
            <select
              id="producto-categoria"
              value={categoriaId}
              onChange={(e) => setCategoriaId(e.target.value)}
              className={CLASE_CONTROL}
            >
              <option value="">Seleccionar categoría...</option>
              {categorias.map((c) => (
                <option key={c.id} value={String(c.id)}>
                  {c.nombre}
                </option>
              ))}
            </select>
            {categorias.length === 0 && (
              <p className="text-sm text-amber-700 dark:text-amber-300">
                No hay categorías activas.
              </p>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="producto-unidad">Unidad</Label>
            <Input
              id="producto-unidad"
              value={unidad}
              onChange={(e) => setUnidad(e.target.value)}
              maxLength={255}
              placeholder="Libra, Unidad, Caja..."
              autoComplete="off"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="producto-itbis">ITBIS *</Label>
              <select
                id="producto-itbis"
                value={itbis}
                onChange={(e) => setItbis(e.target.value as TasaItbis)}
                className={CLASE_CONTROL}
              >
                {TASAS.map((t) => (
                  <option key={t.valor} value={t.valor}>
                    {t.etiqueta}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="producto-precio">Precio de venta *</Label>
              <Input
                id="producto-precio"
                inputMode="decimal"
                value={precio}
                onChange={(e) => setPrecio(e.target.value)}
                placeholder="0.00"
                autoComplete="off"
                aria-describedby="producto-precio-detalle"
              />
            </div>
          </div>
          <p id="producto-precio-detalle" aria-live="polite" className="min-h-5 text-sm">
            {precioInvalido && (
              <span className="text-red-700 dark:text-red-300">{MENSAJE_PRECIO_INVALIDO}</span>
            )}
          </p>

          <div className="flex flex-col gap-2">
            <Label htmlFor="producto-descripcion">Descripción</Label>
            <textarea
              id="producto-descripcion"
              value={descripcion}
              onChange={(e) => setDescripcion(e.target.value)}
              maxLength={255}
              rows={3}
              className={`${CLASE_CONTROL} py-2`}
            />
          </div>

          {error !== null && (
            <p role="alert" className={CLASE_ALERTA}>
              {error}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onCancelar} disabled={enviando}>
              Cancelar
            </Button>
            <Button type="submit" disabled={!completo}>
              Guardar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
