# Informe de auditoría — MiPistiyo

Fecha de revisión: 15 de octubre de 2026.

Se conservan las 18 tablas, las 7 vistas, `operations`, `ledger_entries`, los procedimientos financieros, presupuestos, recurrencias, whitelist, RLS, idempotencia y reversos. Se añadió un tipo (`loan_balance_mode`) y columnas de control donde la distinción no podía inferirse de forma segura.

| Problema encontrado | Severidad | Objeto afectado | Corrección implementada | Justificación técnica |
|---|---|---|---|---|
| Un saldo inicial de préstamo podía coexistir con un desembolso del mismo principal | Crítica | `loans`, `post_loan_disbursement` | `balance_mode` distingue `OPENING_BALANCE` de `TRACKED_DISBURSEMENTS`; un préstamo de apertura no admite desembolsos | Evita duplicar activo y pasivo por la misma deuda histórica |
| Los desembolsos podían superar el principal contractual después de amortizaciones | Crítica | `post_loan_disbursement` | Se suma el principal bruto desembolsado no anulado y se limita a `original_amount` | Un préstamo no revolvente no recupera cupo al amortizar capital |
| Dos operaciones concurrentes podían calcular sobre el mismo saldo | Crítica | Todas las RPC financieras | Bloqueo asesor transaccional por usuario, más `FOR UPDATE` sobre entidades | Serializa las mutaciones de un usuario y elimina carreras entre pagos, transferencias y reversos |
| Reintentos HTTP dependían de MD5 y no incluían explícitamente tipo/reverso en el hash | Alta | `begin_operation`, `operations` | SHA-256 sobre tipo, objetivo de reverso y payload canónico; clave única por usuario | Refuerza identidad de la solicitud y detecta reutilización con otros parámetros |
| Salidas de cuenta podían crear saldos negativos sin autorización | Crítica | `accounts`, pagos, gastos, transferencias y ajustes | `allow_overdraft`; validación del saldo bajo bloqueo antes de cada débito | El sobregiro pasa a ser una decisión explícita de la cuenta |
| Reversar ingresos/desembolsos/transferencias podía dejar una cuenta negativa | Crítica | `reverse_operation` | Agrupa el efecto inverso por entidad, bloquea y valida cuentas, tarjetas y préstamos antes de asentar | Impide reversos parciales o financieramente imposibles |
| El pago de tarjeta podía competir con compras u otro pago | Crítica | `post_card_payment` | Serialización, bloqueo de cuenta/tarjeta/estado, validación de fondos, deuda y saldo del estado | Evita sobrepagos y pagos duplicados concurrentes |
| No había política explícita para sobrelímite de tarjetas | Alta | `cards`, `post_transaction`, `v_card_balances` | `enforce_credit_limit` configurable; por defecto permite reflejar la realidad bancaria; la vista expone crédito negativo y `over_limit_amount` | Los cargos reales pueden exceder el límite, pero una instalación puede optar por rechazo estricto |
| Un pago de tarjeta podía confundirse con gasto | Alta | `post_card_payment`, vistas mensuales | El pago solo genera movimientos de activo/pasivo, nunca una fila `transactions` | La compra ya reconoció el gasto; el pago no debe duplicarlo |
| Los intereses/comisiones de préstamo podían mezclarse con capital | Alta | `post_loan_payment` | Solo `principal` reduce el pasivo; interés y comisión crean gastos separados una vez | Mantiene la identidad patrimonial y la clasificación del flujo |
| Las vistas mensuales anulaban por compensación en el mes del reverso | Alta | Vistas mensuales y presupuestos | Excluyen la operación original anulada y la operación `REVERSAL` | Una operación anulada desaparece también del mes histórico y no contamina otro mes |
| El dashboard no exponía patrimonio neto | Media | `get_dashboard` | Añadido `net_worth = cash_available - credit_debt - loan_debt` | Completa la métrica financiera solicitada sin joins multiplicativos |
| La generación recurrente no tenía una vía segura para cron global | Alta | Recurrencias | RPC global exclusiva de `service_role`; RPC individual para usuario; ambas solo crean pendientes | Next.js/Vercel puede ejecutar el cron sin suplantar usuarios ni contabilizar automáticamente |
| Una regla con más de 100 ocurrencias podía avanzar parcialmente | Alta | Generación recurrente | El exceso lanza excepción y revierte toda la llamada | Evita perder fechas por avance parcial de `next_on` |
| Confirmaciones y cancelaciones recurrentes podían competir | Alta | `post_recurring_occurrence`, `skip_recurring_occurrence` | Bloqueo por usuario y de la ocurrencia; estado y clave idempotente verificados | Una ocurrencia solo puede confirmarse o cancelarse una vez |
| Historial de importación no identificaba el contenido del respaldo | Alta | `import_history` | `source_sha256`, versión, métricas de éxito/fallo, metadata, finalización y unicidad por usuario | Permite deduplicación, trazabilidad y evolución del formato JSON |
| La whitelist aceptaba espacios y validación de correo demasiado débil | Media | `allowed_users` | Correo sin espacios periféricos, longitud y patrón básico, comparación `citext` | Reduce duplicados y errores de autorización por normalización |
| Desactivar sobregiro en una cuenta ya negativa dejaba una configuración incoherente | Media | Trigger de cuentas | Trigger impide desactivarlo mientras el saldo sea negativo | Conserva la invariante declarada por la cuenta |
| Funciones `SECURITY DEFINER` podían quedar ejecutables por privilegio público predeterminado | Crítica | Funciones públicas/privadas | Revocación explícita a `PUBLIC`, `anon`, `authenticated`; grants por firma y `search_path=''` | Reduce escalamiento y resolución maliciosa de objetos |
| `user_id` podía ser objetivo de manipulación si se concedían actualizaciones amplias | Crítica | Tablas con RLS | `UPDATE` solo por columnas permitidas; nunca se concede `user_id`, IDs ni saldos de apertura | RLS y privilegios de columna se complementan |
| Las vistas podían depender de privilegios del propietario | Alta | 7 vistas | Todas usan `security_invoker=true` y tablas base con RLS | Una consulta directa no puede cruzar propietarios |

## Evidencia obtenida

- El esquema completo compiló desde cero en una instancia descartable PostgreSQL 18 con stubs de los roles y funciones de Supabase.
- Se verificaron 18 tablas con RLS, 33 políticas y 7 vistas `security_invoker`.
- `002_validation_tests.sql` se ejecutó completo y llegó a `OK: todas las pruebas de MiPistiyo finalizaron`; terminó con `ROLLBACK`.
- Una prueba real con dos conexiones concurrentes y la misma clave devolvió el mismo UUID en ambas: quedó `operations=1`, `ledger=1` y el saldo se debitó una sola vez.
- No se ejecutó contra un proyecto Supabase hospedado real. Por ello todavía debe hacerse la validación de integración del hook, Google OAuth, PostgREST y la versión concreta de PostgreSQL del proyecto descartable de Supabase.

## Decisiones funcionales explícitas

- Tarjetas: el sobrelímite es visible y permitido por defecto; `enforce_credit_limit=true` activa rechazo estricto para compras registradas por `post_transaction`. Los ajustes bancarios siguen pudiendo reflejar deuda real.
- Pagos anticipados: se permiten antes del vencimiento y sin `statement_id`, hasta la deuda corriente; no se permiten sobrepagos que creen deuda negativa.
- Préstamos históricos: se crean con `balance_mode='OPENING_BALANCE'` y `opening_debt>0`; no se llama al desembolso.
- Préstamos nuevos: se crean con `balance_mode='TRACKED_DISBURSEMENTS'`, `opening_debt=0`, y cada entrega de fondos pasa por `post_loan_disbursement`.
- Reversos: son asientos opuestos auditables. Si el inverso violaría una invariante de saldo, se rechaza y debe resolverse mediante una operación económica válida o un ajuste justificado.
