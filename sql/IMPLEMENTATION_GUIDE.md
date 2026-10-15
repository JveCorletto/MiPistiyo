# Implementación de MiPistiyo en Supabase y Next.js

Esta guía corresponde a `001_initial_schema_corrected.sql` y `002_validation_tests.sql`.

## 1. Crear el proyecto y ejecutar el esquema

1. Cree un proyecto Supabase nuevo y espere a que Database y Auth estén operativos.
2. Abra **SQL Editor → New query**.
3. Copie el contenido completo de `001_initial_schema_corrected.sql` y ejecútelo una sola vez. No seleccione fragmentos.
4. La transacción abortará completa si una instrucción falla. No intente “continuar” después de un error: corrija la causa y use otro proyecto nuevo, ya que este archivo es un esquema inicial, no una migración idempotente.
5. Al final deben aparecer 18 tablas con `rowsecurity = true`, las políticas y ocho funciones financieras principales.
6. Compruebe también:

```sql
select count(*) as public_tables_with_rls
from pg_tables
where schemaname='public' and rowsecurity;

select table_name
from information_schema.views
where table_schema='public' and table_name like 'v\_%' escape '\'
order by table_name;
```

El primer resultado debe incluir las 18 tablas de MiPistiyo y el segundo debe listar 7 vistas.

## 2. Configuración manual indispensable

- Defina en **Authentication → URL Configuration** el `Site URL` de producción y agregue `http://localhost:3000/**` para desarrollo. Agregue explícitamente el callback de la aplicación, por ejemplo `http://localhost:3000/auth/callback` y su equivalente HTTPS de producción. Consulte la [guía oficial de redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls).
- Active únicamente los proveedores de acceso que vaya a utilizar. Si MiPistiyo será solo Google, desactive altas por correo/contraseña y acceso anónimo.
- Antes del primer intento OAuth, agregue el correo a `allowed_users`; el hook debe rechazar todo correo ausente o inactivo.
- Mantenga las claves secretas exclusivamente en el servidor. Supabase recomienda actualmente una publishable key en el navegador y una secret key solo en componentes controlados del backend; la secret key usa `service_role` y omite RLS. Consulte [API keys](https://supabase.com/docs/guides/getting-started/api-keys).
- No conceda escritura directa sobre `operations`, `ledger_entries`, pagos, transferencias, ajustes, ocurrencias o importaciones. El esquema ya las limita a RPC/servicio.

## 3. Configurar Google OAuth

1. En Google Auth Platform cree/configure un proyecto, la pantalla de consentimiento y los scopes mínimos `openid`, `userinfo.email` y `userinfo.profile`.
2. Cree un OAuth Client ID de tipo **Web application**.
3. En **Authorized JavaScript origins** agregue los orígenes exactos, sin ruta: `http://localhost:3000` y el origen HTTPS de producción.
4. En Supabase abra **Authentication → Providers → Google** y copie la callback URL mostrada allí.
5. Pegue esa URL en **Authorized redirect URIs** del cliente de Google. Para Supabase local la documentación usa `http://127.0.0.1:54321/auth/v1/callback`; para el proyecto hospedado use exactamente la URL que muestra su dashboard.
6. Copie Client ID y Client Secret a la configuración del proveedor Google en Supabase y actívelo.
7. Configure los redirect URLs de la aplicación en Supabase; no confunda el callback de Supabase que recibe Google con `/auth/callback` de Next.js que recibe el código PKCE.

Los pasos y scopes vigentes están en la [documentación oficial Sign in with Google](https://supabase.com/docs/guides/auth/social-login/auth-google).

## 4. Configurar y verificar el Auth Hook

El esquema ya crea `public.before_user_created(jsonb)`, con `SECURITY DEFINER`, `search_path=''`, acceso para `supabase_auth_admin` y revocación para los roles del cliente.

1. Abra **Authentication → Hooks**.
2. En **Before User Created**, agregue un hook de tipo **Postgres Function**.
3. Seleccione `public.before_user_created` y guarde/active.
4. La URI equivalente en configuración local es:

```toml
[auth.hook.before_user_created]
enabled = true
uri = "pg-functions://postgres/public/before_user_created"
```

5. Verifique los privilegios:

```sql
select
  has_function_privilege('supabase_auth_admin',
    'public.before_user_created(jsonb)','EXECUTE') as auth_can_execute,
  has_function_privilege('authenticated',
    'public.before_user_created(jsonb)','EXECUTE') as client_can_execute;
```

Debe devolver `true, false`. La [documentación de Auth Hooks](https://supabase.com/docs/guides/auth/auth-hooks) confirma la firma JSONB, el rol `supabase_auth_admin` y el modelo de permisos; la [guía Before User Created](https://supabase.com/docs/guides/auth/auth-hooks/before-user-created-hook) documenta que un objeto `error` rechaza el alta.

## 5. Administrar `allowed_users`

Hágalo solo desde SQL Editor con una cuenta propietaria. No existe política ni `GRANT` para el cliente.

Autorizar o reactivar:

```sql
insert into public.allowed_users(email,is_active)
values ('persona@example.com',true)
on conflict (email) do update set is_active=true;
```

Revocar inmediatamente:

```sql
update public.allowed_users
set is_active=false
where email='persona@example.com';
```

La revocación bloquea nuevas RPC y hace que RLS deje de devolver filas. No elimina la información histórica ni invalida por sí sola la cookie/JWT ya emitida; la sesión puede existir, pero no tendrá acceso a los datos. Si además quiere cerrar sesiones, use las funciones administrativas de Supabase Auth desde un backend seguro.

Después de autorizar a un usuario antiguo que ya existía en `auth.users`, este puede ejecutar:

```sql
select public.ensure_profile();
select public.seed_default_categories();
```

desde una sesión autenticada. Para usuarios nuevos confirmados, el trigger crea el perfil automáticamente.

## 6. Comprobar RLS y aislamiento

Use dos cuentas Google distintas, ambas en la whitelist:

1. Inicie sesión como A y cree una cuenta financiera.
2. Inicie sesión como B y compruebe que un `select('*')` no devuelve la fila de A.
3. Como B, intente insertar una fila con el `user_id` de A: debe fallar por RLS.
4. Intente escribir en `ledger_entries`: debe fallar por privilegios antes de RLS.
5. Pruebe cada una de las 7 vistas; todas deben devolver únicamente el `auth.uid()` activo.
6. Desactive A en `allowed_users` y repita: las lecturas deben quedar vacías y las RPC deben devolver acceso no autorizado.

No pruebe RLS desde SQL Editor como `postgres` esperando aislamiento: el propietario puede omitir RLS. Las pruebas deben usar un JWT real o `SET LOCAL ROLE authenticated` con claims simulados, como hace el script de validación.

## 7. Ejecutar las pruebas

1. Use un segundo proyecto Supabase descartable y vacío.
2. Ejecute primero `001_initial_schema_corrected.sql`.
3. Abra otra consulta, copie todo `002_validation_tests.sql` y ejecútelo como propietario.
4. El script crea usuarios sintéticos directamente en `auth.users` solo para probar; por eso nunca debe ejecutarse en producción.
5. Cada comprobación aborta con `ASSERT FAILED` si algo es incorrecto. El resultado correcto llega al aviso `OK: todas las pruebas de MiPistiyo finalizaron` y después ejecuta `ROLLBACK`.
6. Verifique que no quedaron los correos `mipistiyo.test.*@example.com`; el rollback debe eliminarlos.
7. Complete con pruebas de integración usando dos sesiones HTTP reales y dos solicitudes simultáneas con la misma `p_idempotency_key`. Ambas deben devolver el mismo UUID y solo debe existir una cabecera/efecto.

La ejecución local realizada durante esta auditoría usó PostgreSQL 18 y stubs compatibles de Supabase; no reemplaza esta prueba final dentro de un proyecto Supabase hospedado.

## 8. Acceso seguro desde Next.js

Instale los clientes SSR:

```bash
npm install @supabase/supabase-js @supabase/ssr
```

Variables públicas y privadas:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://PROJECT_REF.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...

# Solo servidor; nunca NEXT_PUBLIC_ ni repositorio.
SUPABASE_URL=https://PROJECT_REF.supabase.co
SUPABASE_SECRET_KEY=sb_secret_...
CRON_SECRET=una-cadena-aleatoria-larga
```

- Use `@supabase/ssr` y cookies para el cliente de navegador/Server Components. La [guía SSR oficial](https://supabase.com/docs/guides/auth/server-side/creating-a-client) requiere clientes separados de browser/server y un Proxy para refrescar tokens (`proxy.ts` en Next.js 16; `middleware.ts` en 15 o anterior).
- En Server Components/Actions valide la identidad con `getClaims()` siguiendo esa guía. No confíe en parámetros `user_id` del navegador; las RPC obtienen el propietario mediante `auth.uid()`.
- Llame las operaciones con `supabase.rpc(...)` y una idempotency key UUID generada una vez por acción del usuario y reutilizada en reintentos. Ejemplo:

```ts
const key = crypto.randomUUID()

const { data: operationId, error } = await supabase.rpc('post_transaction', {
  p_kind: 'EXPENSE',
  p_category_id: categoryId,
  p_amount: amount,
  p_account_id: accountId,
  p_card_id: null,
  p_effective_on: effectiveOn,
  p_note: note,
  p_idempotency_key: key,
})

if (error) throw error
```

- No use la secret key para peticiones normales del usuario: omitiría RLS. Cree un cliente administrativo independiente únicamente dentro de rutas server-only/cron, sin cookies de usuario.
- No envíe operaciones financieras mediante varios `insert`; una única RPC es la frontera transaccional.
- No almacene ni calcule saldos definitivos en React. Lea las vistas/RPC después de confirmar la operación.
- Evite cachear respuestas autenticadas compartidas; una respuesta SSR con cookies de sesión nunca debe servirse a otro usuario.

## 9. Programar movimientos recurrentes

La base genera ocurrencias `PENDING`; no las contabiliza ni mueve saldos hasta que el usuario confirma mediante `post_recurring_occurrence`. Esto requiere un disparador externo diario.

En Vercel, cree una Route Handler protegida por `CRON_SECRET`. Vercel envía ese valor en `Authorization: Bearer ...`; consulte [Managing Cron Jobs](https://vercel.com/docs/cron-jobs/manage-cron-jobs).

La ruta debe:

1. Comparar el header con `Bearer ${process.env.CRON_SECRET}`.
2. Crear un cliente server-only con `SUPABASE_URL` y `SUPABASE_SECRET_KEY`.
3. Calcular la fecha de hoy en `America/El_Salvador` como `YYYY-MM-DD`.
4. Ejecutar:

```ts
const { data, error } = await supabaseAdmin.rpc(
  'generate_pending_occurrences_all',
  { p_through: todayInElSalvador },
)
```

5. Registrar el error y responder con estado no 2xx para que sea visible en los logs del cron.

La función solo está concedida a `service_role`, aplica unicidad `(user_id, recurring_id, scheduled_on)` y toma bloqueos; una repetición o solapamiento del cron no duplica ocurrencias. La secret key evita tener que suplantar a cada usuario y nunca debe llegar al cliente.

## 10. Uso correcto de préstamos e importaciones

- Deuda que ya existía al adoptar MiPistiyo: `opening_debt > 0`, `balance_mode='OPENING_BALANCE'`. No llame `post_loan_disbursement`.
- Préstamo recibido dentro de MiPistiyo: `opening_debt=0`, `balance_mode='TRACKED_DISBURSEMENTS'`; llame una vez por cada entrega real de fondos.
- En una restauración JSON futura, calcule SHA-256 del archivo normalizado y cree `import_history` con `import_key`, `backup_version` y `source_sha256`. Haga toda la restauración en una transacción server-side, valide que cada `user_id` sea el dueño objetivo y marque `SUCCESS`/`FAILED` con `completed_at` y métricas. Nunca acepte un `user_id` del JSON sin reemplazarlo o validarlo contra el usuario de destino.
