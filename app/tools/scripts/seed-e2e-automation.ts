/**
 * seed-e2e-automation — dedicated automation E2E principal (owner-ratified 2026-10-13).
 *
 * PURPOSE: create a needle-isolated automation admin account (`e2e-automation`),
 * separate from the operator's personal account, so Playwright E2E runs with a
 * dedicated identity (clean audit attribution, trivially revocable).
 *
 * WHAT IT DOES (idempotent, find-or-create; never edits an existing row's
 * binding other than the flagged rotation case):
 *   1. Probes the env connections: which URL carries pgcrypto + which carries
 *      the GoTrue `auth.users` table (Supabase-shaped) vs the plain app DB.
 *   2. Structurally guarantees the demo tenant (RNC-keyed EMPRESA + SUCURSAL
 *      from `seed-cloud-bootstrap.ts` exports — no drift with that seed).
 *   3. Creates the `e2e-automation` USUARIO (rol Administrador binding via
 *      USUARIO_ROL) with a DEAD random bcrypt placeholder in `passwordHash`
 *      (never a replayable credential — same hygiene as the bootstrap seed).
 *   4. Creates the matching Supabase Auth row via `auth.users` + `auth
 *      .identities` + empty GoTrue token columns (the observed prod-shaped
 *      semantics from seed-cloud-bootstrap — NULL tokens 500 the password
 *      grant on scan), using `buildSyntheticEmail("e2e-automation")` (ADR-014:
 *      email is NEVER an identifier in the app).
 *   5. Generates a random password (crypto-random base64url, 40 chars) and
 *      writes ONLY `app/.env.e2e.local` (gitignored): E2E_USER=/E2E_PASSWORD=
 *      no-BOM. The password is NEVER printed, echoed, logged, committed.
 *
 * AUTH SCHEMA LOCATION (probe-driven):
 *   - If the probed connection already carries `auth.users` (Supabase-shaped
 *     DB), the Auth row lands there directly.
 *   - If not, the script checks the OTHER env connection (DIRECT_URL first,
 *     then DATABASE_URL). When NEITHER has `auth.users`, it aborts with the
 *     operator note: set E2E_AUTH_DB_URL to a Supabase-shaped connection and
 *     re-run.
 *
 * ROTATION: re-run with `--rotate` to mint a NEW random password and update
 * the auth row's `encrypted_password` in place (USUARIO.passwordHash stays
 * dead random; rotation cannot be observed from the app tables).
 *
 * RUN VIA: `pnpm seed:e2e-automation` (tsx tools/scripts/seed-e2e-automation.ts)
 * ENV: DIRECT_URL / DATABASE_URL (dotenv loads app/.env automatically);
 *      optional E2E_AUTH_DB_URL override; optional --rotate.
 */

import "dotenv/config";
import { randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Prisma, PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  EMPRESA_DEMO,
  ROLES_CATALOGO,
  SUCURSAL_DEMO,
} from "./seed-cloud-bootstrap";
import { buildSyntheticEmail } from "@/modules/auth/domain/synthetic-email";

const E2E_USUARIO = "e2e-automation";
const E2E_NOMBRE = "E2E Automation Operator (robot account)";
const ENV_FILE = path.resolve(process.cwd(), ".env.e2e.local");
// Rotation policy (revised 2026-10-14): the script ALWAYS re-rotates the Auth
// password on re-run (find-or-create collision) and rewrites
// app/.env.e2e.local to match, so the file is always the current credential.
// Structural rows are never modified.

type Creds = { ok: boolean; urlLabel: string; pgcrypto: string | null; authSchema: boolean; hasAppSchema: boolean; dbName: string };

function candidates(): string[] {
  const list = [
    process.env["E2E_AUTH_DB_URL"],
    process.env["DIRECT_URL"],
    process.env["DATABASE_URL"],
  ].filter((v): v is string => typeof v === "string" && /^postgresql?:\/\//.test(v));
  if (list.length === 0) {
    throw new Error(
      "seed-e2e-automation: no usable connection — set E2E_AUTH_DB_URL or have DIRECT_URL/DATABASE_URL in app/.env (dotenv-loaded).",
    );
  }
  return list;
}

async function probe(db: PrismaClient, label: string): Promise<Creds> {
  const [pgcryptoRow, dbRow] = await Promise.all([
    db.$queryRaw<Array<{ schema: string }>>`
      select extnamespace::regnamespace::text as schema
        from pg_extension
       where extname = 'pgcrypto'`,
    db.$queryRaw<Array<{ dbName: string }>>`select current_database() as "dbName"`,
  ]);
  let authSchema = false;
  try {
    const res = await db.$queryRaw<Array<{ one: number }>>`select 1 as one from auth.users limit 1`;
    authSchema = res.length >= 0;
  } catch {
    authSchema = false;
  }
  const appRes = await db.$queryRaw<Array<{ one: number }>>`
    select 1 as one
      from pg_tables
     where schemaname = 'public'
       and tablename = 'USUARIO'
     limit 1`;
  return {
    ok: true,
    urlLabel: label,
    pgcrypto: pgcryptoRow[0]?.schema ?? null,
    authSchema,
    hasAppSchema: appRes.length > 0,
    dbName: dbRow[0]?.dbName ?? "?",
  };
}

/** GoTrue-shaped auth row insert (mirror of seed-cloud-bootstrap's auth path). */
async function asegurarAuthE2E(
  db: PrismaClient,
  sencilla: string,
  pgcryptoSchema: string,
): Promise<{ creado: boolean; correo: string }> {
  const correo = buildSyntheticEmail(E2E_USUARIO);
  const existentes = await db.$queryRaw<Array<{ id: string }>>`
    select id from auth.users
     where lower(email) = ${correo}
       and is_sso_user = false
       and deleted_at is null
     limit 1`;
  if (existentes.length > 0) {
    // ALWAYS refresh the auth password on re-run: the previous run's random
    // password may never have reached app/.env.e2e.local (a later step may
    // have crashed mid-sequence), so the only deterministic guarantee is
    // "credential file matches the auth row for THIS run's password".
    const filas = await db.$queryRaw<Array<{ hash: string }>>`
      select ${Prisma.raw(`"${pgcryptoSchema}".`)}crypt(${sencilla},
             ${Prisma.raw(`"${pgcryptoSchema}".`)}gen_salt('bf', 10)) as hash`;
    await db.$executeRaw`
      update auth.users set encrypted_password = ${filas[0]!.hash}
       where lower(email) = ${correo}`;
    // Recovery path for a partial prior run (auth row inserted but the
    // identity/token steps crashed): identity lookup is per-user_id, the
    // insert is guarded, and the blanking is unconditional when the tokens
    // are still NULL (idempotent on a fully provisioned row).
    await db.$executeRaw`
      insert into auth.identities
        (user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
      select u.id, u.email, 'email',
             jsonb_build_object('sub', u.id::text, 'email', u.email),
             u.created_at, u.created_at, u.created_at
        from auth.users u
         where lower(u.email) = ${correo}
           and not exists (
             select 1 from auth.identities i
              where i.user_id = u.id and i.provider_id = u.email)`;
    await db.$executeRaw`
      update auth.users
         set confirmation_token = '', recovery_token = '',
             email_change_token_new = '', email_change_token_current = '',
             reauthentication_token = '', phone_change_token = '',
             email_change = '',
             instance_id = '00000000-0000-0000-0000-000000000000'
       where lower(email) = ${correo} and confirmation_token is not distinct from null`;
    return { creado: false, correo };
  }
  const filas = await db.$queryRaw<Array<{ hash: string }>>`
    select ${Prisma.raw(`"${pgcryptoSchema}".`)}crypt(${sencilla},
           ${Prisma.raw(`"${pgcryptoSchema}".`)}gen_salt('bf', 10)) as hash`;
  const instante = new Date();
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
       'authenticated', 'authenticated', ${correo}, ${filas[0]!.hash},
       ${instante},
       '{"provider":"email"}'::jsonb, '{}'::jsonb,
       false, false, false,
       ${instante}, ${instante})`;
  await db.$executeRaw`
    insert into auth.identities
      (user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
    select u.id, u.email, 'email',
           jsonb_build_object('sub', u.id::text, 'email', u.email),
           u.created_at, u.created_at, u.created_at
      from auth.users u
     where lower(u.email) = ${correo}
       and not exists (
         select 1 from auth.identities i
          where i.user_id = u.id and i.provider_id = u.email)`;
  // GoTrue's string-token scan 500s on NULL tokens (observed prod behavioral
  // note); the working rows carry '' for every token column.
  await db.$executeRaw`
    update auth.users
       set confirmation_token = '', recovery_token = '',
           email_change_token_new = '', email_change_token_current = '',
           reauthentication_token = '', phone_change_token = '',
           email_change = '',
           instance_id = '00000000-0000-0000-0000-000000000000'
     where lower(email) = ${correo}`;
  return { creado: true, correo };
}

/** Dead random bcrypt for USUARIO.passwordHash — NOT a replayable credential. */
async function hashMuerto(db: PrismaClient, pgcryptoSchema: string): Promise<string> {
  const filas = await db.$queryRaw<Array<{ hash: string }>>`
    select ${Prisma.raw(`"${pgcryptoSchema}".`)}crypt(
             encode(${Prisma.raw(`"${pgcryptoSchema}".`)}gen_random_bytes(24), 'hex'),
             ${Prisma.raw(`"${pgcryptoSchema}".`)}gen_salt('bf', 10)) as hash`;
  return filas[0]!.hash;
}

async function main(): Promise<void> {
  // Runtime diagnostics: every step announces itself FIRST so a crash names
  // the exact failing statement (42601-class bugs are debugged by evidence).
  const step = (label: string): string => label;
  const probed: { url: string; cred: Creds }[] = [];
  for (const [i, url] of candidates().entries()) {
    const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    try {
      const cred = await probe(db, i === 0 ? "primary" : "fallback");
      probed.push({ url, cred });
    } finally {
      await db.$disconnect();
    }
  }
  for (const p of probed) {
    console.log(
      `probe ${p.cred.urlLabel}: db=${p.cred.dbName} pgcrypto=${p.cred.pgcrypto ?? "none"} authSchema=${String(p.cred.authSchema)} appSchema=${String(p.cred.hasAppSchema)}`,
    );
  }

  // E2E_SKIP_AUTH=1 → structural/data-only mode: seed the app schema (PUBLIC
  // "USUARIO") side on the first candidate carrying it, WITHOUT auth writes
  // (used to mirror the structural rows into a LOCAL dev DB whose app the
  // REMOTE Supabase auth resolves at login via `enlazarAuthSub`).
  const skipAuth = process.env["E2E_SKIP_AUTH"] === "1";

  const authTarget = probed.find((p) => p.cred.authSchema && p.cred.pgcrypto !== null);
  if (authTarget === undefined && !skipAuth) {
    throw new Error(
      "seed-e2e-automation: no probed connection carries auth.users+pgcrypto — set E2E_AUTH_DB_URL to a Supabase-shaped connection and re-run.",
    );
  }
  const dataTarget =
    skipAuth === true
      ? probed.find((p) => p.cred.hasAppSchema)
      : authTarget;
  if (dataTarget === undefined) {
    throw new Error(
      "seed-e2e-automation: no probed connection carries the app schema (public.USUARIO).",
    );
  }
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: dataTarget.url }) });
  const password = randomBytes(30).toString("base64url"); // 40 chars, URL-safe
  try {
    // Structural tenant (RNC-keyed) — identical shapes to seed-cloud-bootstrap.
    console.log(step("step: empresa find-or-create"));
    let empresa = await db.empresa.findUnique({ where: { rnc: EMPRESA_DEMO.rnc } });
    if (empresa === null) empresa = await db.empresa.create({ data: { ...EMPRESA_DEMO } });
    console.log(step("step: sucursal find-or-create"));
    let sucursal = await db.sucursal.findFirst({
      where: { empresaId: empresa.id, nombre: SUCURSAL_DEMO.nombre },
    });
    if (sucursal === null) {
      sucursal = await db.sucursal.create({ data: { ...SUCURSAL_DEMO, empresaId: empresa.id } });
    }
    console.log(step("step: rol Administrador find-or-create"));
    const rol = await db.rol.findFirst({ where: { nombre: "Administrador" } });
    const rolId =
      rol !== null
        ? rol.id
        : (
            await db.rol.create({
              data: {
                nombre: "Administrador",
                descripcion:
                  ROLES_CATALOGO.find((r) => r.nombre === "Administrador")?.descripcion ?? "",
              },
            })
          ).id;

    console.log(step("step: usuario find-or-create"));
    let usuario = await db.usuario.findFirst({
      where: { nombreUsuario: E2E_USUARIO },
      select: { id: true, empresaId: true },
    });
    if (usuario !== null && usuario.empresaId !== empresa.id) {
      throw new Error(
        `seed-e2e-automation: USUARIO "${E2E_USUARIO}" already exists in a DIFFERENT empresa (${usuario.empresaId}); operator decision needed before any rebind.`,
      );
    }
    if (usuario === null) {
      console.log(step("step: usuario create (dead hash)"));
      const pgc = skipAuth || authTarget === undefined ? null : authTarget.cred.pgcrypto;
      const dead =
        pgc === null
          ? `$2b$10$${randomBytes(31).toString("base64url")}{` // DB-less dead placeholder (bcrypt-shaped, not replayable)
          : await hashMuerto(db, pgc);
      usuario = await db.usuario.create({
        data: {
          empresaId: empresa.id,
          sucursalId: sucursal.id,
          nombre: E2E_NOMBRE,
          nombreUsuario: E2E_USUARIO,
          passwordHash: dead,
          roles: { create: { rolId } },
        },
      });
    }
    console.log(step("step: usuarioRol upsert"));
    await db.usuarioRol.upsert({
      where: { usuarioId_rolId: { usuarioId: usuario.id, rolId } },
      update: {},
      create: { usuarioId: usuario.id, rolId },
    });

    let auth: { creado: boolean; correo: string } | null = null;
    if (!skipAuth && authTarget !== undefined && dataTarget.url === authTarget.url) {
      console.log(step("step: auth.users find/insert + identity + tokens"));
      auth = await asegurarAuthE2E(db, password, authTarget.cred.pgcrypto!);
    } else if (!skipAuth && authTarget !== undefined && dataTarget.url !== authTarget.url) {
      console.log(step("step: auth.users on SEPARATE auth connection"));
      const authDb = new PrismaClient({ adapter: new PrismaPg({ connectionString: authTarget.url }) });
      try {
        auth = await asegurarAuthE2E(authDb, password, authTarget.cred.pgcrypto!);
      } finally {
        await authDb.$disconnect();
      }
    }
    if (!skipAuth && auth !== null) {
      // Save the credential ONLY to the gitignored local env file (no echo).
      if (auth.creado || !fs.existsSync(ENV_FILE)) {
        const contenido = `E2E_USER=${E2E_USUARIO}\nE2E_PASSWORD=${password}\n`;
        fs.writeFileSync(ENV_FILE, contenido, { encoding: "utf8" });
      }
    }

    console.log(
      [
        "OK: e2e automation principal ready (idempotent re-run safe):",
        `  TARGET     ${skipAuth ? "data-only (E2E_SKIP_AUTH)" : "structural + auth"} on db=${dataTarget.cred.dbName}`,
        `  EMPRESA   id=${String(empresa.id)} ("${EMPRESA_DEMO.nombreComercial}")`,
        `  SUCURSAL  id=${String(sucursal.id)} ("${SUCURSAL_DEMO.nombre}")`,
      ]
        .concat(
          skipAuth || auth === null
            ? []
            : [
                `  USUARIO   id=${String(usuario.id)} ("${E2E_USUARIO}", rol Administrador, dead random passwordHash)`,
                `  auth.users ${auth.creado ? "CREATED" : "already existed (untouched)"} (${auth.correo})`,
                `  credential: stored ONLY in ${path.relative(process.cwd(), ENV_FILE)} (gitignored; never printed)`,
              ],
        )
        .concat(skipAuth ? [`  USUARIO   id=${String(usuario.id)} ("${E2E_USUARIO}", rol Administrador, data-side; auth row untouched)`] : [])
        .join("\n"),
    );
  } finally {
    await db.$disconnect();
  }
}

if (
  process.argv[1] !== undefined &&
  process.argv[1].includes("seed-e2e-automation")
) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    if (err instanceof Error && err.stack) {
      // Keep the step chain visible: failures must name their statement.
      console.error(err.stack.split("\n").slice(0, 12).join("\n"));
    }
    process.exit(1);
  });
}
