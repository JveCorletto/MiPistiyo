<div align="center">

<img src="public/brand/mipistiyo-logo.png" alt="MiPistiyo — Tu pisto, bajo control." width="560" />

# MiPistiyo

**Tu pisto, bajo control.**

Aplicación web de finanzas personales para registrar ingresos, gastos, cuentas, tarjetas, préstamos y presupuestos desde un solo lugar, con especial cuidado en **no duplicar movimientos ni alterar saldos por error**.

**Estado:** beta privada · **Moneda:** USD · **Zona horaria de referencia:** `America/El_Salvador`

</div>

> **Nota:** el título de la pestaña del navegador se configuró como **MiPistillo App** por decisión del proyecto. El nombre visible de la marca sigue siendo **MiPistiyo**.

## Funcionalidades

| Módulo | Funcionalidad principal |
| --- | --- |
| **Acceso** | Autenticación con Google, selector de cuenta y acceso restringido a correos autorizados. |
| **Dashboard** | Resumen mensual, balances, patrimonio neto, evolución de ingresos/gastos y actividad reciente. |
| **Cuentas** | Registro y administración de efectivo, cuentas bancarias y billeteras, con saldos de apertura. |
| **Tarjetas** | Tarjetas de débito y crédito, límites, deuda y crédito disponible. |
| **Categorías** | Clasificación de ingresos y gastos; activación y desactivación. |
| **Movimientos** | Ingresos, gastos, movimientos históricos, búsqueda, filtros y exportación CSV. |
| **Historial avanzado** | Detalles, detección de posibles duplicados, anulación mediante reverso y edición auditada de datos no financieros. |
| **Transferencias y pagos** | Traspasos entre cuentas propias, operaciones con terceros, pagos de tarjetas y abonos a préstamos. |
| **Préstamos** | Deuda pendiente, desembolsos y pagos desglosados en capital, intereses y comisiones. |
| **Presupuestos** | Límites mensuales generales y por categoría, progreso y reutilización de límites de meses anteriores. |
| **Pagos recurrentes** | Programación, confirmación u omisión de vencimientos; edición de fecha y frecuencia. |
| **OCR financiero** | Lectura de tickets, comprobantes y alertas bancarias; sugerencias de monto, fecha, comercio y tarjeta. |
| **Notificaciones** | Campana, vencimientos y preferencias; proceso programado y correo opcionales. |

Las operaciones financieras requieren confirmación del usuario. **Ni el OCR ni los recordatorios ejecutan cargos automáticamente.**

## Tecnologías

| Capa | Tecnología |
| --- | --- |
| Frontend y servidor | Next.js **16.4.1** (App Router, Turbopack, Cache Components) |
| Interfaz | React 19, TypeScript, Tailwind CSS 4, Lucide React |
| Base de datos | PostgreSQL gestionado por Supabase |
| Autenticación | Supabase Auth + Google OAuth |
| Autorización | Row Level Security (RLS), lista `allowed_users` y funciones SQL protegidas |
| Calendarios | React DayPicker + date-fns |
| OCR | Tesseract.js (reconocimiento en el navegador) |
| Despliegue previsto | Vercel |
| Notificaciones externas opcionales | Vercel Cron + Resend |

## Requisitos

- **Node.js** compatible con Next.js 16 (recomendado Node.js 22 LTS o posterior compatible).
- **npm**.
- Proyecto de **Supabase** con el esquema financiero y las migraciones correspondientes aplicadas.
- Configuración de **Google OAuth** en Google Cloud y Supabase.

## Ejecución local

Cloná el repositorio e instalá las dependencias:

```bash
git clone https://github.com/JveCorletto/MiPistiyo.git
cd MiPistiyo
npm ci
```

Creá un archivo `.env.local` en la raíz (no se sube a Git):

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://TU-PROYECTO.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=TU_CLAVE_PUBLICA
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

> Si el proyecto utiliza el OCR y `tesseract.js` todavía no está en tu `package.json`, instalalo con `npm install tesseract.js@^7` y agregá **ambos**, `package.json` y `package-lock.json`, al commit.

Iniciá el servidor:

```bash
npm run dev
```

Abrí **http://localhost:3000**.

Comandos útiles:

```bash
npx tsc --noEmit   # Verificación de tipos
npm run lint       # ESLint
npm run build      # Compilación de producción
npm run start      # Ejecutar la compilación de producción
```

Si están presentes las pruebas del OCR e historial, podés ejecutarlas con Node.js 22:

```bash
node --experimental-strip-types --test tests/*.test.mjs
```

## Base de datos y migraciones

La base de datos no es un simple listado de gastos: utiliza **operaciones y asientos de libro mayor** para mantener saldos coherentes. Las funciones RPC de Supabase ejecutan las operaciones financieras; el cliente web no debe escribir directamente los asientos.

Los scripts SQL que se han utilizado durante el desarrollo incluyen:

| Script | Propósito | Precaución |
| --- | --- | --- |
| `001_initial_schema.sql` | Esquema inicial del proyecto. | **Solo instalación inicial**; no volver a ejecutar sobre una base con datos. |
| `002_validation_tests.sql` | Validaciones del esquema. | Leer antes de ejecutar; puede contener pruebas que alteren datos. |
| `003_historical_movements.sql` | Historial incluido en saldos de apertura. | Requiere esquema inicial. |
| `004_reset_movements.sql` | Reinicio de movimientos de desarrollo. | **DESTRUCTIVO. No ejecutar en producción.** |
| `005_count_movements.sql` | Consultas de comprobación. | Diagnóstico. |
| `006_advanced_history.sql` | Historial unificado y anulaciones históricas. | Requiere migraciones anteriores aplicables. |
| `007_edit_movement_metadata.sql` | Edición auditada de descripción, categoría y hora opcional. | No modifica importes ni asientos. |
| `008_notifications.sql` | Notificaciones y preferencias. | Necesario para el módulo de avisos. |
| `009_reschedule_recurring.sql` | Reprogramación de recurrencias pendientes. | Conservar pagos confirmados/omitidos; utilizar la **versión corregida y probada**. |

> Los archivos `007`–`009` se incorporaron como parches posteriores al último ZIP integral del proyecto compartido. Confirmá que estén en el repositorio antes de enlazarlos o automatizar su ejecución. **No ejecutes scripts antiguos indiscriminadamente**: las migraciones ya aplicadas en Supabase deben mantenerse sincronizadas con la versión del código.

Para un entorno nuevo, revisá también la guía de implementación del esquema y configurá las funciones, privilegios y políticas necesarias. **Hacé un respaldo verificable antes de migrar.**

### Reglas contables fundamentales

- Un **gasto normal** afecta el saldo de la cuenta o aumenta la deuda de la tarjeta, según corresponda.
- Un **gasto histórico ya incluido en el saldo inicial** aparece en el historial y reportes, pero **no vuelve a afectar el saldo**.
- Una **transferencia entre cuentas propias** mueve dinero entre cuentas; no es un ingreso ni un gasto.
- Un **pago de tarjeta** reduce efectivo y deuda, sin duplicar como gasto las compras ya contabilizadas.
- Un **pago de préstamo** distingue capital de intereses y comisiones.
- Una **anulación** se realiza mediante reverso contable; no borrando ni editando asientos del libro mayor.
- Los **posibles duplicados** se sugieren para revisión; no se anulan automáticamente por coincidencia de monto o fecha.
- Cambiar **descripción, categoría compatible u hora** no debe alterar importes o saldos; las modificaciones quedan auditadas.

## Autenticación con Google

MiPistiyo opera actualmente como **beta privada**. La pantalla presenta opciones de **Iniciar sesión** y **Crear cuenta**, ambas mediante Google. La opción de crear cuenta **no habilita el registro público**: Supabase limita el alta mediante `allowed_users` y el hook `before_user_created`.

Para configurar OAuth:

1. Configurá Google como proveedor en **Supabase → Authentication → Providers**.
2. En Google Cloud, autorizá **la URL de callback que muestra Supabase** para el cliente OAuth.
3. En **Supabase → Authentication → URL Configuration**, configurá el dominio de la aplicación y agregá las URLs de redirección permitidas, incluyendo `http://localhost:3000/auth/callback` y la equivalente de producción.
4. Autorizá los correos que deban utilizar la beta en `allowed_users` mediante un procedimiento administrativo.
5. Verificá que las políticas RLS se mantengan activas y que cada usuario solo pueda acceder a sus datos.

Se solicita el selector de cuentas de Google con `prompt: "select_account"`. Cerrar sesión en MiPistiyo cierra la sesión de Supabase, no necesariamente la sesión general del navegador con Google.

## OCR: revisión antes de guardar

El motor de reconocimiento se ejecuta en el navegador con Tesseract.js. El extractor puede sugerir información de:

- Tickets y facturas.
- Transferencias bancarias y comprobantes de pago.
- Alertas de compra por SMS o captura de pantalla.

La persona revisa monto, fecha, hora (si existe), concepto, categoría y cuenta o tarjeta antes de confirmar. Para ingresos/gastos puede seleccionar **movimiento nuevo** o **histórico ya incluido en el saldo inicial**.

El OCR es **asistivo**, no una fuente contable infalible. La clasificación de transferencias y pagos debe verificarse manualmente. Las imágenes se procesan localmente en el navegador en el flujo actual; los modelos OCR pueden requerir una descarga inicial. No se garantiza reconocimiento de PDF, XML ni todos los formatos de comprobantes.

## Notificaciones y tareas programadas

Los avisos internos de pagos recurrentes, tarjetas y préstamos funcionan al ingresar a MiPistiyo. **Marcar un aviso como leído no confirma ningún pago.** Las fechas habituales de tarjeta o préstamo son orientativas si no existe un estado de cuenta confirmado.

Para generar avisos con la aplicación cerrada y activar el correo opcional, la implementación contempla estas variables **del servidor**:

```dotenv
CRON_SECRET=CLAVE_LARGA_ALEATORIA
SUPABASE_SERVICE_ROLE_KEY=CLAVE_PRIVADA_SUPABASE
RESEND_API_KEY=CLAVE_RESEND
RESEND_FROM=MiPistiyo <avisos@tudominio.com>
NEXT_PUBLIC_APP_URL=https://tu-dominio.com
```

**Nunca** coloqués `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET` o `RESEND_API_KEY` en variables `NEXT_PUBLIC_*`, código cliente o Git. Verificá tu dominio y remitente en Resend antes de habilitar el correo.

El archivo `vercel.json` del módulo configura una ejecución diaria:

```json
{
  "crons": [
    {
      "path": "/api/cron/notifications",
      "schedule": "0 14 * * *"
    }
  ]
}
```

`14:00 UTC` corresponde aproximadamente a las **8:00 a. m. de El Salvador**. La ejecución real depende del plan y las condiciones de Vercel. **El cron no se ejecuta desde `npm run dev`**.

El envío de correo no queda habilitado por el simple hecho de instalar el módulo: requiere credenciales, configuración en Vercel, un remitente válido y pruebas en el entorno desplegado.

## Organización del código

```text
MiPistiyo/
├── public/
│   └── brand/                         # Logo del login
├── sql/                               # Esquema y migraciones SQL
├── src/
│   ├── app/
│   │   ├── (private)/dashboard/       # Secciones financieras autenticadas
│   │   ├── auth/                      # OAuth, callback y cierre de sesión
│   │   ├── api/                       # Endpoints y cron de notificaciones
│   │   ├── layout.tsx                 # Layout raíz y metadatos
│   │   └── page.tsx                   # Acceso con Google
│   ├── components/                    # Componentes por módulo funcional
│   ├── lib/                           # Supabase, OCR y lógica auxiliar
│   └── proxy.ts                       # Gestión de sesión/cookies
├── tests/                              # Pruebas de parsers y utilidades
├── next.config.ts
├── package.json
└── vercel.json                         # Cron, cuando esté configurado
```

Algunas carpetas (`api`, `tests`, `brand` y migraciones recientes) pertenecen a los módulos incorporados después del ZIP inicial; verificá que estén presentes en el commit final.

## Despliegue en Vercel

1. Confirmá que `npm ci`, `npx tsc --noEmit` y `npm run build` terminen sin errores.
2. Importá el repositorio desde **Vercel → New Project** con preset **Next.js**.
3. Configurá en Vercel las variables públicas de Supabase y, solo si se usan, los secretos de servidor.
4. Añadí la URL de Vercel a las redirecciones permitidas de Supabase; revisá el callback OAuth en Google Cloud/Supabase.
5. Aplicá las migraciones SQL necesarias **en orden y con respaldo**, sin ejecutar scripts de reinicio.
6. Validá inicio/cierre de sesión, autorización, saldos, anulaciones, OCR y notificaciones en producción.
7. Si se habilita correo/cron, comprobá su ejecución y los logs de Vercel antes de considerarlo operativo.

> **Atención:** actualmente desarrollo local y despliegue podrían compartir el mismo proyecto Supabase. No hagás pruebas destructivas contra datos reales. Antes de abrir el acceso a más personas, realizá una revisión de permisos RLS, funciones `SECURITY DEFINER`, uso de secretos y restauración de respaldos.

## Seguridad y privacidad

- Datos financieros aislados mediante **RLS** y autorización por usuario.
- Operaciones monetarias centralizadas en funciones financieras de PostgreSQL.
- Registro de reversos y edición auditada de metadatos.
- OCR con revisión humana obligatoria.
- Credenciales privadas exclusivas del servidor.
- Respaldo manual y prueba de restauración recomendados antes de cambios estructurales.

El proyecto está en **beta privada** y no sustituye el estado de cuenta oficial de un banco o entidad financiera. Las operaciones históricas importadas parcialmente pueden producir reportes mensuales incompletos.

## Estado y próximos pasos

MiPistiyo cuenta con sus módulos financieros principales integrados y ha pasado pruebas locales de compilación durante su desarrollo. **Aún están pendientes una auditoría de seguridad integral, pruebas automatizadas de punta a punta, restauración ensayada de la base de datos y validación del despliegue público.**

Mejoras consideradas: conciliación bancaria, reportes ampliados, PWA y notificaciones push.

---

<div align="center">

**MiPistiyo** · Tu pisto, bajo control. 💚

</div>