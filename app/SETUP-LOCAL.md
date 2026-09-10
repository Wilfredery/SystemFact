# Setup Local — SystemFact

Entorno de desarrollo local-first con Postgres 16 en Docker.
Mantiene paridad con Supabase en runtime (mismas RLS policies, mismo rol).

## ¿Por qué local-first?

Supabase es excelente para producción y sync, pero para iterar durante
desarrollo es más lento (latencia de red, costo de conexión, riesgo de
tocar datos reales). Local-first da:

- **Iteración 5-10x más rápida**: sin latencia de red
- **Offline-capable**: podés trabajar sin internet
- **Wipe & reseed trivial**: `docker compose down -v && docker compose up -d`
- **Mismas reglas Postgres**: lo que funciona local funciona en Supabase

## Prerrequisitos

- Docker Desktop (con WSL2 backend en Windows)
- Node.js >= 20.19, pnpm >= 11
- Acceso a Supabase para sync periódico (opcional durante dev)

## Quick start

```bash
# 1. Levantar Postgres local
docker compose up -d

# 2. Esperar a que el healthcheck sea "healthy"
docker inspect --format "{{.State.Health.Status}}" sf-postgres
# → healthy

# 3. Configurar .env (una vez, ver app/.env.example)
#    DATABASE_URL=postgresql://systemfact_app:<password>@localhost:5433/postgres
#    DIRECT_URL=postgresql://postgres:devpass@localhost:5433/postgres

# 4. Aplicar migrations
cd app && pnpm prisma migrate deploy

# 5. Verificar
pnpm test              # 14/14 verde
pnpm probe:set-local   # 4/4 verde (probe empírico contra el container)
npx tsx scripts/diagnose-rls.ts  # control positivo de RLS
```

## Estructura del entorno

| Pieza | Detalle |
|---|---|
| Container | `sf-postgres` (postgres:16) |
| Puerto host | 5433 (no 5432, evita conflicto con Postgres nativo Windows) |
| Volume | `sf-pgdata` (datos persisten entre recreaciones) |
| Restart policy | `unless-stopped` (sobrevive Docker Desktop restarts) |
| Healthcheck | `pg_isready` cada 10s, hasta 5 reintentos |

## Roles y permisos

| Rol | Uso | Password |
|---|---|---|
| `postgres` | Owner. Migrations, ALTER ROLE, DDL admin | `devpass` (solo local — Supabase prod lo maneja el dashboard) |
| `systemfact_app` | App runtime. NOBYPASSRLS, RLS enforced | **Out-of-band** (ver abajo) |

### Password de `systemfact_app` — política out-of-band

El password de `systemfact_app` **NO vive en el repo** (ni en migrations, ni en
`.env.example`, ni en este documento). Razones:
- Defense-in-depth (ADR-019) se rompe si el password es público: cualquiera
  puede conectar con `psql` directo y bypass la app.
- Una vez commiteado, queda en git history aunque se borre del archivo.

**Setup local (cada developer lo hace UNA vez):**

```bash
# 1. Aplicá las migrations (crean el rol SIN password)
cd app && pnpm prisma migrate deploy

# 2. Elegí un password local y setéalo out-of-band
psql -h localhost -p 5433 -U postgres -d postgres \
  -c "ALTER ROLE systemfact_app WITH PASSWORD '<tu-password-local>'"

# 3. Poné el MISMO password en .env (este archivo está en .gitignore)
#    DATABASE_URL=postgresql://systemfact_app:<tu-password-local>@localhost:5433/postgres
```

**Rotación (si venís de una versión vieja con password hardcoded):**

```bash
psql -h localhost -p 5433 -U postgres -d postgres \
  -c "ALTER ROLE systemfact_app WITH PASSWORD '<nuevo>'"
# Luego actualizá DATABASE_URL en .env. NO commitees el nuevo password.
```

**Reglas**:
- `DIRECT_URL` usa `postgres` (puede hacer DDL, ALTER ROLE, CREATE ROLE)
- `DATABASE_URL` usa `systemfact_app` (queries de la app, RLS aplica)
- `env.ts` valida al startup que `DATABASE_URL` NO use un rol superuser —
  si lo hace, la app falla rápido con un error claro
- La migration `20260902150000_create_app_role` crea el rol idempotentemente sin password
- La migration `20260902140000_disable_rls_bypass` quita BYPASSRLS al rol postgres (en Supabase)

## Workflow diario

### Iteración local
```bash
# Cambias schema.prisma → creas migration nueva
cd app
pnpm prisma migrate dev --name <descripcion-cambios>
# Aplica a local y regenera el client
```

### Verificación con control positivo
```bash
npx tsx scripts/diagnose-rls.ts   # INSERT + SELECT sin context = 0
pnpm test                         # unit tests
pnpm probe:set-local              # probe empírico set_config
```

### Sync a Supabase (cuando una faseta está cerrada)
```bash
# 1. En .env, comentar las URLs local y descomentar las de Supabase
# 2. Aplicar migrations nuevas
pnpm prisma migrate deploy

# 3. Verificar en Supabase (UI o psql)
# 4. Volver a local para seguir iterando
```

## Seed de configuración de retención (tenants reales)

La confirmación de compras lee cuatro claves de `ConfiguracionEmpresa`
(`RET_ISR_15`, `RET_ISR_2`, `RET_ITBIS_100`, `RET_ITBIS_30`) y, si falta la clave
aplicable, falla con `CONFIG_RETENCION_FALTANTE`. Hasta la fase 3.4b solo los
fixtures de integración sembraban esas claves, por lo que UN TENANT DE
PRODUCCIÓN NO PODÍA CONFIRMAR NI RECIBIR COMPRAS.

Este seed crea/provisiona esas claves para TODAS las empresas como una fila
activa por clave, con ventana de vigencia amplia. Es **idempotente**: volver a
ejecutarlo actualiza la misma fila (unique `empresaId_clave_vigenciaInicio`) y no
duplica. Las tasas siguen siendo config-driven — el seed NO introduce fallbacks
hardcodeados en dominio/aplicación y NO toca los fixtures de integración.

```bash
# Desde app/, con DIRECT_URL (rol operador/superuser) o DATABASE_URL en .env:
pnpm seed:retencion
# → OK: seeded 4 retention keys for N empresa(s) (idempotent).
```

> Nota de rol: el seed recorre todas las empresas, así que necesita una conexión
> sin contexto de un solo tenant (el rol `systemfact_app` está acotado por RLS).
> En local usa `DIRECT_URL` (`postgres`); en Supabase prod, ejecuta el seed con
> una conexión de servicio/operador que pueda escribir `CONFIGURACION_EMPRESA`
> de todas las empresas.

Sembrar antes de habilitar la recepción de compras en un entorno nuevo.

## Seed de Consumidor Final (tenants reales)

Cada empresa necesita exactamente UN cliente `esConsumidorFinal=true` (sin
identificación fiscal) para las ventas a comprador no identificado (NCF B01/B02).
Hasta la fase 5a ese registro solo lo creaban los fixtures de integración, por lo
que un TENANT DE PRODUCCIÓN no tenía su Consumidor Final.

Este seed crea/provisiona esa fila para TODAS las empresas vía el seam idempotente
`getOrCreateConsumidorFinalEnTx` (busca → inserta → captura `P2002` → relee). Es
**idempotente**: el índice único parcial `cliente_consumidor_final_uk`
(`UNIQUE(empresaId) WHERE esConsumidorFinal`) garantiza exactamente una fila por
empresa aunque se ejecute en paralelo. No toca los fixtures ni introduce lógica
de venta.

```bash
# Desde app/, con DIRECT_URL (rol operador/superuser) o DATABASE_URL en .env:
pnpm seed:cliente
# → OK: ensured Consumidor Final for N empresa(s) (idempotent).
```

> Nota de rol: igual que `seed:retencion`, recorre todas las empresas y necesita
> una conexión sin contexto de un solo tenant (usa `DIRECT_URL` en local).

Ejecutar al habilitar clientes en un entorno nuevo (y tras cualquier alta manual
de empresa anterior a esta fase). El DDL de defaults de crédito
(`limiteCredito` `0.00`, `plazoCreditoDias` `30`) ya quedó aplicado por la
migración `20260909000000_cliente_credit_defaults` al correr `prisma migrate`.

## Seed de configuración de venta (DESC_MAX)

Toda empresa necesita una fila activa `DESC_MAX` en `CONFIGURACION_EMPRESA` para
poder **guardar un borrador de venta con descuento positivo**: el lector
`leerConfigVentaEnTx` es de *fallo duro* (no hay default legal, el tope nunca va
hardcodeado) y devuelve `DESC_MAX_FALTANTE` con cero escrituras si la clave falta
o su ventana de vigencia no cubre la fecha de venta. Un borrador **sin** descuento
no lee esta clave, por lo que funciona sin seed.

Este seed provisiona **exactamente una** fila activa `DESC_MAX` por empresa con el
valor por defecto confirmado por negocio `4.00` (porcentaje, ajustable en BD sin
desplegar código — R-C3) en una ventana amplia (`2000-01-01 … 2099-12-31`). Es
**idempotente**: replicar la estrategia de `seed:retencion`, degrada a
`activa=false` cualquier otra fila activa de la misma clave y hace *upsert* sobre
la ventana canónica vía la unique compuesta `@@unique([empresaId, clave,
vigenciaInicio])`, de modo que repetir el comando no duplica filas. No toca los
fixtures de integración.

```bash
# Desde app/, con DIRECT_URL (rol operador/superuser) o DATABASE_URL en .env:
pnpm seed:venta
# → OK: seeded DESC_MAX=4.00 for N empresa(s) (idempotent).
```

> Nota de rol: igual que `seed:retencion` y `seed:cliente`, recorre todas las
> empresas y necesita una conexión sin contexto de un solo tenant (usa
> `DIRECT_URL` en local).

Ejecutar **antes** de habilitar borradores con descuento en un entorno nuevo.

## Seed de secuencias NCF (B01/B02) — confirmación de ventas (fase 5c)

Confirmar una venta (R-V15) consume una secuencia NCF de la empresa: sin rangos,
el confirm falla con `NCF_SEC_INEXISTENTE`. Los rangos NO se crean en el código de
la app (son concesión de la DGII por rango/tipo/empresa — §8/§14); este seed
provisiona rangos **de desarrollo/local** por empresa con la composición canónica
`B<tipo 2d><%08d>` (11 caracteres, R-N2): B01 `00000001–00000100` y B02
`00000101–00000200`, con `secuenciaActual = rangoInicio - 1` (nada consumido).

Es **idempotente** e incapaz de rewind: hace *upsert* sobre la unique compuesta
`@@unique([empresaId, tipoNcf])`, nunca decrementa `secuenciaActual` (un NCF
consumido jamás se devuelve) y falla rápido con un mensaje claro si la empresa ya
tiene rangos **superpuestos** en el mismo tipo (un `NCF` nunca puede ambigüo, la
lectura con lock depende de rangos disjuntos). Validado por unit tests
(`tools/scripts/seed-ncf.test.ts`) e integración (`src/integration/seed-ncf.integration.test.ts`).

```bash
# Desde app/, con DIRECT_URL (rol operador/superuser) o DATABASE_URL en .env:
pnpm seed:ncf
# → OK: seeded NCF ranges (B01 00000001-00000100, B02 00000101-00000200) for N empresa(s).
```

> Nota de rol: igual que `seed:venta`, recorre todas las empresas y necesita una
> conexión sin contexto de un solo tenant (usa `DIRECT_URL` en local).

Ejecutar **antes** de confirmar la primera venta en un entorno nuevo. Los rangos
B01/B02 son la única vía de emisión automática de factura en esta fase; en
producción, los rangos reales se cargan por el mismo seam (el %08d admite hasta
99.999.999 por tipo).

## POS manual smoke checklist (fase 5b + 5c confirm)

Runbook for the interactive screen (`/venta`). The automated coverage is the
jsdom + React Testing Library suites (`src/modules/venta/ui/__tests__/venta-ui.spec.tsx`
y `confirm-ui.spec.tsx`) plus the Playwright smoke (sección siguiente).

Prerequisites (once per fresh local DB):

```bash
cd app
pnpm prisma migrate deploy
pnpm seed:retencion     # retention config (compra parity)
pnpm seed:cliente       # per-empresa Consumidor Final (contado default)
pnpm seed:venta         # DESC_MAX so discounted drafts can be saved
pnpm seed:ncf           # B01/B02 dev ranges so confirmation can consume (5c)
pnpm dev                # Next.js dev server → http://localhost:3000
```

Then log in with a seeded/known `nombreUsuario` + password (ADR-014 — the
access identifier is the username, never the email) and walk:

1. **Open the POS** → go to `/venta`. Redirects to `/login` if the session is
   invalid. Client picker shows **"Consumidor Final (default)"** selected.
2. **Search a product** → type a name/code, click *Search*, confirm the result
   shows its ITBIS rate; click *Add* → a cart line appears.
3. **Live totals** → edit quantity/unit price; the Subtotal, ITBIS, gravado /
   exento and Total update instantly (same domain calculators as the server).
4. **Save draft (empty-cart guard)** → *Save draft* is **disabled** with zero
   lines; after adding a line it enables. Save → success note + the draft
   appears in **"My drafts"**; cart resets.
5. **Client + inline registration** → *New client* → fill name/phone/address →
   *Create and select* → the new client is chosen; a save posts it (the CF
   default posts `clienteId: null`, resolved server-side via the 5a seam).
6. **Admin discount gate** → as **Operador** the discount panel is hidden; as
   **Administrador** it shows. A discount above `DESC_MAX` returns
   `DESCUENTO_EXCEDE_MAXIMO` and writes nothing; a positive discount by a
   non-admin returns `DESCUENTO_NO_AUTORIZADO` (server re-enforcement, R-V8).
7. **Stock warning** → add more of a product than the branch holds and save →
   the draft still saves **and** an amber *"Insufficient stock"* banner lists
   requested vs available (R-V9; it is a warning, never a block).
8. **Confirm a draft (5c, R-V15)** → in *My drafts*, *Confirm draft N* is
   single-shot (disables while in flight — a double-click never consumes twice).
   Success flips the row to **CONFIRMADA** with its **NCF** (`B0200000101`-style)
   and the status note carries the invoice. DB side: one `VENTA` `CONFIRMADA`,
   one `FACTURA` `VIGENTE`, `NCF_SECUENCIA.secuenciaActual` avanzado, un
   `MOVIMIENTO_INVENTARIO` `SALIDA_VENTA`. Con el 90% del rango consumido aparece
   el banner ámbar *"NCF range at 90%"* (`NCF_UMBRAL_90`) — aviso, no bloqueo.
   Con `facturaAutomatica=false`, sin stock duro o sin rango: `FACTURA_AUTOMATICA_FALTA`,
   `STOCK_INSUFICIENTE_BLOQUEO`, `NCF_AGOTADA/VENCIDA/SEC_INEXISTENTE` (el draft
   queda intacto — nada se quema).
9. **Cancel draft vs Cancel sale** → *Cancel draft N* (BORRADOR) va a `CANCELADA`
   sin efectos; *Cancel sale N* (CONFIRMADA) anula su factura (`VIGENTE → ANULADA`)
   y repone stock (608). El NCF consumido jamás se revierte.
10. **No-payment boundary** → confirm there is no *Cobrar* / payment control
    anywhere (Fase 6 scope).

> Known V1 limitation: the screen is mouse/touch driven; full keyboard-led
> operation is deferred (documented in R-V14).

## E2E Playwright (fase 5c — `pnpm e2e`)

Un smoke end-to-end contra el stack real: login (Supabase Auth remoto) → POS →
borrador → confirm → CONFIRMADA + NCF en pantalla → cadena observable completa
en la BD local (venta, factura, secuencia, movimiento). Spec:
`app/e2e/confirm-venta.spec.ts` (config en `app/playwright.config.ts`).

> **Seed + DB caveat (documentado por contrato)**: el runtime de la app lee
> Postgres LOCAL mientras la autenticación es Supabase REMOTA. El smoke necesita
> un entorno dev completo, no solo npm install:

| Prerequisito | Cómo |
|---|---|
| Postgres local arriba + migrations | `docker compose up -d` + `pnpm prisma migrate deploy` |
| Datos sembrados (en orden) | `pnpm seed:venta` → `pnpm seed:ncf` → `pnpm seed:cliente` |
| Usuario Supabase Auth espejo | un Auth user cuyo `nombreUsuario` exista en la BD local con sucursal y stock del producto |
| Browser | `npx playwright install chromium` |

Ejecución:

```bash
cd app
E2E_USER=<nombreUsuario> E2E_PASSWORD=<supabase-cred> pnpm e2e
# Opcional: E2E_PRODUCT (default "Arroz"), E2E_BASE_URL (default :3000)
```

El `beforeAll` valida las precondiciones (usuario con rol POS, empresa con
`facturaAutomatica=true`, rangos B01/B02, producto con stock en la sucursal) y
falla con el paso exacto a corregir. La suíte corre en serie (`workers: 1`):
cada ejecución consume UNA secuencia real del rango B02.

## Comandos útiles


```bash
# Estado del container
docker compose ps

# Logs del container
docker compose logs -f postgres

# Reiniciar (preserva datos gracias al volume)
docker compose restart

# Wipe total (BORRA todos los datos)
docker compose down -v
docker compose up -d

# Verificar persistencia después de restart
docker compose restart
npx tsx scripts/diagnose-rls.ts  # debe seguir verde
```

## Diferencias vs Supabase

| Aspecto | Local | Supabase |
|---|---|---|
| `postgres` role | SUPERUSER (bypassa RLS por superuser, no por BYPASSRLS) | SUPERUSER con BYPASSRLS=true (default Supabase) |
| `systemfact_app` role | NOBYPASSRLS (RLS aplica) | NOBYPASSRLS (RLS aplica) |
| Auth | No aplica (local sin Supabase Auth) | Supabase Auth |
| Conexión | `localhost:5433` | Pooler `aws-1-us-east-2.pooler.supabase.com:5432` |

**Implicación práctica**: si tu migration depende de que `postgres` NO
sea superuser, va a fallar local pero pasar en Supabase. Solución: no
escribir migrations que asuman un modelo específico de postgres.

## Troubleshooting

### Container no arranca
```bash
docker compose logs postgres
```

### "No pending migrations" pero la BD está vacía
```bash
# Verificar que el rol existe
psql -h localhost -p 5433 -U postgres -d postgres -c "\du systemfact_app"
# Si no existe, reaplicar migrations
pnpm prisma migrate deploy
```

### Conexión rechazada
```bash
# Verificar que el container está healthy
docker inspect --format "{{.State.Health.Status}}" sf-postgres
```

### Resetear todo (wipe + start fresh)
```bash
docker compose down -v   # BORRA el volume (todos los datos)
docker compose up -d
cd app && pnpm prisma migrate deploy
```

## Referencias

- `docker-compose.yml` (raíz) — definición del container
- `app/.env.example` — plantilla de variables de entorno
- `app/prisma/migrations/20260902150000_create_app_role/` — rol idempotente
- `docs/12-decisiones_de_arquitectura.md` ADR-019 — defensa en profundidad
- `docs/19-directivas_desarrollo.md` §3 — multi-tenancy siempre