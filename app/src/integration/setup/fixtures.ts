/**
 * Seed fixtures for the REAL-DB integration harness.
 *
 * All seeding runs on a PRIVATE superuser client (process.env.DIRECT_URL →
 * `systemfact_test`). The superuser bypasses RLS, which is fine here: the
 * harness is trusted seed/truncate tooling. The code under test never touches
 * this client — it always goes through `@/lib/prisma` (app role, RLS enforced)
 * via `withTenantTransaction`.
 *
 * Money/quantities use `Prisma.Decimal` per AGENTS.md (never number/float).
 */

import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "@/generated/prisma/client";

let harnessClient: PrismaClient | null = null;

/** Lazily-created superuser client pointed at DIRECT_URL (systemfact_test). */
export function getHarnessDb(): PrismaClient {
  if (harnessClient === null) {
    const directUrl = process.env.DIRECT_URL;
    if (directUrl === undefined || directUrl === "") {
      throw new Error(
        "DIRECT_URL is not set. jest.integration.config.js must load .env.integration via globalSetup.",
      );
    }
    harnessClient = new PrismaClient({ adapter: new PrismaPg({ connectionString: directUrl }) });
  }
  return harnessClient;
}

export async function closeHarnessDb(): Promise<void> {
  if (harnessClient !== null) {
    await harnessClient.$disconnect();
    harnessClient = null;
  }
}

/** System tables that must survive a truncate (migration history bookkeeping). */
const EXCLUDED_TABLES = new Set(["_prisma_migrations"]);

/**
 * Truncate every public table and reset identities. Called before each test so
 * every test is order-independent and starts from an empty database.
 */
export async function truncateAll(): Promise<void> {
  const db = getHarnessDb();
  const rows = await db.$queryRaw<{ tablename: string }[]>`
    SELECT "tablename" FROM "pg_tables" WHERE "schemaname" = 'public'`;
  const tables = rows.map((r) => `"${r.tablename}"`).filter((q) => {
    const name = q.slice(1, -1);
    return !EXCLUDED_TABLES.has(name);
  });
  if (tables.length === 0) return;
  await db.$executeRawUnsafe(
    `TRUNCATE TABLE ${tables.join(", ")} RESTART IDENTITY CASCADE`,
  );
}

/** Per-empresa product inventory quantities, seeded as Decimal(12,3). */
export interface SeedInventorySpec {
  readonly sucursalId: number;
  readonly productoId: number;
  readonly cantidad: string;
}

export interface TenantFixtureUsuarios {
  readonly adminA: { readonly id: number; readonly nombreUsuario: string };
  readonly adminB: { readonly id: number; readonly nombreUsuario: string };
}

export interface TenantFixtureProductos {
  /** Producto of empresa A seeded in sucursal A1 with 10.000 units. */
  readonly prodA1: { readonly id: number; readonly codigo: string };
  /** Producto of empresa A seeded ONLY in sucursal A2 (not A1). */
  readonly prodA2Only: { readonly id: number; readonly codigo: string };
  /** Producto of empresa B seeded in sucursal B1. */
  readonly prodB1: { readonly id: number; readonly codigo: string };
}

export interface TenantFixtureInventarios {
  readonly a1ProdA1: { readonly id: number };
  readonly a2ProdA2Only: { readonly id: number };
  readonly b1ProdB1: { readonly id: number };
}

export interface TenantFixture {
  readonly empresaA: { readonly id: number };
  readonly empresaB: { readonly id: number };
  readonly sucursalA1: { readonly id: number };
  readonly sucursalA2: { readonly id: number };
  readonly sucursalB1: { readonly id: number };
  readonly usuarios: TenantFixtureUsuarios;
  readonly productos: TenantFixtureProductos;
  readonly inventarios: TenantFixtureInventarios;
}

const UNIQUE_SUFFIX = (): string =>
  `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

/**
 * Full two-company fixture:
 *   Empresa A → Sucursal A1, A2; Empresa B → Sucursal B1.
 * Each empresa gets its own categoria + productos; each sucursal its own
 * INVENTARIO rows; the "Administrador" role (the role name buildTenantContext
 * maps to esAdmin) is linked to the A admin user.
 */
export async function seedTenantFixture(): Promise<TenantFixture> {
  const db = getHarnessDb();
  const suffix = UNIQUE_SUFFIX();

  // Role needed by buildTenantContext (roles.includes("Administrador")).
  // ROL.nombre is NOT unique in the schema, so find-or-create (not upsert).
  let rolAdmin = await db.rol.findFirst({ where: { nombre: "Administrador" } });
  if (rolAdmin === null) {
    rolAdmin = await db.rol.create({
      data: { nombre: "Administrador", descripcion: "Integration harness admin role" },
    });
  }

  const empresaA = await db.empresa.create({
    data: {
      nombreComercial: `IntA-${suffix}`,
      rnc: `RNC-A-${suffix}`,
      razonSocial: `IntA-${suffix}`,
      direccionFiscal: "x",
      telefono: "0",
      correo: "a@integration.test",
      logo: "",
      regimenFiscal: "NORMAL",
    },
  });
  const empresaB = await db.empresa.create({
    data: {
      nombreComercial: `IntB-${suffix}`,
      rnc: `RNC-B-${suffix}`,
      razonSocial: `IntB-${suffix}`,
      direccionFiscal: "x",
      telefono: "0",
      correo: "b@integration.test",
      logo: "",
      regimenFiscal: "NORMAL",
    },
  });

  const sucursalA1 = await db.sucursal.create({
    data: { empresaId: empresaA.id, nombre: "A1", direccion: "x", telefono: "0" },
  });
  const sucursalA2 = await db.sucursal.create({
    data: { empresaId: empresaA.id, nombre: "A2", direccion: "x", telefono: "0" },
  });
  const sucursalB1 = await db.sucursal.create({
    data: { empresaId: empresaB.id, nombre: "B1", direccion: "x", telefono: "0" },
  });

  const adminA = await db.usuario.create({
    data: {
      empresaId: empresaA.id,
      sucursalId: sucursalA1.id,
      nombre: "Admin A",
      nombreUsuario: `intadmin-a-${suffix}`,
      passwordHash: "test-hash",
      roles: { create: { rolId: rolAdmin.id } },
    },
  });
  const adminB = await db.usuario.create({
    data: {
      empresaId: empresaB.id,
      sucursalId: sucursalB1.id,
      nombre: "Admin B",
      nombreUsuario: `intadmin-b-${suffix}`,
      passwordHash: "test-hash",
    },
  });

  const catA = await db.categoria.create({
    data: { empresaId: empresaA.id, nombre: `catA-${suffix}` },
  });
  const catB = await db.categoria.create({
    data: { empresaId: empresaB.id, nombre: `catB-${suffix}` },
  });

  const itbisDesde = new Date();
  const productoData = (empresaId: number, categoriaId: number, codigo: string) => ({
    empresaId,
    categoriaId,
    nombre: codigo,
    codigo,
    codigoBarras: `BC-${codigo}`,
    unidadMedida: "u",
    unidadEmpaque: "c",
    stockMinimo: 0,
    precioCompra: new Prisma.Decimal(0),
    precioVenta: new Prisma.Decimal(0),
    costoPromedio: new Prisma.Decimal(0),
    tasaItbis: new Prisma.Decimal(18),
    itbisVigenteDesde: itbisDesde,
  });

  const prodA1 = await db.producto.create({
    data: productoData(empresaA.id, catA.id, `PA1-${suffix}`),
  });
  const prodA2Only = await db.producto.create({
    data: productoData(empresaA.id, catA.id, `PA2-${suffix}`),
  });
  const prodB1 = await db.producto.create({
    data: productoData(empresaB.id, catB.id, `PB1-${suffix}`),
  });

  const inventarioA1 = await db.inventario.create({
    data: {
      sucursalId: sucursalA1.id,
      productoId: prodA1.id,
      cantidad: new Prisma.Decimal("10.000"),
    },
  });
  const inventarioA2 = await db.inventario.create({
    data: {
      sucursalId: sucursalA2.id,
      productoId: prodA2Only.id,
      cantidad: new Prisma.Decimal("5.000"),
    },
  });
  const inventarioB1 = await db.inventario.create({
    data: {
      sucursalId: sucursalB1.id,
      productoId: prodB1.id,
      cantidad: new Prisma.Decimal("7.000"),
    },
  });

  return {
    empresaA: { id: empresaA.id },
    empresaB: { id: empresaB.id },
    sucursalA1: { id: sucursalA1.id },
    sucursalA2: { id: sucursalA2.id },
    sucursalB1: { id: sucursalB1.id },
    usuarios: {
      adminA: { id: adminA.id, nombreUsuario: adminA.nombreUsuario },
      adminB: { id: adminB.id, nombreUsuario: adminB.nombreUsuario },
    },
    productos: {
      prodA1: { id: prodA1.id, codigo: prodA1.codigo },
      prodA2Only: { id: prodA2Only.id, codigo: prodA2Only.codigo },
      prodB1: { id: prodB1.id, codigo: prodB1.codigo },
    },
    inventarios: {
      a1ProdA1: { id: inventarioA1.id },
      a2ProdA2Only: { id: inventarioA2.id },
      b1ProdB1: { id: inventarioB1.id },
    },
  };
}
