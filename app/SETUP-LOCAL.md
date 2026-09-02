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
#    DATABASE_URL=postgresql://systemfact_app:SF_App_2026@localhost:5433/postgres
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
| `postgres` | Owner. Migrations, ALTER ROLE, DDL admin | `devpass` |
| `systemfact_app` | App runtime. NOBYPASSRLS, RLS enforced | `SF_App_2026` |

**Reglas**:
- `DIRECT_URL` usa `postgres` (puede hacer DDL, ALTER ROLE, CREATE ROLE)
- `DATABASE_URL` usa `systemfact_app` (queries de la app, RLS aplica)
- La migration `20260902150000_create_app_role` crea el rol idempotentemente
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