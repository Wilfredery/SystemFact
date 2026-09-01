# Módulo de Autenticación (Fase 1.1)

Autenticación con **Supabase Auth** siguiendo **ADR-014**: el identificador de
acceso es `nombreUsuario` (nunca el email). Internamente, Supabase Auth usa un
email sintético `<nombreUsuario>@users.systemfact.internal`.

## Estructura

```
src/modules/auth/
├── domain/            # (vacío por ahora, fase posterior)
├── infrastructure/
│   └── auth-service.ts    # Lógica de login/logout/getCurrentUser (Supabase + Prisma)
├── http/
│   └── actions.ts         # Server Actions (adaptadores delgados)
└── README.md
```

Los clientes de Supabase viven en `src/lib/supabase/*` como utilidad de
infraestructura compartida (excepción documentada en AGENTS.md):

- `client.ts` — cliente SSR para Server Components / Server Actions.
- `middleware.ts` — cliente SSR para el middleware (refresco de sesión).
- `client-component.ts` — cliente browser para componentes cliente.

## Flujo de login (ADR-014)

1. El usuario entra `nombreUsuario` + contraseña.
2. La Server Action `login(formData)` crea el cliente SSR y delega en
   `auth-service.ts`.
3. `loginWithCredenciales` intenta primero el login en Supabase Auth con
   `<nombreUsuario>@users.systemfact.internal`. Los errores son genéricos para
   evitar enumeración de usuarios (el usuario que no existe falla igual que el
   que existe con contraseña incorrecta).
4. Si el login de Auth es exitoso, se valida que exista una fila activa en la
   tabla `USUARIO` con ese `nombreUsuario`. Si no existe o está inactiva, se
   cierra la sesión y se devuelve el mismo error genérico (usuario deshabilitado
   no puede permanecer logueado).

## Cómo crear un usuario de prueba manualmente (hasta Fase 1.2)

El alta de usuarios (Fase 1.2) aún no está implementado. Para probar el login
end-to-end, crea el usuario en **dos** sitios (deben coincidir):

### 1. Fila en la tabla `USUARIO` (base de datos — Prisma/Supabase)

La tabla `USUARIO` del esquema requiere `empresaId` y `sucursalId`, ambos
existentes. Ejemplo de inserción vía SQL:

```sql
-- Asegúrate de que existen una EMPRESA y una SUCURSAL
INSERT INTO "USUARIO"
  ("empresaId","sucursalId","nombre","nombreUsuario","passwordHash","activo")
VALUES
  (1, 1, 'Usuario Demo', 'demo', '<hash interno de la app>', true);
```

> Nota: `passwordHash` es el hash interno de la app (para la futura alta /
> recuperación). Se rellena en Fase 1.2; para login vía Supabase Auth lo
> relevante es la contraseña creada en el paso 2.

### 2. Usuario en Supabase Auth (mismo email sintético)

Crea el usuario de Auth con el email sintético correcto y la contraseña que se
usará en el login:

```sql
-- En el esquema `auth` de Supabase (usa el SQL Editor del dashboard):
select auth.users_login(
  '<nombre-usuario>@users.systemfact.internal',
  'la-contraseña-del-login'
);
```

O bien, desde el **Dashboard de Supabase → Authentication → Users → Add user**
con:
- **Email**: `demo@users.systemfact.internal` (sustituye `demo` por el
  `nombreUsuario`)
- **Password**: la contraseña que se escribirá en el formulario.

Ambos valores (`nombreUsuario` de la fila `USUARIO` y el email sintético en
Supabase Auth) deben corresponder exactamente, con los mismos `nombreUsuario`.

## Pendiente

- Fase 1.2: alta de usuarios (crea a la vez la fila `USUARIO` y el usuario en
  Supabase Auth con el email sintético).
