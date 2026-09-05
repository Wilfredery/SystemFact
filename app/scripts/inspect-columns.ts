import "dotenv/config";
import { prisma } from "@/lib/prisma";

async function inspect() {
  const rows = await prisma.$queryRaw<{ table_name: string; column_name: string }[]>`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name IN (
        'EMPRESA','SUCURSAL','USUARIO','USUARIO_ROL','CLIENTE','PROVEEDOR',
        'CATEGORIA','PRODUCTO','INVENTARIO','VENTA','DETALLE_VENTA',
        'FACTURA','NOTA_CREDITO','DETALLE_NOTA_CREDITO','NOTA_DEBITO',
        'PAGO','PAGO_PROVEEDOR','COMPRA','DETALLE_COMPRA',
        'MOVIMIENTO_INVENTARIO','NCF_SECUENCIA','CONFIGURACION_EMPRESA',
        'ANULACION','MOVIMIENTO_AUDITORIA','ROL'
      )
    ORDER BY table_name, ordinal_position
  `;

  // Agrupa por tabla
  const grouped: Record<string, string[]> = {};
  for (const r of rows) {
    (grouped[r.table_name] ??= []).push(r.column_name);
  }

  for (const [table, cols] of Object.entries(grouped)) {
    console.log(`${table}: ${cols.join(", ")}`);
  }

  await prisma.$disconnect();
}

inspect().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});