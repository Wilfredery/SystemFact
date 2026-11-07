# User provisioning and password resets

How an account is created in SystemFact, and how a password is changed. **All of it happens in Supabase, by the operator. There is no in-app reset and no self-service password change** — that is a deliberate scope decision (2026-11-04), recorded in `docs/22` T4, not an oversight.

Why it is operator-side: this project has no email provider, and Auth emails are **synthetic by design** (ADR-014: `<nombreUsuario>@users.systemfact.internal`). Supabase cannot send a reset to a mailbox that does not exist, and adding a service-role key to the app just to reset passwords would put a credential that **bypasses RLS** on the server — the single most dangerous thing that could sit there, given cross-tenant leakage is risk #1.

## Creating a user

Creating the row in `USUARIO` alone **does not create a login**. The credential lives in Supabase Auth, and `USUARIO.passwordHash` is vestigial (nothing in the app reads it). Both steps are required, in this order.

### Step 1 — Supabase Auth (the credential)

Dashboard → **Authentication → Users → Add user**:

- **Email:** `<nombreUsuario>@users.systemfact.internal`, **exactly** as the username will be stored. The encoder is a plain concatenation with no case folding: `Ana` becomes `Ana@users.systemfact.internal`, *not* `ana@…`. A case mismatch produces an account that cannot log in and looks like a wrong password.
- **Password:** 12 characters minimum. The project's Auth policy rejects anything shorter, and it rejects it at sign-in, not at creation time — so a short password here creates an account that fails later.
- **Auto-confirm the user.** There is no real mailbox, so a user waiting for a confirmation email waits forever.

### Step 2 — the `USUARIO` row (the business identity)

Insert the row with `nombreUsuario` (identical to the email prefix from step 1), `empresaId`, `sucursalId`, and its roles in `UsuarioRol`. Make sure it passes RLS or is written as the owner.

**Leave `authUserId` NULL.** The app binds it on the first successful login (`enlazarAuthSub`), and that lazy binding is the only thing the per-request identity path trusts afterwards.

### Step 3 — verify before you hand it over

1. Log in once as that user from the app.
2. Confirm the bind happened: `select "authUserId" from "USUARIO" where "nombreUsuario" = '<user>';` must now be a UUID, not NULL.
3. Log out. Only now give the credentials to the user.

If a user reports "Credenciales inválidas" right after provisioning, the cause is almost always step 1 vs step 2 disagreeing on the username's **case**.

## Demo user for the production demo lane

Only needed for the **production demo lane** (`.github/workflows/prod-demo.yml`, `odd/tasks/prod-demo-lane.md`), which writes demo sales, a cobro and a return into the demo company (id 5, "SistemaFact Demo") and nowhere else. This is **not** the smoke identity: the smoke (`prod-smoke` environment) never writes; the demo lane has its own user, its own environment and its own secrets. Everything below is an owner step (S9): the agent never creates this user and never holds its password.

**Role: `Operador`, and nothing else.** It is the smallest role that can run every flow (sale, credit sale, cobro, return); the matrix with code evidence is in `odd/tasks/prod-demo-lane.md` ("Role matrix (T1)"). Do not give it `Administrador`.

1. **Supabase Auth.** Follow *Step 1* above: create the Auth user `<nombreUsuario>@users.systemfact.internal` (exact case), password of at least 12 characters that **you** generate, auto-confirmed. Choose a `nombreUsuario` that is clearly the demo one (for example `demo.operador`).
2. **Database rows.** Run this in the SQL editor, replacing the three placeholders. It contains no password: `passwordHash` is vestigial (nothing reads it) and the real credential lives only in Supabase Auth. `authUserId` stays NULL on purpose.

   ```sql
   -- 1) The company name the UI shows (copy it EXACTLY into DEMO_EMPRESA_NAME, step 5).
   select id, "nombreComercial" from "EMPRESA" where id = <EMPRESA_ID>;

   -- 2) The business identity, bound to company <EMPRESA_ID> and ONE of its branches.
   insert into "USUARIO" ("empresaId", "sucursalId", "nombre", "nombreUsuario", "passwordHash", "activo", "updatedAt")
   values (<EMPRESA_ID>, <SUCURSAL_ID>, '<NOMBRE_VISIBLE>', '<NOMBRE_USUARIO>', 'managed-by-supabase-auth', true, now());

   -- 3) The ONE role.
   insert into "USUARIO_ROL" ("usuarioId", "rolId")
   select u.id, r.id
     from "USUARIO" u, "ROL" r
    where u."nombreUsuario" = '<NOMBRE_USUARIO>' and r."nombre" = 'Operador';
   ```

3. **First login binds `authUserId`.** Log in once from the app as that user, then check `select "authUserId" from "USUARIO" where "nombreUsuario" = '<NOMBRE_USUARIO>';` is a UUID (*Step 3* above). Check that the header shows the demo company name, and that the branch has at least 2 units of one product in stock (the lane fails with a clear message otherwise).
4. **GitHub environment.** Repository → Settings → Environments → **New environment** named exactly `prod-demo`. Add the secrets `DEMO_USER` (the `nombreUsuario`) and `DEMO_PASSWORD` (the Auth password).
5. **Environment variables** (same environment): `DEMO_EMPRESA_NAME` = the `nombreComercial` from query 1, character for character; the lane aborts before any write when the UI shows a different name. Optional: `DEMO_BASE_URL` (default `https://systemfact.vercel.app`).
6. **First run** is a manual dispatch with the confirmation `WRITE-DEMO-DATA`; each run consumes one B01, one B02 and one B04 NCF for good (see the lane doc).

**Retire it** before company 5 is ever used for real invoices: delete the `prod-demo` environment secrets and variables, and deactivate the user (`update "USUARIO" set activo = false where "nombreUsuario" = '<NOMBRE_USUARIO>';`). Master entities are never deleted, so the row stays with `activo = false`.

## Changing a password

Dashboard → **Authentication → Users** → the user → **update password**.

Rules that keep this from becoming the weak link:

1. **You choose the new password; never set one the requester dictates.** Taking a password from a phone call or a chat message turns an identity check into an honour system.
2. **Verify identity out-of-band** before you reset: call the number you already have, do not use the channel that asked. "Hi, I'm Ana, I forgot my password" is the cheapest attack this system has, and it targets you, not the code.
3. Hand it over through a channel the user controls, and tell them to store it in a password manager. There is no forced change on first login, so this password becomes their password.
4. Any account still holding a password shorter than 12 **cannot log in at all** — the failing sign-in returns the actionable "actualizala" message rather than "credenciales inválidas". Those accounts need this reset to become usable again.

## Traps that produce accounts that exist and cannot log in

| Symptom | Cause | Fix |
|---|---|---|
| `AUTH_ENLACE_CONFLICTO` on login | The Auth user was **deleted and recreated** with the same synthetic email. The `USUARIO` row still points at the old `sub`, and the app refuses rather than overwriting the link (deliberately: only an admin may decide). | Prefer **updating** the existing Auth user over deleting it. If it already happened, decide explicitly: `update "USUARIO" set "authUserId" = null where "nombreUsuario" = '<user>';` and let the next login re-bind. |
| "Credenciales inválidas" immediately after provisioning | Username case differs between the Auth email and `nombreUsuario`. | Fix whichever side is wrong; the two must match byte for byte. |
| Login returns the "política de seguridad" message | The stored password is shorter than the current 12-character policy. | Reset it here (dashboard → update password). |
| User exists in `USUARIO` but no login is possible | Step 1 was skipped — there is no Auth user. | Create it. The row alone has never been a credential. |

## When this stops being good enough

Operator-mediated passwords are right for a handful of accounts and an owner who is available. Revisit this the first time any of these is true:

- a real tenant is onboarded (the owner then holds every employee's password, and every reset request becomes a social-engineering target);
- the owner is unavailable when someone is blocked from working;
- account count makes resets a routine chore.

The options at that point are recorded in `docs/22` T4: an in-app admin reset behind a narrowly scoped service-role module, or email-based self-service once real addresses and a sending domain exist.
