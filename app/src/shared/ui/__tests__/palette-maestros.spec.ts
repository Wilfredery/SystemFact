/**
 * @jest-environment node
 *
 * Screen audit S6 (odd/tasks/screen-audit-fixes.md T4): the three master-data screens (Clientes,
 * Productos, Proveedores), their forms and their deactivate dialogs use the F0 design-system tokens
 * only: no raw Tailwind palette, no arbitrary colors and no `dark:` variants (F0 is light-only).
 */

import { readFileSync } from "node:fs";
import path from "node:path";

const MODULOS = path.join(__dirname, "..", "..", "..", "modules");
const ARCHIVOS = [
  "cliente/ui/ClientesScreen.tsx",
  "cliente/ui/ClienteFormulario.tsx",
  "cliente/ui/ConfirmarDesactivacionCliente.tsx",
  "producto/ui/ProductosScreen.tsx",
  "producto/ui/ProductoFormulario.tsx",
  "producto/ui/ConfirmarDesactivacion.tsx",
  "proveedor/ui/ProveedoresScreen.tsx",
  "proveedor/ui/ProveedorFormulario.tsx",
  "proveedor/ui/ConfirmarDesactivacionProveedor.tsx",
];

const RAW_PALETTE =
  /(?:text|bg|border|ring|divide|from|to|placeholder|fill|stroke|shadow|outline|accent|caret|decoration)-(?:zinc|red|emerald|amber|indigo|gray|slate|neutral|stone|white|black|blue|green|sky|orange|violet|purple|yellow|rose|teal|cyan|lime|pink|fuchsia)-?[^\s"'`]*/g;
const ARBITRARY_HEX = /(?:text|bg|border|ring)-\[(?:#|rgb|hsl|oklch)[^\]]+\]/g;
const DARK_VARIANT = /\bdark:[^\s"'`]+/g;

describe("master-data screens — F0 tokens only (S6)", () => {
  it.each(ARCHIVOS)("%s has no raw palette, arbitrary colors or dark: variants", (archivo) => {
    const fuente = readFileSync(path.join(MODULOS, archivo), "utf8");
    const ofensas = [
      ...(fuente.match(RAW_PALETTE) ?? []),
      ...(fuente.match(ARBITRARY_HEX) ?? []),
      ...(fuente.match(DARK_VARIANT) ?? []),
    ];
    expect(ofensas).toEqual([]);
  });
});
