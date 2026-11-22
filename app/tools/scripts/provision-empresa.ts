/**
 * Operator procedure that creates a company (`pnpm provision:empresa`).
 *
 * odd/tasks/multi-company-codigo.md S2/S3: companies are created ONLY by this
 * documented script, never from the app. It creates, in ONE transaction:
 *   - the EMPRESA (activa=true) with its immutable code (C1),
 *   - its first SUCURSAL,
 *   - the ROL catalog (find-or-create, the same four roles the demo seed creates),
 *   - the configuration rows the demo seeds create for a working company
 *     (ITBIS rate set, discount cap, returns term, retroactive-date window and the
 *     four retention keys), reusing the constants exported by seed-venta-config.ts
 *     and seed-retencion-config.ts,
 *   - the company's OWN NCF_SECUENCIA ranges, read from an explicit JSON file
 *     (never defaulted, never copied from another company),
 *   - the per-company Consumidor Final client (same seam the POS uses),
 *   - the first administrator USUARIO `<CODIGO>-<usuario>` with the Administrador
 *     role, and its Supabase Auth user (same technique as seed-cloud-bootstrap.ts:
 *     auth.users + identity + GoTrue token columns, password hashed IN the database),
 *   - one MOVIMIENTO_AUDITORIA row (CREAR / EMPRESA).
 *
 * USAGE (from `app/`; DRY-RUN by default, `--apply` is required to write):
 *   ADMIN_PASSWORD=... pnpm exec tsx tools/scripts/provision-empresa.ts \
 *     --codigo SOL --nombre-comercial "Sol Distribuciones" --rnc 131000002 \
 *     --sucursal "Matriz" --admin-usuario jperez --ncf-file ./ncf-sol.json [--apply]
 *
 * NCF FILE (JSON array, one entry per type; every field mandatory):
 *   [{ "tipoNcf": "B02", "rangoInicio": 1, "rangoFin": 500,
 *      "vigenciaInicio": "2027-01-01", "vigenciaFin": "2027-12-31" }]
 *
 * SECRETS: the password comes ONLY from the env var ADMIN_PASSWORD (min 12 chars);
 * it is never an argument and never printed. The connection string comes from
 * PROD_PRIVILEGED_URL, else DIRECT_URL, else DATABASE_URL (privileged role: the
 * script writes auth.users, which the app role cannot reach). RLS is also put in
 * bootstrap mode (`app.is_bootstrap`) for the transaction, like the RLS diagnostics.
 *
 * REFUSES (nothing written): invalid or already-used code (codes are never reused,
 * deactivated companies keep theirs), RNC already registered, admin name that does
 * not validate through `validarNombreUsuarioNuevo`, user name or Auth email already
 * present. A second `--apply` with the same code therefore fails cleanly instead of
 * duplicating anything.
 *
 * DRY-RUN prints exactly what would be created; when a connection string is
 * available it also runs the same "already in use" checks read-only.
 */

import "dotenv/config";
import fs from "node:fs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import { getOrCreateConsumidorFinalEnTx } from "@/modules/cliente/application/consumidor-final";
import {
  asegurarAuthUserAdmin,
  asegurarRolesBase,
  correoAuthDeNombreUsuario,
  EMPRESA_DEMO,
  hashMuertoAleatorioEnTx,
  obtenerEsquemaPgcryptoEnTx,
  ROLES_CATALOGO,
  rolAdministradorId,
} from "./seed-cloud-bootstrap";
import {
  CLAVE_SEED_VIGENCIA,
  DESC_MAX_CLAVE,
  DESC_MAX_SEED_VALOR,
  PLAZO_DEVOLUCION_CLAVE,
  PLAZO_DEVOLUCION_SEED_VALOR,
  RETROACTIVO_FECHA_VENTA_CLAVE,
  RETROACTIVO_FECHA_VENTA_SEED_VALOR,
  TASA_ITBIS_CLAVE,
  TASA_ITBIS_SEED_VALOR,
} from "./seed-venta-config";
import { RETENCION_SEED_VALORES, RETENCION_SEED_VIGENCIA } from "./seed-retencion-config";
import {
  describirPlanProvision,
  validarArgsProvision,
  validarRangosNcf,
  type ArgsProvision,
  type RangoNcfProvision,
} from "./provision-empresa-args";

/** A refusal the operator can act on (never a stack trace). */
export class ProvisionRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProvisionRefusedError";
  }
}

export interface ProvisionConteo {
  readonly empresaId: number;
  readonly sucursalId: number;
  readonly usuarioId: number;
  readonly clavesConfiguracion: number;
  readonly secuenciasNcf: number;
}

/** (clave, valor) pairs seeded for every new company: venta keys + retention keys. */
function configuracionInicial(): readonly { clave: string; valor: string; inicio: Date; fin: Date }[] {
  const venta = [
    [DESC_MAX_CLAVE, DESC_MAX_SEED_VALOR],
    [PLAZO_DEVOLUCION_CLAVE, PLAZO_DEVOLUCION_SEED_VALOR],
    [RETROACTIVO_FECHA_VENTA_CLAVE, RETROACTIVO_FECHA_VENTA_SEED_VALOR],
    [TASA_ITBIS_CLAVE, TASA_ITBIS_SEED_VALOR],
  ] as const;
  return [
    ...venta.map(([clave, valor]) => ({
      clave,
      valor,
      inicio: CLAVE_SEED_VIGENCIA.inicio,
      fin: CLAVE_SEED_VIGENCIA.fin,
    })),
    ...Object.entries(RETENCION_SEED_VALORES).map(([clave, valor]) => ({
      clave,
      valor,
      inicio: RETENCION_SEED_VIGENCIA.inicio,
      fin: RETENCION_SEED_VIGENCIA.fin,
    })),
  ];
}

/**
 * Read-only "is anything already in use" probe shared by the dry run and the
 * apply transaction. Throws {@link ProvisionRefusedError} naming the first clash.
 */
export async function verificarDisponibilidad(db: PrismaTx, args: ArgsProvision): Promise<void> {
  const porCodigo = await db.empresa.findUnique({ where: { codigo: args.codigo }, select: { id: true } });
  if (porCodigo !== null) {
    throw new ProvisionRefusedError(
      `Company code ${args.codigo} is already in use (empresa ${String(porCodigo.id)}). Codes are never reused, even after deactivation.`,
    );
  }
  const porRnc = await db.empresa.findUnique({ where: { rnc: args.rnc }, select: { id: true } });
  if (porRnc !== null) {
    throw new ProvisionRefusedError(`RNC ${args.rnc} is already registered (empresa ${String(porRnc.id)}).`);
  }
  const usuario = await db.usuario.findFirst({
    where: { nombreUsuario: args.adminNombreUsuario },
    select: { id: true },
  });
  if (usuario !== null) {
    throw new ProvisionRefusedError(`USUARIO ${args.adminNombreUsuario} already exists.`);
  }
  const correo = correoAuthDeNombreUsuario(args.adminNombreUsuario);
  const auth = await db.$queryRaw<Array<{ id: string }>>`
    select id from auth.users
     where lower(email) = ${correo} and is_sso_user = false and deleted_at is null
     limit 1`;
  if (auth.length > 0) {
    throw new ProvisionRefusedError(
      `Supabase Auth already holds ${correo}; refusing to touch an existing Auth user.`,
    );
  }
}

/** Creates everything inside ONE transaction; any failure rolls the whole company back. */
export async function provisionarEmpresa(
  db: PrismaClient,
  args: ArgsProvision,
  rangos: readonly RangoNcfProvision[],
  contrasenaPlano: string,
): Promise<ProvisionConteo> {
  return db.$transaction(
    async (tx: PrismaTx): Promise<ProvisionConteo> => {
      await tx.$executeRaw`select set_config('app.is_bootstrap', 'true', true)`;
      await verificarDisponibilidad(tx, args);
      const esquemaPgcrypto = await obtenerEsquemaPgcryptoEnTx(tx);

      await asegurarRolesBase(tx);
      const rolAdmin = await rolAdministradorId(tx);

      const empresa = await tx.empresa.create({
        data: {
          codigo: args.codigo,
          nombreComercial: args.nombreComercial,
          rnc: args.rnc,
          razonSocial: args.nombreComercial,
          // Not collected by this procedure: the owner completes them afterwards.
          direccionFiscal: "",
          telefono: "",
          correo: "",
          logo: "",
          regimenFiscal: EMPRESA_DEMO.regimenFiscal,
          facturaAutomatica: EMPRESA_DEMO.facturaAutomatica,
          activa: true,
        },
      });
      // `INSERT ... RETURNING` also needs the SELECT policy, and several tables (for
      // example CONFIGURACION_EMPRESA) only let the CURRENT tenant read its rows (bootstrap
      // mode is not enough). Scope the rest of this transaction to the new company, as a
      // non-superuser privileged role (the production `postgres`) requires.
      await tx.$executeRaw`select set_config('app.current_empresa_id', ${String(empresa.id)}, true)`;
      const sucursal = await tx.sucursal.create({
        data: { empresaId: empresa.id, nombre: args.sucursal, direccion: "", telefono: "" },
      });

      const config = configuracionInicial();
      for (const fila of config) {
        await tx.configuracionEmpresa.create({
          data: {
            empresaId: empresa.id,
            clave: fila.clave,
            valor: fila.valor,
            vigenciaInicio: fila.inicio,
            vigenciaFin: fila.fin,
            activa: true,
          },
        });
      }

      for (const r of rangos) {
        await tx.ncfSecuencia.create({
          data: {
            empresaId: empresa.id,
            tipoNcf: r.tipoNcf,
            rangoInicio: BigInt(r.rangoInicio),
            rangoFin: BigInt(r.rangoFin),
            // Last-used semantics (D7): nothing consumed yet.
            secuenciaActual: BigInt(r.rangoInicio - 1),
            vigenciaInicio: r.vigenciaInicio,
            vigenciaFin: r.vigenciaFin,
            activa: true,
          },
        });
      }

      await getOrCreateConsumidorFinalEnTx(tx, empresa.id);

      const usuario = await tx.usuario.create({
        data: {
          empresaId: empresa.id,
          sucursalId: sucursal.id,
          nombre: `Administrador ${args.codigo}`,
          nombreUsuario: args.adminNombreUsuario,
          // Dead random placeholder: the real credential lives only in Supabase Auth.
          passwordHash: await hashMuertoAleatorioEnTx(tx, esquemaPgcrypto),
          roles: { create: { rolId: rolAdmin.id } },
        },
      });

      const authCreado = await asegurarAuthUserAdmin(tx, contrasenaPlano, esquemaPgcrypto, args.adminNombreUsuario);
      if (!authCreado) {
        throw new ProvisionRefusedError(`Supabase Auth user for ${args.adminNombreUsuario} was not created.`);
      }

      await tx.movimientoAuditoria.create({
        data: {
          empresaId: empresa.id,
          sucursalId: sucursal.id,
          usuarioId: usuario.id,
          fechaHora: new Date(),
          accion: "CREAR",
          entidad: "EMPRESA",
          idEntidad: String(empresa.id),
          valorNuevo: `codigo=${args.codigo} rnc=${args.rnc} admin=${args.adminNombreUsuario}`,
          motivo: "provision-empresa.ts (operator procedure)",
        },
      });

      return {
        empresaId: empresa.id,
        sucursalId: sucursal.id,
        usuarioId: usuario.id,
        clavesConfiguracion: config.length,
        secuenciasNcf: rangos.length,
      };
    },
    { maxWait: 10_000, timeout: 60_000 },
  );
}

function leerRangos(ruta: string): readonly RangoNcfProvision[] {
  let texto: string;
  try {
    texto = fs.readFileSync(ruta, "utf8");
  } catch {
    throw new ProvisionRefusedError(`Cannot read the NCF file "${ruta}".`);
  }
  let json: unknown;
  try {
    json = JSON.parse(texto.replace(/^﻿/, ""));
  } catch {
    throw new ProvisionRefusedError(`The NCF file "${ruta}" is not valid JSON.`);
  }
  const r = validarRangosNcf(json);
  if (!r.ok) throw new ProvisionRefusedError(`Invalid NCF file:\n  - ${r.errors.join("\n  - ")}`);
  return r.rangos;
}

function urlConexion(): string | undefined {
  const url = process.env["PROD_PRIVILEGED_URL"] ?? process.env["DIRECT_URL"] ?? process.env["DATABASE_URL"];
  return url !== undefined && /^postgresql?:\/\//.test(url) ? url : undefined;
}

async function main(): Promise<void> {
  const parsed = validarArgsProvision(process.argv.slice(2), process.env["ADMIN_PASSWORD"]);
  if (!parsed.ok) {
    throw new ProvisionRefusedError(`Invalid arguments:\n  - ${parsed.errors.join("\n  - ")}`);
  }
  const args = parsed.value;
  const rangos = leerRangos(args.rangosArchivo);
  const contrasena = process.env["ADMIN_PASSWORD"] ?? "";

  console.log(
    describirPlanProvision(args, rangos, {
      itbis: TASA_ITBIS_SEED_VALOR,
      claves: configuracionInicial().map((c) => c.clave),
      roles: ROLES_CATALOGO.map((r) => r.nombre),
    }),
  );

  const url = urlConexion();
  if (url === undefined) {
    if (args.apply) {
      throw new ProvisionRefusedError("--apply needs PROD_PRIVILEGED_URL, DIRECT_URL or DATABASE_URL.");
    }
    console.log("\nDRY-RUN: no connection string set, so the already-in-use checks were skipped. Nothing was written.");
    return;
  }

  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  try {
    if (!args.apply) {
      await db.$transaction(async (tx: PrismaTx) => {
        await tx.$executeRaw`select set_config('app.is_bootstrap', 'true', true)`;
        await verificarDisponibilidad(tx, args);
      });
      console.log("\nDRY-RUN: code, RNC and user name are free. Nothing was written. Re-run with --apply to create it.");
      return;
    }
    const c = await provisionarEmpresa(db, args, rangos, contrasena);
    console.log(
      [
        "",
        `OK: empresa ${args.codigo} provisioned (one transaction).`,
        `  EMPRESA        id=${String(c.empresaId)}`,
        `  SUCURSAL       id=${String(c.sucursalId)} ("${args.sucursal}")`,
        `  CONFIGURACION  ${String(c.clavesConfiguracion)} rows`,
        `  NCF_SECUENCIA  ${String(c.secuenciasNcf)} ranges (own, from ${args.rangosArchivo})`,
        `  USUARIO        id=${String(c.usuarioId)} (${args.adminNombreUsuario}, Administrador)`,
        `  auth.users     ${correoAuthDeNombreUsuario(args.adminNombreUsuario)}`,
        "  AUDITORIA      1 row (CREAR EMPRESA)",
        "",
        "Next: log in once as the admin (binds authUserId), then complete the company's fiscal address/phone/email.",
      ].join("\n"),
    );
  } finally {
    await db.$disconnect();
  }
}

if (process.argv[1] !== undefined && /provision-empresa(\.[cm]?[jt]s)?$/.test(process.argv[1])) {
  main().catch((err: unknown) => {
    if (err instanceof ProvisionRefusedError) {
      console.error(`REFUSED: ${err.message}`);
    } else {
      // Never print raw driver/Prisma errors (they can echo bound parameters).
      console.error("FAILED: the transaction was rolled back; nothing was written. Re-run the dry run to see what is in use.");
      if (err instanceof Error) console.error(`  (${err.name})`);
    }
    process.exit(1);
  });
}
