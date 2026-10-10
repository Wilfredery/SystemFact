/**
 * Cloud structural bootstrap seed (`pnpm seed:bootstrap`).
 *
 * WHAT IT DOES
 *   Creates the MINIMUM structural skeleton so the app can boot on the Supabase
 *   production project and the E2E specs find their preconditions:
 *     - ROL catalog rows for the four role names the app recognizes everywhere
 *       (Administrador / Operador / Cobrador / Despachador â€” the "seeded
 *       catalog" named at src/modules/reportes/domain/roles.ts; the role gates
 *       in venta/cobros/cliente/producto/â€¦ match these exact strings).
 *     - DEMO EMPRESA (facturaAutomatica=true â€” R-F1 confirm gate, asserted by
 *       e2e/confirm-venta.spec.ts and e2e/devolucion.spec.ts preconditions).
 *     - DEMO main SUCURSAL for that empresa.
 *     - ADMIN USUARIO (nombreUsuario = ADMIN_USUARIO) + USUARIO_ROL
 *       (Administrador). `authUserId` stays NULL: the app binds it on the first
 *       successful login (ADR-014).
 *     - Matching auth.users row: synthetic email `buildSyntheticEmail(admin)`
 *       (ADR-014 â€” email is never a credential), bcrypt password hash computed
 *       IN THE DATABASE with pgcrypto `crypt(..., gen_salt('bf', 10))` (cost 10
 *       = GoTrue's default), confirmed/created/updated timestamps set sane.
 *       auth.users rows are outside the app role's reach, so the script MUST
 *       connect via a PRIVILEGED connection (see below).
 *     - Demo CATEGORIA + PRODUCTO "Arroz" (codigo ARROZ-001, ITBIS 18% â€” the
 *       per-product DB-sourced rate and validity window required by
 *       preparar-lineas-venta.ts `TASA_ITBIS_VIGENCIA_FALTA`; V1 POS E2E_PRODUCT
 *       default) and its initial INVENTARIO stock at the main branch (with the
 *       AJUSTE MOVIMIENTO_INVENTARIO trail AGENTS.md mandates for EVERY stock
 *       change).
 *
 * WHAT IT DOES NOT DO â€” follow-up seeds the operator runs AFTERWARD (same
 *   privileged connection style), in this order:
 *     pnpm seed:ncf        (B01/B02/B04 ranges â€” e2e needs B01/B02 AND B04)
 *     pnpm seed:retencion  (ISR/ITBIS retention keys)
 *     pnpm seed:venta      (DESC_MAX, PLAZO_DEVOLUCION, RETROACTIVO_FECHA_VENTA_DIAS)
 *     pnpm seed:cliente    (per-empresa Consumidor Final)
 *     pnpm config:verify   (reads every provisioned key back)
 *   This script NEVER invokes them.
 *
 * CONNECTION (privileged, hidden-input)
 *   The bootstrap reads PROD_PRIVILEGED_URL first (operator `postgres` clone of
 *   DIRECT_URL), then DIRECT_URL, then DATABASE_URL (local/dev parity with the
 *   other seeds). Never pass secrets on a command line â€” use the launcher,
 *   which mirrors supabase-prod-migrate.ps1's hidden-input handling:
 *     powershell -ExecutionPolicy Bypass -File app/tools/scripts/seed-cloud-bootstrap-prod.ps1
 *   It probes the known pooler hosts with the repo's prod-connection-diag.ts,
 *   then exports for the child process:
 *     PROD_PRIVILEGED_URL  the winning operator connection string
 *     ADMIN_PASSWORD       initial password for the admin Auth user (min 8 chars,
 *                          GoTrue default policy)
 *
 * IDEMPOTENCY (re-running CHANGES NOTHING)
 *   Every step is find-or-create or a no-op-update upsert
 *   (the Prisma equivalent of ON CONFLICT DO NOTHING/UPDATE-only):
 *   ROLES by nombre (no unique in schema â€” findFirst, fixtures precedent),
 *   EMPRESA by unique rnc, SUCURSAL by empresaId+nombre, USUARIO by unique
 *   nombreUsuario, USUARIO_ROL by its compound PK (update: {}), CATEGORIA by
 *   (empresaId, nombre), PRODUCTO by (empresaId, codigo), INVENTARIO by
 *   (sucursalId, productoId) â€” and an EXISTING auth.users row is neither
 *   modified nor deleted (existence check on lower(email), partially-unique
 *   index users_email_partial_key). If the DB already had an inventory row
 *   with consumed stock, the seed only WARNS: it never silently tops the
 *   quantity back up (that would mask a real sale).
 *
 * SECURITY / SECRETS
 *   The plaintext password exists ONLY as a bound query parameter inside the
 *   bcrypt computation; it is never logged (and no password CONTAINING output
 *   is printed). auth.users.encrypted_password receives the REAL hash (GoTrue
 *   owns the login; ADR-014). USUARIO.passwordHash NEVER receives it: the app
 *   no longer authenticates against that column, so it stores the bcrypt of a
 *   RANDOM in-database value instead - a dead-format placeholder that cannot be
 *   replayed anywhere if the USUARIO table ever leaks. If an existing row still
 *   carries a hash that crypt-verifies against the live password, the seed
 *   replaces it with the random placeholder (one-way remediation).
 *
 * CLI-only wiring (parity with seed-ncf.ts): the async work runs under main()
 * invoked from the argv gate, so unit opportunities here stay import-safe; no
 * top-level await.
 */

import "dotenv/config";
import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "@/generated/prisma/client";
import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import { buildSyntheticEmail } from "@/modules/auth/domain/synthetic-email";

// ============================================================================
// Configurable constants (operator-tunable; they are SEED data, not app rules)
// ============================================================================

/** Login identifier (ADR-014): same value as public.USUARIO.nombreUsuario. */
export const ADMIN_USUARIO = "admin";
/** Display name for the bootstrap admin USUARIO row. */
export const ADMIN_NOMBRE = "Administrador demo";
/** Minimum length mirrored from GoTrue's default password policy. */
export const ADMIN_PASSWORD_MIN_LONGITUD = 8;

/** Demo tenant â€” R-F1 emit-on-confirm ON so the POS/E2E gate passes. */
export const EMPRESA_DEMO = {
  nombreComercial: "SistemaFact Demo",
  rnc: "131000002", // mod-11 VALID 9-digit demo RNC (shared/domain/fiscal-id.ts)
  razonSocial: "SistemaFact Demo SRL",
  direccionFiscal: "Av. Winston Churchill #000, Santo Domingo, RD",
  telefono: "809-000-0000",
  correo: "demo@systemfact.internal",
  logo: "",
  regimenFiscal: "NORMAL",
  facturaAutomatica: true,
} as const;

/** Main demo branch the admin operates from. */
export const SUCURSAL_DEMO = {
  nombre: "Matriz Central",
  direccion: "Av. Winston Churchill #000, Santo Domingo, RD",
  telefono: "809-000-0000",
} as const;

/**
 * Role catalog â€” the four `ROL.nombre` values the app code matches against
 * (reportes/domain/roles.ts `ROL` map; subsystem shared.ts ROLES_* arrays).
 * Descriptions mirror docs/04-rolesPermisosFact.md.
 */
export const ROLES_CATALOGO: readonly {
  nombre: string;
  descripcion: string;
}[] = [
  {
    nombre: "Administrador",
    descripcion: "Acceso total: empresas, sucursales, personal, anulaciones y descuentos",
  },
  {
    nombre: "Operador",
    descripcion: "OperaciÃ³n completa en su sucursal asignada (venta, clientes, productos, inventario, cobros)",
  },
  {
    nombre: "Cobrador",
    descripcion: "MÃ³dulo Cobros y reportes CxC en su sucursal asignada",
  },
  {
    nombre: "Despachador",
    descripcion: "Registro de ventas (POS) y pago de contado en su sucursal asignada",
  },
];

/** Product category for the demo products. */
export const CATEGORIA_DEMO = { nombre: "Consumo diario" } as const;

/** Product provisioned for the E2E specs (E2E_PRODUCT defaults to "Arroz"). */
export const PRODUCTO_ARROZ = {
  codigo: "ARROZ-001",
  nombre: "Arroz",
  codigoBarras: "7400001000010",
  unidadMedida: "Libra",
  unidadEmpaque: "Libra",
  stockMinimo: 10,
  precioCompra: "25.00",
  precioVenta: "40.00",
  costoPromedio: "25.00",
  /** ITBIS 18% â€” Ley 224-06 general rate (domain enum allows 0/16/18). */
  tasaItbis: "18.00",
} as const;

/** Initial sellable stock at the main branch (Decimal(12,3) shape). */
export const STOCK_INICIAL_LIBRAS_ARROZ = "100.000";

/**
 * Open-ended ITBIS validity window start for the demo product: any sale date
 * inside the row's coverage satisfies `tasaVigenteEn` (preparar-lineas-venta.ts).
 * Set in the past so progressive re-runs never create a future-date mismatch;
 * `itbisVigenteHasta` stays NULL (rate valid until further notice).
 */
export const PRODUCTO_ITBIS_VIGENTE_DESDE = new Date("2000-01-01T00:00:00.000Z");

/** The tail of the batch operation for the closing log line. */
export interface BootstrapConteo {
  rolesCreados: number;
  empresaId: number;
  /** The stored flag of the resolved empresa — log reports it verbatim (R3-2). */
  facturaAutomatica: boolean;
  sucursalId: number;
  usuarioId: number;
  usuarioCreado: boolean;
  authUserCreado: boolean;
  productoId: number;
  inventarioCreado: boolean;
}

// ============================================================================
// pgcrypto helpers (bcrypt INSIDE the database â€” no Node dependency needed)
// ============================================================================

const PATRON_IDENT = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/**
 * Resolves the schema that exposes `gen_salt` (Supabase typically installs
 * pgcrypto in the `extensions` schema rather than `public`). Fails loud when
 * pgcrypto is not installed. The returned identifier is whitelisted before it
 * can ever reach a raw SQL template (Prisma.raw needs a literal identifier).
 */
async function obtenerEsquemaPgcryptoEnTx(db: PrismaTx): Promise<string> {
  const filas = await db.$queryRaw<Array<{ esquema: string }>>`
    select n.nspname as esquema
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where p.proname = 'gen_salt'
     limit 1`;
  const esquema = filas[0]?.esquema;
  if (esquema === undefined) {
    throw new Error(
      "seed-cloud-bootstrap: pgcrypto is not installed â€” enable it on the Supabase project (Dashboard â†’ Database â†’ Extensions) and retry",
    );
  }
  if (!PATRON_IDENT.test(esquema)) {
    throw new Error(
      `seed-cloud-bootstrap: unexpected pgcrypto schema name "${esquema}" (refusing to interpolate non-identifier identifiers)`,
    );
  }
  return esquema;
}

/**
 * Computes the GoTrue-compatible bcrypt hash of the plaintext INSIDE the
 * database (pgcrypto crypt, cost 10): the plaintext rides a bound parameter
 * and only the hash comes back, never the reverse. The hash feeds ONLY
 * auth.users.encrypted_password - USUARIO.passwordHash takes the dead random
 * placeholder (hashMuertoAleatorioEnTx).
 */
async function generarHashBcryptAdminEnTx(
  db: PrismaTx,
  sencilla: string,
  esquema: string,
): Promise<string> {
  const filas = await db.$queryRaw<Array<{ hash: string }>>`
    select ${Prisma.raw(`"${esquema}".`)}crypt(${sencilla}, ${Prisma.raw(`"${esquema}".`)}gen_salt('bf', 10)) as hash`;
  const hash = filas[0]?.hash;
  if (hash === undefined) {
    throw new Error("seed-cloud-bootstrap: pgcrypto crypt() returned no row â€” extension broken?");
  }
  return hash;
}

/**
 * Dead placeholder for USUARIO.passwordHash: the bcrypt of RANDOM in-database
 * bytes (pgcrypto gen_random_bytes). Keeps the column's historical format
 * (bcrypt) while guaranteeing it is NOT a replayable credential -$2b$10$ salt
 * prefix of a value that exists nowhere else. Reuses the same pgcrypto schema
 * resolved by resolverEsquemaPgcrypto.
 */
async function hashMuertoAleatorioEnTx(db: PrismaTx, esquema: string): Promise<string> {
  const filas = await db.$queryRaw<Array<{ hash: string }>>`
    select ${Prisma.raw(`"${esquema}".`)}crypt(
             encode(${Prisma.raw(`"${esquema}".`)}gen_random_bytes(24), 'hex'),
             ${Prisma.raw(`"${esquema}".`)}gen_salt('bf', 10)) as hash`;
  const hash = filas[0]?.hash;
  if (hash === undefined) {
    throw new Error("seed-cloud-bootstrap: pgcrypto crypt() returned no row - extension broken?");
  }
  return hash;
}

// ============================================================================
// Structural steps (each one find-or-create; ordered for referential integrity)
// ============================================================================

/** Seed the ROL catalog. ROL.nombre is NOT unique â€” find-or-create (fixtures precedent). */
async function asegurarRolesBase(db: PrismaTx): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  for (const rol of ROLES_CATALOGO) {
    const existente = await db.rol.findFirst({ where: { nombre: rol.nombre } });
    if (existente !== null) {
      map.set(rol.nombre, existente.id);
      continue;
    }
    const creado = await db.rol.create({ data: rol });
    map.set(rol.nombre, creado.id);
  }
  return map;
}

/** Find-or-create the demo EMPRESA by its unique RNC. Never edits an existing row. */
async function asegurarEmpresaDemo(
  db: PrismaTx,
): Promise<{ id: number; facturaAutomatica: boolean }> {
  const existente = await db.empresa.findUnique({ where: { rnc: EMPRESA_DEMO.rnc } });
  if (existente !== null) {
    return { id: existente.id, facturaAutomatica: existente.facturaAutomatica };
  }
  const creada = await db.empresa.create({ data: { ...EMPRESA_DEMO } });
  return { id: creada.id, facturaAutomatica: creada.facturaAutomatica };
}

/** Find-or-create the demo SUCURSAL (no unique key â€” empresaId + nombre probe). */
async function asegurarSucursalDemo(db: PrismaTx, empresaId: number): Promise<number> {
  const existente = await db.sucursal.findFirst({
    where: { empresaId, nombre: SUCURSAL_DEMO.nombre },
  });
  if (existente !== null) return existente.id;
  const creada = await db.sucursal.create({ data: { ...SUCURSAL_DEMO, empresaId } });
  return creada.id;
}

/**
 * Find-or-create the ADMIN USUARIO (unique nombreUsuario). Never updates an
 * existing user's password/empresa/binding (operator-owned). EXCEPTION: if an
 * EXISTING row's passwordHash crypt-verifies against the live password, it is
 * replaced with the random non-reusable placeholder (security hygiene: a
 * copied live credential must never sit in an app-side table; see header).
 */
async function asegurarUsuarioAdmin(
  db: PrismaTx,
  empresaId: number,
  sucursalId: number,
  contrasenaViva: string,
  esquema: string,
): Promise<{ id: number; creado: boolean; empresaId: number }> {
  const existente = await db.usuario.findFirst({
    where: { nombreUsuario: ADMIN_USUARIO },
    select: { id: true, empresaId: true, passwordHash: true },
  });
  if (existente !== null) {
    if (existente.empresaId !== empresaId) {
      console.warn(
        `WARN: USUARIO "${ADMIN_USUARIO}" exists in empresa ${existente.empresaId} (demo empresa is ${empresaId}) - reused untouched.`,
      );
    }
    const guardado = existente.passwordHash;
    if (guardado !== null && guardado !== "") {
      const filas = await db.$queryRaw<Array<{ coincide: boolean }>>`
        select ${guardado} = crypt(${contrasenaViva}, ${guardado}) as coincide`;
      if (filas[0]?.coincide === true) {
        await db.usuario.update({
          where: { id: existente.id },
          data: { passwordHash: await hashMuertoAleatorioEnTx(db, esquema) },
        });
        console.warn(
          `WARN: USUARIO.passwordHash held the LIVE credential hash - replaced with the random non-reusable placeholder.`,
        );
      }
    }
    return { id: existente.id, creado: false, empresaId: existente.empresaId };
  }
  const creado = await db.usuario.create({
    data: {
      empresaId,
      sucursalId,
      nombre: ADMIN_NOMBRE,
      nombreUsuario: ADMIN_USUARIO,
      passwordHash: await hashMuertoAleatorioEnTx(db, esquema),
      roles: { create: { rolId: (await rolAdministradorId(db)).id } },
    },
  });
  return { id: creado.id, creado: true, empresaId: creado.empresaId };
}

/** Resolves (find-or-create) the Administrador role used to bind the admin. */
async function rolAdministradorId(db: PrismaTx): Promise<{ id: number }> {
  const existente = await db.rol.findFirst({ where: { nombre: "Administrador" } });
  if (existente !== null) return { id: existente.id };
  const objetivo = ROLES_CATALOGO.find((r) => r.nombre === "Administrador");
  if (objetivo === undefined) throw new Error("seed-cloud-bootstrap: Administrador missing from catalog (unreachable)");
  const creado = await db.rol.create({ data: objetivo });
  return { id: creado.id };
}

/**
 * Guarantees the ADMIN USUARIO is bound to the Administrador role through the
 * USUARIO_ROL compound PK â€” no-op-update upsert, safe on re-run.
 */
async function asegurarRolAdmin(db: PrismaTx, usuarioId: number): Promise<void> {
  const rol = await rolAdministradorId(db);
  await db.usuarioRol.upsert({
    where: { usuarioId_rolId: { usuarioId, rolId: rol.id } },
    update: {},
    create: { usuarioId, rolId: rol.id },
  });
}

/**
 * Guarantees the auth.users row matching the synthetic email EXISTS. An
 * existing row is NEVER modified (GoTrue owns it from then on): the probe
 * mirrors the partially-unique index (lower email, non-SSO, not deleted).
 *
 * @param sencillaPlano plaintext password (bound parameter, never echoed)
 * @returns whether the row was INSERTED by this run
 */
async function asegurarAuthUserAdmin(
  db: PrismaTx,
  sencillaPlano: string,
  esquemaPgcrypto: string,
): Promise<boolean> {
  const correo = buildSyntheticEmail(ADMIN_USUARIO);
  const existentes = await db.$queryRaw<Array<{ id: string }>>`
    select id
      from auth.users
     where lower(email) = ${correo}
       and is_sso_user = false
       and deleted_at is null
     limit 1`;
  if (existentes.length > 0) {
    console.warn(
      `WARN: auth.users already holds "${correo}" â€” left untouched (no modification, no update).`,
    );
    return false;
  }

  const hash = await generarHashBcryptAdminEnTx(db, sencillaPlano, esquemaPgcrypto);
  const instante = new Date();
  // GoTrue's current schema gives `id` NO default (Supabase Admin API
  // generates the UUID server-side), so this seed supplies its own v4 UUID.
  const authUserId = randomUUID();
  await db.$executeRaw`
    insert into auth.users
      (id, aud, role, email, encrypted_password,
       email_confirmed_at,
       raw_app_meta_data, raw_user_meta_data,
       is_super_admin, is_sso_user, is_anonymous,
       created_at, updated_at)
    values
      (${authUserId}::uuid,
       'authenticated', 'authenticated', ${correo}, ${hash},
       ${instante},
       '{"provider":"email"}'::jsonb, '{}'::jsonb,
       false, false, false,
       ${instante}, ${instante})`;

  // Sanity invariants on the inserted row (log-only; read AFTER the insert so
  // any drift between the GoTrue columns and this seed surfaces immediately).
  const verificados = await db.$queryRaw<Array<{ confirmada: boolean }>>`
    select confirmed_at is not null as confirmada
      from auth.users
     where lower(email) = ${correo}
     limit 1`;
  if (verificados[0]?.confirmada !== true) {
    throw new Error(
      "seed-cloud-bootstrap: auth.users row inserted but confirmed_at is not derived — check the GoTrue generated-column schema",
    );
  }

  // GoTrue resolves the sign-in provider THROUGH auth.identities: a users row
  // without the matching email identity fails password grant with "invalid
  // credentials" (documented GoTrue behavior; observed 2026-10-10 on prod).
  await db.$executeRaw`
    insert into auth.identities
      (user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
    select u.id, 'email', 'email',
           jsonb_build_object('sub', u.id::text, 'email', u.email),
           u.created_at, u.created_at, u.created_at
      from auth.users u
     where lower(u.email) = ${correo}
       and not exists (
         select 1 from auth.identities i
          where i.user_id = u.id and i.provider_id = 'email')`;

  // GoTrue's Go-side row scan maps all token STRING columns with
  // "convert NULL to string is unsupported" semantics (observed prod log:
  // "error finding user: Scan error on column index 3, name 
  // \"confirmation_token\""): a users row with NULL tokens is unreadable and
  // the password grant 500s. The working rows carry '' for all of them.
  await db.$executeRaw`
    update auth.users
       set confirmation_token = '',
           recovery_token = '',
           email_change_token_new = '',
           email_change_token_current = '',
           reauthentication_token = '',
           phone_change_token = '',
           email_change = '',
           instance_id = '00000000-0000-0000-0000-000000000000'
     where lower(email) = ${correo}`;
  return true;
}

/** Find-or-create the demo CATEGORIA via its (empresaId, nombre) unique key. */
async function asegurarCategoriaDemo(db: PrismaTx, empresaId: number): Promise<number> {
  const categoria = await db.categoria.upsert({
    where: { empresaId_nombre: { empresaId, nombre: CATEGORIA_DEMO.nombre } },
    update: {},
    create: { empresaId, nombre: CATEGORIA_DEMO.nombre },
  });
  return categoria.id;
}

/** Find-or-create the demo PRODUCTO via its (empresaId, codigo) unique key. */
async function asegurarProductoArrozDemo(
  db: PrismaTx,
  empresaId: number,
  categoriaId: number,
): Promise<number> {
  const producto = await db.producto.upsert({
    where: { empresaId_codigo: { empresaId, codigo: PRODUCTO_ARROZ.codigo } },
    update: {},
    create: {
      empresaId,
      categoriaId,
      nombre: PRODUCTO_ARROZ.nombre,
      codigo: PRODUCTO_ARROZ.codigo,
      codigoBarras: PRODUCTO_ARROZ.codigoBarras,
      unidadMedida: PRODUCTO_ARROZ.unidadMedida,
      unidadEmpaque: PRODUCTO_ARROZ.unidadEmpaque,
      stockMinimo: PRODUCTO_ARROZ.stockMinimo,
      descripcion: null,
      precioCompra: new Prisma.Decimal(PRODUCTO_ARROZ.precioCompra),
      precioVenta: new Prisma.Decimal(PRODUCTO_ARROZ.precioVenta),
      costoPromedio: new Prisma.Decimal(PRODUCTO_ARROZ.costoPromedio),
      tasaItbis: new Prisma.Decimal(PRODUCTO_ARROZ.tasaItbis),
      itbisVigenteDesde: PRODUCTO_ITBIS_VIGENTE_DESDE,
      itbisAplicaRetencionITBIS: false,
    },
  });
  return producto.id;
}

/**
 * Find-or-create the initial INVENTARIO row for the demo product at the main
 * branch. The create branch leaves the AJUSTE MOVIMIENTO_INVENTARIO trace
 * AGENTS.md requires for EVERY stock change (delta 0 â†’ initial quantity); the
 * existing-row branch NEVER touches `cantidad` (only warns when below usable).
 */
async function asegurarInventarioInicial(
  db: PrismaTx,
  empresaId: number,
  sucursalId: number,
  productoId: number,
  usuarioId: number,
): Promise<{ creado: boolean; cantidadActual: string }> {
  const existente = await db.inventario.findUnique({
    where: { sucursalId_productoId: { sucursalId, productoId } },
    select: { id: true, cantidad: true },
  });
  if (existente !== null) {
    if (existente.cantidad.lessThan(new Prisma.Decimal("1.000"))) {
      console.warn(
        `WARN: INVENTARIO exists with cantidad=${existente.cantidad.toString()} (empresa ${empresaId}) â€” e2e needs >= 1; topped up NOT applied (never masks a real sale).`,
      );
    }
    return { creado: false, cantidadActual: existente.cantidad.toString() };
  }
  const creada = await db.inventario.create({
    data: {
      sucursalId,
      productoId,
      cantidad: new Prisma.Decimal(STOCK_INICIAL_LIBRAS_ARROZ),
    },
  });
  await db.movimientoInventario.create({
    data: {
      inventarioId: creada.id,
      tipoMovimiento: "AJUSTE",
      motivo: "Bootstrap seed: ajuste de existencias iniciales demo",
      cantidadMovida: new Prisma.Decimal(STOCK_INICIAL_LIBRAS_ARROZ),
      cantidadAnterior: new Prisma.Decimal("0.000"),
      cantidadNueva: new Prisma.Decimal(STOCK_INICIAL_LIBRAS_ARROZ),
      usuarioId,
      fecha: new Date(),
    },
  });
  return { creado: true, cantidadActual: STOCK_INICIAL_LIBRAS_ARROZ };
}

/**
 * Runs the whole bootstrap inside ONE transaction: a half-provisioned run
 * rolls back entirely, and the idempotent guards make every retry converge to
 * the same final state. Returns the counts for the closing log line.
 */
export async function bootstrapCloudStructural(
  db: PrismaClient,
  contrasenaPlano: string,
): Promise<BootstrapConteo> {
  if (contrasenaPlano.length < ADMIN_PASSWORD_MIN_LONGITUD) {
    throw new Error(
      `seed-cloud-bootstrap: ADMIN_PASSWORD must be at least ${ADMIN_PASSWORD_MIN_LONGITUD} chars (nothing was sent to the DB)`,
    );
  }
  // Rollback-on-failure needs the FULL interactive transaction to survive a
  // remote session pooler: defaults (5s) were rated a real abort risk against
  // the Supabase prod pooler latency (review R3-1), so override with 60s.
  const conteo: BootstrapConteo = await db.$transaction(
    async (tx: PrismaTx): Promise<BootstrapConteo> => {
      // Guards first, before any business write (fail-fast, zero writes).
      const esquemaPgcrypto = await obtenerEsquemaPgcryptoEnTx(tx);

      // 1. ROL catalog.
      const roles = await asegurarRolesBase(tx);

      // 2. Tenant skeleton: EMPRESA → SUCURSAL.
      const empresa = await asegurarEmpresaDemo(tx);
      const sucursalId = await asegurarSucursalDemo(tx, empresa.id);

      // 3. Admin USUARIO + USUARIO_ROL (Administrador). auth.users keeps the
      //    real hash; USUARIO.passwordHash stores the dead random placeholder.
      const usuario = await asegurarUsuarioAdmin(
        tx,
        empresa.id,
        sucursalId,
        contrasenaPlano,
        esquemaPgcrypto,
      );
      await asegurarRolAdmin(tx, usuario.id);

      // 4. Supabase Auth row (synthetic email; password bcrypt-hashed in DB).
      const authCreado = await asegurarAuthUserAdmin(tx, contrasenaPlano, esquemaPgcrypto);

      // 5. Demo business data: CATEGORIA → PRODUCTO → INVENTARIO (+ AJUSTE).
      const categoriaId = await asegurarCategoriaDemo(tx, empresa.id);
      const productoId = await asegurarProductoArrozDemo(tx, empresa.id, categoriaId);
      const inventario = await asegurarInventarioInicial(
        tx,
        empresa.id,
        sucursalId,
        productoId,
        usuario.id,
      );

      return {
        rolesCreados: roles.size,
        empresaId: empresa.id,
        facturaAutomatica: empresa.facturaAutomatica,
        sucursalId,
        usuarioId: usuario.id,
        usuarioCreado: usuario.creado,
        authUserCreado: authCreado,
        productoId,
        inventarioCreado: inventario.creado,
      };
    },
    // Review finding R3-1: an interactive transaction against the remote
    // session pooler (bcrypt cost-10 crypt + ~20 sequential round-trips)
    // plausibly exceeds Prisma's 5s default; 60s keeps aborts meaningful.
    { maxWait: 10_000, timeout: 60_000 },
  );
  return conteo;
}

/** Parses/validates the operator envs (fail loud BEFORE any connection). */
function leerConfigOperador(): { url: string; contrasenaPlano: string } {
  const url =
    process.env["PROD_PRIVILEGED_URL"] ??
    process.env["DIRECT_URL"] ??
    process.env["DATABASE_URL"];
  if (url === undefined || !/^postgresql?:\/\//.test(url)) {
    throw new Error(
      "seed-cloud-bootstrap: set PROD_PRIVILEGED_URL (preferred, operator postgres) or DIRECT_URL/DATABASE_URL in the env â€” run via seed-cloud-bootstrap-prod.ps1 (hidden input)",
    );
  }
  const contrasenaPlano = process.env["ADMIN_PASSWORD"];
  if (contrasenaPlano === undefined || contrasenaPlano.length === 0) {
    throw new Error(
      "seed-cloud-bootstrap: ADMIN_PASSWORD is not set â€” the launcher exports it from hidden input; never pass it on a command line",
    );
  }
  return { url, contrasenaPlano };
}

/** CLI entry point (run via `pnpm seed:bootstrap` / the prod launcher ps1). */
async function main(): Promise<void> {
  const { url, contrasenaPlano } = leerConfigOperador();
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  try {
    const conteo = await bootstrapCloudStructural(db, contrasenaPlano);
    console.log(
      [
        "OK: bootstrap structural completed (idempotent â€” re-running changes nothing):",
        `  ROL           ${String(conteo.rolesCreados)} created / ${String(ROLES_CATALOGO.length)} total`,
        `  EMPRESA       id=${String(conteo.empresaId)} (facturaAutomatica=${String(conteo.facturaAutomatica)}, demo "SistemaFact Demo")`,
        `  SUCURSAL      id=${String(conteo.sucursalId)} ("${SUCURSAL_DEMO.nombre}")`,
        `  USUARIO       id=${String(conteo.usuarioId)} ("${ADMIN_USUARIO}", ${conteo.usuarioCreado ? "created" : "already existed"})`,
        `  auth.users    ${conteo.authUserCreado ? "created" : "already existed â€” untouched"} (${buildSyntheticEmail(ADMIN_USUARIO)})`,
        `  CATEGORIA     ("${CATEGORIA_DEMO.nombre}")`,
        `  PRODUCTO      id=${String(conteo.productoId)} ("${PRODUCTO_ARROZ.nombre}" ${PRODUCTO_ARROZ.codigo}, ITBIS ${PRODUCTO_ARROZ.tasaItbis})`,
        `  INVENTARIO    ${conteo.inventarioCreado ? "created" : "already existed â€” quantity untouched"} (${STOCK_INICIAL_LIBRAS_ARROZ} Libra @ "${SUCURSAL_DEMO.nombre}")`,
        "",
        "Follow-up seeds (operator, same privileged connection):",
        "  pnpm seed:ncf && pnpm seed:retencion && pnpm seed:venta && pnpm seed:cliente && pnpm config:verify",
        "",
        `E2E env: E2E_USER=${ADMIN_USUARIO}  E2E_PASSWORD=<the ADMIN_PASSWORD you chose>  E2E_PRODUCT=${PRODUCTO_ARROZ.nombre}`,
      ].join("\n"),
    );
  } finally {
    await db.$disconnect();
  }
}

if (
  process.argv[1] !== undefined &&
  process.argv[1].includes("seed-cloud-bootstrap")
) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
