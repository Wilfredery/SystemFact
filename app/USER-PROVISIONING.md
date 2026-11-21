# User provisioning and password resets

How a company and its accounts are created in SystemFact, and how a password is changed. **All of it happens operator-side (script or Supabase). There is no in-app reset, no self-service password change and no in-app company creation** — a deliberate scope decision (2026-11-04, `docs/22` T4; companies: `odd/tasks/multi-company-codigo.md` S2).

Why it is operator-side: this project has no email provider, and Auth emails are **synthetic by design** (ADR-014). Supabase cannot send a reset to a mailbox that does not exist, and adding a service-role key to the app just to reset passwords would put a credential that **bypasses RLS** on the server — the single most dangerous thing that could sit there, given cross-tenant leakage is risk #1.

## The naming rule (multi-company contract C1/C2)

Every company has an immutable, never-reused **code** (`EMPRESA.codigo`): `^[A-Z0-9]{3,6}$`, e.g. `SOL`.

Every username is `<CODIGO>-<resto>`:

- `<CODIGO>` is the company's code, **upper-case**, and must equal the code of the user's `empresaId` (the app validates it and a DB trigger enforces it).
- `<resto>` matches `^[a-z0-9][a-z0-9._-]{0,56}$`: **lower-case**, starts with a letter or digit, then letters, digits, `.`, `_`, `-`.
- Total length is at most **64**. The **first hyphen** is the separator (the code has no hyphen; the rest may).
- Example: `SOL-jperez`, `SOL-ana.garcia`. Not valid: `SOL-JPerez` (upper-case rest), `sol-jperez` as a stored name (the code must be upper-case; login accepts any case and normalizes it), `jperez` (no prefix).
- Names stay globally unique.

**The Supabase Auth email is derived from the FULL canonical name:** `<nombreUsuario>@users.systemfact.internal`, stored **lower-case**: `SOL-jperez` → `sol-jperez@users.systemfact.internal`. Login normalizes what the person typed to the canonical name and builds the email from it; Supabase compares emails case-insensitively. The email is never shown in the UI and is never a credential a person types.

## Creating a company (the only way): `provision-empresa.ts`

Companies are created **only** by this script, never from the app (the Empresas tab is read-only). In ONE transaction it creates: the company and its code, its first branch, the roles, the tax settings (ITBIS, retentions), the company's **own** NCF ranges (never copied from another company), the per-company Consumidor Final client, the first administrator (`USUARIO` + its Supabase Auth user + identity) and one audit row.

### 1. Write the NCF ranges file

A JSON array, one entry per type (`B01`, `B02`, `B03`, `B04`, `B11`), **every field mandatory, nothing defaulted** — the ranges are the company's own DGII authorization:

```json
[
  { "tipoNcf": "B01", "rangoInicio": 1, "rangoFin": 500, "vigenciaInicio": "2027-01-01", "vigenciaFin": "2027-12-31" },
  { "tipoNcf": "B02", "rangoInicio": 1, "rangoFin": 1000, "vigenciaInicio": "2027-01-01", "vigenciaFin": "2027-12-31" }
]
```

Rules: integers, `1 <= rangoInicio <= rangoFin <= 99999999`; ISO dates with `vigenciaFin` after `vigenciaInicio`; one range per type (a duplicate type is refused). Keep the file outside the repository.

### 2. Dry run (default: writes nothing)

From `app/`, with a privileged connection string in `PROD_PRIVILEGED_URL`, else `DIRECT_URL`, else `DATABASE_URL` (the script writes `auth.users`, which the app role cannot reach):

```bash
ADMIN_PASSWORD='<12+ characters you generate>' pnpm exec tsx tools/scripts/provision-empresa.ts \
  --codigo SOL --nombre-comercial "Sol Distribuciones" --rnc 131000002 \
  --sucursal "Matriz" --admin-usuario jperez --ncf-file ./ncf-sol.json
```

- `--admin-usuario` is only the part **after** the prefix (`jperez`); the script builds `SOL-jperez` and validates it through the same function the app uses (`validarNombreUsuarioNuevo`). Passing `SOL-jperez` is refused.
- The **password is never an argument** (`--password` and similar are refused). It is read only from the env var `ADMIN_PASSWORD`, at least 12 characters (the Auth policy rejects shorter ones at sign-in, not at creation). It is never printed.
- The code is case-insensitive on input and stored upper-case. The RNC must pass the DGII mod-11 check.
- The dry run prints exactly what would be created, including the Auth email derived from the full name, and (when a connection string is available) runs the "already in use" checks read-only. **Read it before applying.**

### 3. Apply

Repeat the same command with `--apply`. It refuses, writing nothing, when the code was ever used (codes are never reused, not even by deactivated companies), the RNC is registered, or the user name / Auth email already exists. A second `--apply` with the same code therefore fails cleanly instead of duplicating anything.

### 4. Verify before you hand it over

1. Log in once as `SOL-jperez` from the app.
2. Confirm the bind happened: `select "authUserId" from "USUARIO" where "nombreUsuario" = 'SOL-jperez';` must now be a UUID, not NULL.
3. Log out. Only now give the credentials to the administrator.

Deactivating a company later uses the tenant kill switch (`EMPRESA.activa = false`); the code stays reserved.

## Creating an extra user in an existing company

Creating the row in `USUARIO` alone **does not create a login**. The credential lives in Supabase Auth; `USUARIO.passwordHash` is vestigial (nothing reads it). Both steps are required, in this order.

### Step 1 — Supabase Auth (the credential)

Dashboard → **Authentication → Users → Add user**:

- **Email:** the **lower-case** full canonical name + `@users.systemfact.internal`, e.g. `sol-ana.garcia@users.systemfact.internal` for `SOL-ana.garcia`.
- **Password:** 12 characters minimum (rejected at sign-in, not at creation, if shorter).
- **Auto-confirm the user.** There is no real mailbox.

### Step 2 — the `USUARIO` row (the business identity)

Insert the row with `nombreUsuario` = the canonical name (`SOL-ana.garcia`, prefix = that company's code), `empresaId`, `sucursalId`, and its roles in `UsuarioRol`. A name whose prefix is not the code of its `empresaId` is rejected by the database trigger.

**Leave `authUserId` NULL.** The app binds it on the first successful login (`enlazarAuthSub`); that lazy binding is the only thing the per-request identity path trusts afterwards.

### Step 3 — verify before you hand it over

Same as *Verify* above (log in once, check `authUserId` is a UUID, log out).

If a user reports "Credenciales inválidas" right after provisioning, the cause is almost always step 1 vs step 2 disagreeing on the name (the email must be the lower-case form of the stored name).

## Renaming a legacy user (no prefix) to `<CODIGO>-<usuario>`

Users created before the rule (for example `admin`, `prod-smoke`, `demo-operador`) keep working until renamed; rename them together with their Auth identity.

> **WARNING — lock-out.** Renaming a `USUARIO` **without updating its Supabase Auth email (and identity) in the SAME step locks that user out.** Login builds the Auth email from the stored name; if the two disagree, the sign-in fails like a wrong password and nothing in the app explains why. Always change both in one transaction, and update the GitHub/CI secret that holds the name (`PROD_USER`, `DEMO_USER`, e2e fixtures) in the same rollout.

Do it as the privileged owner role, in ONE transaction, and **show the SQL to the owner before running it**. Template (replace `<EMPRESA_CODE>`, `<old>`, `<new>`; `<new>` is the full canonical name):

```sql
begin;
select set_config('app.is_bootstrap', 'true', true);  -- the login-flow guard freezes nombreUsuario otherwise

-- 1) The business identity. The prefix trigger checks it against the company code.
update "USUARIO" set "nombreUsuario" = '<EMPRESA_CODE>-<new>', "updatedAt" = now()
 where "nombreUsuario" = '<old>';                       -- must update exactly 1 row

-- 2) The Auth user, lower-case email from the FULL canonical name.
update auth.users set email = lower('<EMPRESA_CODE>-<new>') || '@users.systemfact.internal', updated_at = now()
 where lower(email) = lower('<old>') || '@users.systemfact.internal';   -- exactly 1 row

-- 3) Its email identity.
update auth.identities
   set identity_data = jsonb_set(identity_data, '{email}', to_jsonb(lower('<EMPRESA_CODE>-<new>') || '@users.systemfact.internal')),
       updated_at = now()
 where user_id = (select id from auth.users where lower(email) = lower('<EMPRESA_CODE>-<new>') || '@users.systemfact.internal');
commit;
```

Check each `UPDATE` reported exactly one row before the `commit`; otherwise `rollback`. Afterwards log in once as the new name. The password does not change, and `authUserId` stays bound (the `sub` is unchanged). Alternatively recreate the user from scratch with the steps above (then see the `AUTH_ENLACE_CONFLICTO` row below if the old Auth user was deleted).

## Demo user for the production demo lane

Only needed for the **production demo lane** (`.github/workflows/prod-demo.yml`, `odd/tasks/prod-demo-lane.md`), which writes demo sales, a cobro and a return into the demo company (id 5, code `DEMO`, "SistemaFact Demo") and nowhere else. This is **not** the smoke identity: the smoke (`prod-smoke` environment) never writes; the demo lane has its own user, environment and secrets. Everything below is an owner step (S9): the agent never holds its password.

**Role: `Operador`, and nothing else** (matrix with code evidence in `odd/tasks/prod-demo-lane.md`, "Role matrix (T1)"). Do not give it `Administrador`.

1. **Supabase Auth.** Create the Auth user `demo-demo-operador@users.systemfact.internal` — the lower-case form of the canonical name `DEMO-demo-operador` — with a 12+ character password that **you** generate, auto-confirmed.
2. **Database rows.** Run this in the SQL editor, replacing the placeholders. It contains no password: `authUserId` stays NULL on purpose.

   ```sql
   -- 1) The company name the UI shows (copy it EXACTLY into DEMO_EMPRESA_NAME, step 5).
   select id, codigo, "nombreComercial" from "EMPRESA" where id = <EMPRESA_ID>;

   -- 2) The business identity, bound to company <EMPRESA_ID> and ONE of its branches.
   --    <NOMBRE_USUARIO> = '<CODIGO>-<resto>' (here: 'DEMO-demo-operador').
   insert into "USUARIO" ("empresaId", "sucursalId", "nombre", "nombreUsuario", "passwordHash", "activo", "updatedAt")
   values (<EMPRESA_ID>, <SUCURSAL_ID>, '<NOMBRE_VISIBLE>', '<NOMBRE_USUARIO>', 'managed-by-supabase-auth', true, now());

   -- 3) The ONE role.
   insert into "USUARIO_ROL" ("usuarioId", "rolId")
   select u.id, r.id
     from "USUARIO" u, "ROL" r
    where u."nombreUsuario" = '<NOMBRE_USUARIO>' and r."nombre" = 'Operador';
   ```

3. **First login binds `authUserId`.** Log in once as that user, then check `select "authUserId" from "USUARIO" where "nombreUsuario" = '<NOMBRE_USUARIO>';` is a UUID. Check the header shows the demo company name and the branch has at least 2 units of one product in stock.
4. **GitHub environment.** Repository → Settings → Environments → **New environment** named exactly `prod-demo`, restricted to the `master` branch. Secrets `DEMO_USER` (the canonical `nombreUsuario`, e.g. `DEMO-demo-operador`) and `DEMO_PASSWORD`.
5. **Environment variables** (same environment): `DEMO_EMPRESA_NAME` = the `nombreComercial` from query 1, character for character. Optional `DEMO_BASE_URL`.
6. **First run** is a manual dispatch with the confirmation `WRITE-DEMO-DATA`; each run consumes one B01, one B02 and one B04 NCF for good.

**Retire it** before company 5 is ever used for real invoices: delete the `prod-demo` secrets and variables and set `activo = false` on the user (master entities are never deleted).

## Changing a password

Dashboard → **Authentication → Users** → the user → **update password**.

1. **You choose the new password; never set one the requester dictates.**
2. **Verify identity out-of-band** before you reset: call a number you already have, not the channel that asked.
3. Hand it over through a channel the user controls and tell them to store it in a password manager. There is no forced change on first login.
4. Any account still holding a password shorter than 12 **cannot log in at all** — the failing sign-in returns the actionable "actualizala" message. Those accounts need this reset.

## Traps that produce accounts that exist and cannot log in

| Symptom | Cause | Fix |
|---|---|---|
| `AUTH_ENLACE_CONFLICTO` on login | The Auth user was **deleted and recreated** with the same synthetic email. The `USUARIO` row still points at the old `sub`, and the app refuses rather than overwriting the link. | Prefer **updating** the existing Auth user over deleting it. If it already happened, decide explicitly: `update "USUARIO" set "authUserId" = null where "nombreUsuario" = '<user>';` and let the next login re-bind. |
| "Credenciales inválidas" right after provisioning or **after a rename** | The Auth email does not match the stored name (renamed `USUARIO` without updating the Auth email/identity, or a wrong prefix/case). | Make the Auth email the lower-case form of the stored canonical name (see *Renaming a legacy user*). |
| Login returns the "política de seguridad" message | The stored password is shorter than the current 12-character policy. | Reset it (dashboard → update password). |
| User exists in `USUARIO` but no login is possible | There is no Auth user. | Create it. The row alone has never been a credential. |
| The database rejects the `USUARIO` insert/update | The name's prefix is not the code of its `empresaId`, or the rest breaks the C2 format. | Use `<CODIGO>-<resto>` exactly as above. |

## When this stops being good enough

Operator-mediated passwords are right for a handful of accounts and an owner who is available. Revisit this the first time any of these is true:

- a real tenant is onboarded (the owner then holds every employee's password, and every reset request becomes a social-engineering target);
- the owner is unavailable when someone is blocked from working;
- account count makes resets a routine chore.

The options at that point are recorded in `docs/22` T4: an in-app admin reset behind a narrowly scoped service-role module, or email-based self-service once real addresses and a sending domain exist.
