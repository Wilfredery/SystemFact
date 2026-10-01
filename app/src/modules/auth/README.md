# Módulo de Autenticación (Fase 1.1)

Autenticación con **Supabase Auth** siguiendo **ADR-014**: el identificador de
acceso es `nombreUsuario` (nunca el email). Internamente, Supabase Auth usa un
email sintético `<nombreUsuario>@users.systemfact.internal`.

## Estructura

```
src/modules/auth/
├── domain/                # TS puro: sin Next.js, React, Prisma ni Supabase
│   ├── auth-sub.ts        # Normalización del claim Auth `sub` (UUID canónico)
│   ├── errors.ts          # Catálogo de códigos de error + mensajes al usuario
│   └── synthetic-email.ts # Construcción del email sintético (solo encode)
├── infrastructure/
│   ├── auth-identity.ts   # Resolución de identidad por `sub` + enlace lazy
│   └── auth-service.ts    # Casos de uso: login / logout / getCurrentUser
├── http/
│   └── actions.ts         # Server Actions (adaptadores delgados)
└── README.md
```

Los clientes de Supabase viven en `src/lib/supabase/*` como utilidad de
infraestructura compartida (excepción documentada en AGENTS.md):

- `client.ts` — cliente SSR para Server Components / Server Actions.
- `middleware.ts` — cliente SSR para el middleware (refresco de sesión).
- `client-component.ts` — cliente browser para componentes cliente.

## Modelo de identidad (ADR-014, hallazgo de auditoría v2r-01)

La identidad de una sesión se resuelve **por el `sub` inmutable de Supabase Auth**,
almacenado en `USUARIO.authUserId` (`UUID` nullable). Antes se resolvía decodificando
`nombreUsuario` de vuelta desde el email del JWT, y eso no era a prueba de
manipulación: un admin de Auth puede reescribir el atributo `email`, de modo que
quien lo controle controlaría a qué fila `USUARIO` —y por tanto a qué `empresa`—
resuelve una petición.

- `authUserId` es nullable **a propósito y sin backfill**: los `sub` viven en Supabase
  Auth, no en Postgres, así que no existe un backfill honesto offline (fabricar UUID
  sería peor que `NULL`). `NULL` significa "nunca ha hecho login desde que existe la
  columna".
- La unicidad la garantiza un índice **parcial** único (`usuario_auth_user_id_uk`,
  sobre `WHERE "authUserId" IS NOT NULL`, en la migración
  `20260930120000_usuario_auth_user_id`), escrito a mano porque el DSL de Prisma no
  puede expresar el predicado parcial. Por eso las búsquedas por `sub` usan
  `findFirst` y no `findUnique`.
- El email sintético solo se **construye** (`buildSyntheticEmail`), nunca se decodifica.
  El decodificador inverso (`decodeNombreUsuario`) se eliminó en este cambio: un
  decoder vivo aquí sería una vía permanente de reintroducción de la vulnerabilidad.

## Flujo de login (ADR-014)

Implementado en `auth-service.ts` → `loginWithCredenciales`, en este orden:

1. El usuario entra `nombreUsuario` + contraseña.
2. La Server Action `login(formData)` valida el formulario con Zod (si falta un campo,
   devuelve `AUTH_CAMPOS_REQUERIDOS`), crea el cliente SSR y delega en
   `auth-service.ts`.
3. **Paso 1 — `signInWithPassword`** contra Supabase Auth con el email sintético.
   Este es el **único** paso alcanzable por un desconocido, y su fallo es uniforme:
   un solo código, `AUTH_CREDENCIALES_INVALIDAS`, tanto si la cuenta no existe como
   si la contraseña es incorrecta. Supabase no distingue esos dos casos, así que
   tampoco este módulo. En esta ruta no se lee nada de la base de datos.
4. **Paso 2 — autorizar la fila `USUARIO` mapeada** mediante
   `buscarUsuarioPorNombreUsuario`. Es el **único** punto donde una fila se busca por
   `nombreUsuario`, y corre *después* de verificar las credenciales. La fila debe
   existir y estar `activo`; si no, se cierra la sesión (`signOut`) y se devuelve
   `AUTH_USUARIO_INACTIVO`.
5. **Paso 3 — `normalizarAuthSub`** sobre el `sub` devuelto por Auth (trim, minúsculas
   y forma UUID canónica). Si el claim no resulta utilizable, se cierra la sesión y se
   falla cerrado con `AUTH_CREDENCIALES_INVALIDAS`: es un invariante interno del
   servidor, no una condición accionable por el usuario, así que no merece un código
   propio.
6. **Paso 4 — enlace lazy e idempotente** con `enlazarAuthSub`. La escritura es un
   *compare-and-set* sobre `authUserId IS NULL`, así que dos primeros logins
   concurrentes no pueden enlazar ambos:

   | Situación | Resultado |
   |---|---|
   | La fila ya tiene **ese mismo** `sub` | `{ ok: true }`, sin escribir nada |
   | La fila ya tiene **otro** `sub` | `AUTH_ENLACE_CONFLICTO` — nunca se sobrescribe |
   | **Otra** fila ya tiene ese `sub` | El índice parcial lo rechaza (`P2002`) → `AUTH_ENLACE_DUPLICADO` |
   | La fila **no resuelve** dentro de la empresa del ancla | `AUTH_ENLACE_NO_RESUELTO` — no hay `sub` contra el cual comparar, así que no se escribe nada |

   Cualquier fallo cierra la sesión y devuelve el error tipado: una sesión que no se
   puede enlazar quedaría irresoluble de forma permanente en el path de cada petición.
7. **Paso 5 — auditoría.** Un login completamente exitoso escribe **exactamente una**
   fila `LOGIN` en `MOVIMIENTO_AUDITORIA` (`REQ-AUTH-AUD-001`). Los logins rechazados
   (credenciales, inactivo, conflicto de enlace) no escriben nada: no hay actor
   atribuible, y así el log tampoco sirve de canal de enumeración.

`logout` resuelve la identidad por `sub` **antes** de cerrar la sesión y escribe una
fila `LOGOUT` solo si esa identidad resolvió (un logout no atribuible no escribe nada).

### Postura sobre enumeración de usuarios

Los códigos de error **no son uniformes, a propósito**. El paso 1 (el único alcanzable
por un desconocido) falla siempre con `AUTH_CREDENCIALES_INVALIDAS`. Los códigos
restantes —`AUTH_USUARIO_INACTIVO` y la familia `AUTH_ENLACE_*`— solo son alcanzables
**después** de que Auth haya devuelto una sesión válida, lo que exige la contraseña
correcta de un `nombreUsuario` existente: quien llama ya sabe de qué cuenta tiene
credenciales, así que distinguirlos no le revela nada que no supiera. Son señales de
soporte accionables ("tu usuario está deshabilitado", "tu acceso fue recreado", "no
encontramos tu usuario en esta empresa"), y fundirlos en el código genérico dejaría a
un usuario legítimo sin próximo paso.

### Códigos de error

Todos los códigos viven en `domain/errors.ts` (fuente única, versionados junto al
dominio; nunca se escriben inline en adaptadores ni componentes):

| Código | Cuándo se devuelve |
|---|---|
| `AUTH_CAMPOS_REQUERIDOS` | Faltan `nombreUsuario` o contraseña (validación Zod en la Server Action). |
| `AUTH_CREDENCIALES_INVALIDAS` | Fallo de `signInWithPassword`, **o** claim `sub` no utilizable tras un login exitoso. |
| `AUTH_USUARIO_INACTIVO` | No existe fila `USUARIO` para ese `nombreUsuario`, o existe inactiva. |
| `AUTH_ENLACE_CONFLICTO` | La fila ya está enlazada a **otro** `sub`; solo un admin decide si se reapunta. |
| `AUTH_ENLACE_DUPLICADO` | Ese `sub` ya pertenece a otra fila `USUARIO` (índice parcial → `P2002`). |
| `AUTH_ENLACE_NO_RESUELTO` | La fila no resolvió dentro de la empresa del ancla: no existe, o no es visible ahí. Cubre **un solo** código a propósito — esas dos causas son indistinguibles por construcción (el filtro `empresaId` y RLS las hacen invisibles por igual), y esa indistinguibilidad es justamente la defensa entre tenants. |

Los mensajes de `AUTH_ENLACE_*` no revelan qué fila está en conflicto ni en qué `empresa`.
En particular `AUTH_ENLACE_NO_RESUELTO` es **tenant-blind**: nunca dice que la fila exista
en otra empresa, nunca nombra una `empresa` ajena y nunca distingue "no existe" de "está
en otro lado".

## Consecuencia operativa (aceptada)

Las sesiones emitidas **antes** del despliegue de esta migración no resuelven
identidad por `sub`, porque su fila sigue con `authUserId IS NULL`. Cada usuario
afectado tiene que autenticarse **exactamente una vez más**: ese login escribe el
enlace y a partir de ahí la resolución es por `sub`.

No hay *fallback* silencioso por email en el path de petición —ese fallback es
precisamente la vulnerabilidad que este cambio elimina—. Mientras el `sub` no esté
enlazado, `getCurrentUser` y la resolución de contexto de tenant devuelven `null` y el
usuario se trata como no autenticado.

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
>
> No incluyas `authUserId`: se enlaza solo, en el primer login exitoso.

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
