-- 002_validation_tests.sql
-- Pruebas destructivas únicamente dentro de una transacción con ROLLBACK.
-- EJECUTAR SOLO EN UN PROYECTO DESCARTABLE, como propietario desde SQL Editor,
-- inmediatamente después de 001_initial_schema_corrected.sql.
--
-- El script crea tres filas temporales en auth.users para simular sesiones. No
-- debe usarse en producción: allí los usuarios se crean mediante Supabase Auth.

BEGIN;

CREATE FUNCTION pg_temp.assert_true(p_condition boolean,p_message text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_condition IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'ASSERT FAILED: %',p_message;
  END IF;
END;
$$;

CREATE FUNCTION pg_temp.assert_raises(
  p_sql text,p_expected_fragment text,p_message text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_message text;
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_message=MESSAGE_TEXT;
    IF p_expected_fragment IS NULL
       OR position(lower(p_expected_fragment) IN lower(v_message))>0 THEN
      RETURN;
    END IF;
    RAISE EXCEPTION 'ASSERT FAILED: %; error inesperado: %',p_message,v_message;
  END;
  RAISE EXCEPTION 'ASSERT FAILED: %; se esperaba una excepción',p_message;
END;
$$;

CREATE TEMP TABLE test_state(
  key text PRIMARY KEY,
  value_uuid uuid,
  value_numeric numeric,
  value_text text
) ON COMMIT DROP;
GRANT ALL ON test_state TO authenticated;

-- UUID fijos, reservados únicamente para esta transacción de prueba.
INSERT INTO public.allowed_users(email) VALUES
  ('mipistiyo.test.one@example.com'),
  ('mipistiyo.test.two@example.com');

-- En un proyecto descartable, esta inserción simula lo que GoTrue crea. El
-- ROLLBACK final elimina las filas y todos sus efectos.
INSERT INTO auth.users(id,email,email_confirmed_at,raw_user_meta_data)
VALUES
  ('00000000-0000-0000-0000-000000000001','mipistiyo.test.one@example.com',now(),'{"name":"Usuario Uno"}'::jsonb),
  ('00000000-0000-0000-0000-000000000002','mipistiyo.test.two@example.com',now(),'{"name":"Usuario Dos"}'::jsonb),
  ('00000000-0000-0000-0000-000000000003','mipistiyo.not.allowed@example.com',now(),'{"name":"No Autorizado"}'::jsonb);

-- 1-2. Alta autorizada y rechazo por hook.
SELECT pg_temp.assert_true(
  public.before_user_created('{"user":{"email":"mipistiyo.test.one@example.com"}}'::jsonb)='{}'::jsonb,
  'el hook debe aceptar un correo activo');
SELECT pg_temp.assert_true(
  public.before_user_created('{"user":{"email":"mipistiyo.not.allowed@example.com"}}'::jsonb)->'error'->>'http_code'='403',
  'el hook debe rechazar un correo no autorizado');
SELECT pg_temp.assert_true(
  (SELECT count(*)=2 FROM public.profiles
   WHERE user_id IN ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002')),
  'el trigger debe crear perfiles solo para usuarios autorizados');
SELECT pg_temp.assert_true(
  NOT EXISTS(SELECT 1 FROM public.profiles
             WHERE user_id='00000000-0000-0000-0000-000000000003'),
  'no debe crear perfil para usuario fuera de whitelist');

-- 3. Catálogos de ambos usuarios; RLS se prueba cambiando rol y JWT simulado.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
SELECT pg_temp.assert_true(public.is_authorized(),'usuario 1 debe estar autorizado');

INSERT INTO public.accounts(id,user_id,name,kind,opening_balance)
VALUES
 ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','Efectivo','CASH',1000),
 ('10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001','Banco','BANK',200);

INSERT INTO public.categories(id,user_id,kind,name,sort_order) VALUES
 ('20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','INCOME','Salario prueba',1),
 ('20000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001','EXPENSE','Compras prueba',1),
 ('20000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000001','EXPENSE','Intereses prueba',2),
 ('20000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000001','EXPENSE','Comisiones prueba',3);

INSERT INTO public.cards(
 id,user_id,kind,name,account_id,credit_limit,opening_debt,
 cutoff_day,due_day,enforce_credit_limit)
VALUES
 ('30000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','DEBIT','Débito prueba',
  '10000000-0000-0000-0000-000000000001',NULL,NULL,NULL,NULL,false),
 ('30000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001','CREDIT','Crédito prueba',
  NULL,300,50,15,5,false);
SELECT pg_temp.assert_raises(
  $$INSERT INTO public.cards(user_id,kind,name)
    VALUES('00000000-0000-0000-0000-000000000001','CREDIT','Crédito incompleto')$$,
  'card_fields','una tarjeta de crédito no puede omitir límite, deuda y fechas');

INSERT INTO public.loans(
 id,user_id,name,lender,original_amount,opening_debt,balance_mode,started_on)
VALUES
 ('40000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001',
  'Préstamo existente','Banco A',1000,600,'OPENING_BALANCE',current_date-365),
 ('40000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001',
  'Préstamo nuevo','Banco B',500,0,'TRACKED_DISBURSEMENTS',current_date);

INSERT INTO public.credit_card_statements(
 id,user_id,card_id,period_start,period_end,due_on,statement_balance,minimum_payment)
VALUES(
 '50000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001',
 '30000000-0000-0000-0000-000000000002',
 date_trunc('month',current_date)::date,
 (date_trunc('month',current_date)+interval '14 days')::date,
 (date_trunc('month',current_date)+interval '25 days')::date,50,10);

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',true);
INSERT INTO public.accounts(id,user_id,name,kind,opening_balance)
VALUES('10000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000002',
       'Cuenta usuario 2','BANK',999);

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
SELECT pg_temp.assert_true((SELECT count(*)=2 FROM public.accounts),
  'RLS debe ocultar la cuenta del usuario 2');
SELECT pg_temp.assert_raises(
  $$INSERT INTO public.accounts(user_id,name,kind) VALUES
    ('00000000-0000-0000-0000-000000000002','Ataque','CASH')$$,
  'row-level security','RLS debe impedir insertar para otro usuario');
SELECT pg_temp.assert_raises(
  $$INSERT INTO public.ledger_entries(user_id,operation_id,entry_no,account_id,delta)
    VALUES('00000000-0000-0000-0000-000000000001',gen_random_uuid(),1,
           '10000000-0000-0000-0000-000000000001',1)$$,
  'permission denied','el cliente no debe escribir el ledger directamente');

-- 4. Ingreso e idempotencia.
INSERT INTO test_state(key,value_uuid)
SELECT 'income_op',public.post_transaction(
 'INCOME','20000000-0000-0000-0000-000000000001',100,
 '10000000-0000-0000-0000-000000000001',NULL,current_date,
 'Ingreso de prueba','test-income-0001');
SELECT pg_temp.assert_true(
  (SELECT value_uuid FROM test_state WHERE key='income_op')=public.post_transaction(
   'INCOME','20000000-0000-0000-0000-000000000001',100,
   '10000000-0000-0000-0000-000000000001',NULL,current_date,
   'Ingreso de prueba','test-income-0001'),
  'un reintento idéntico debe devolver la misma operación');
SELECT pg_temp.assert_raises(
  $$SELECT public.post_transaction(
    'INCOME','20000000-0000-0000-0000-000000000001',101,
    '10000000-0000-0000-0000-000000000001',NULL,current_date,
    'Ingreso de prueba','test-income-0001')$$,
  'otros parámetros','una clave no puede reutilizarse con otro payload');

-- 5-7. Gasto en efectivo, débito y crédito (sobrelímite permitido por config).
INSERT INTO test_state(key,value_uuid)
SELECT 'cash_expense_op',public.post_transaction(
 'EXPENSE','20000000-0000-0000-0000-000000000002',40,
 '10000000-0000-0000-0000-000000000001',NULL,current_date,
 'Gasto en efectivo','test-expense-0001');
SELECT public.post_transaction(
 'EXPENSE','20000000-0000-0000-0000-000000000002',30,
 NULL,'30000000-0000-0000-0000-000000000001',current_date,
 'Compra débito','test-debit-00001');
SELECT public.post_transaction(
 'EXPENSE','20000000-0000-0000-0000-000000000002',350,
 NULL,'30000000-0000-0000-0000-000000000002',current_date,
 'Compra crédito sobre límite','test-credit-0001');
SELECT pg_temp.assert_true(
  (SELECT current_debt=400 AND available_credit=-100 AND over_limit_amount=100
   FROM public.v_card_balances
   WHERE id='30000000-0000-0000-0000-000000000002'),
  'la vista debe exponer deuda y crédito negativo sin ocultar el sobrelímite');

-- Configuración estricta: una compra posterior sobre límite se rechaza.
UPDATE public.cards SET enforce_credit_limit=true
WHERE id='30000000-0000-0000-0000-000000000002';
SELECT pg_temp.assert_raises(
  $$SELECT public.post_transaction(
    'EXPENSE','20000000-0000-0000-0000-000000000002',1,NULL,
    '30000000-0000-0000-0000-000000000002',current_date,
    'Debe fallar','test-credit-limit')$$,
  'supera el límite','la política estricta debe rechazar una compra sobre límite');
UPDATE public.cards SET enforce_credit_limit=false
WHERE id='30000000-0000-0000-0000-000000000002';

-- 8. Pago anticipado/parcial de tarjeta: reduce activo y pasivo, no crea gasto.
INSERT INTO test_state(key,value_uuid)
SELECT 'card_payment_op',public.post_card_payment(
 '30000000-0000-0000-0000-000000000002',
 '10000000-0000-0000-0000-000000000001',100,NULL,current_date,
 'Pago anticipado parcial','test-cardpay-001');
SELECT pg_temp.assert_true(
  (SELECT current_debt=300 FROM public.v_card_balances
   WHERE id='30000000-0000-0000-0000-000000000002'),
  'el pago debe reducir la deuda de tarjeta');
SELECT pg_temp.assert_true(
  NOT EXISTS(SELECT 1 FROM public.transactions
             WHERE operation_id=(SELECT value_uuid FROM test_state WHERE key='card_payment_op')),
  'el pago de tarjeta no debe duplicar el gasto de la compra');
SELECT pg_temp.assert_raises(
  $$SELECT public.post_card_payment(
    '30000000-0000-0000-0000-000000000002',
    '10000000-0000-0000-0000-000000000001',301,NULL,current_date,
    'Sobrepago','test-cardpay-bad')$$,
  'mayor que deuda','no se permite saldo acreedor accidental en tarjeta');

-- 9. Transferencia: suma de activos invariable.
SELECT public.post_transfer(
 '10000000-0000-0000-0000-000000000001',
 '10000000-0000-0000-0000-000000000002',50,current_date,
 'Transferencia prueba','test-transfer-01');
SELECT pg_temp.assert_true(
  (SELECT sum(current_balance)=1130 FROM public.v_account_balances),
  'la transferencia no debe modificar activos totales');

-- 10-11. Préstamo existente versus desembolso nuevo.
SELECT pg_temp.assert_raises(
  $$SELECT public.post_loan_disbursement(
    '40000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000002',600,current_date,
    'Duplicado indebido','test-loan-old-1')$$,
  'deuda inicial','un préstamo existente no puede desembolsarse otra vez');
INSERT INTO test_state(key,value_uuid)
SELECT 'loan_disbursement_op',public.post_loan_disbursement(
 '40000000-0000-0000-0000-000000000002',
 '10000000-0000-0000-0000-000000000002',500,current_date,
 'Desembolso nuevo','test-loan-new-1');
SELECT pg_temp.assert_true(
  (SELECT current_debt=500 FROM public.v_loan_balances
   WHERE id='40000000-0000-0000-0000-000000000002'),
  'el desembolso nuevo debe crear exactamente 500 de deuda');
SELECT pg_temp.assert_raises(
  $$SELECT public.post_loan_disbursement(
    '40000000-0000-0000-0000-000000000002',
    '10000000-0000-0000-0000-000000000002',1,current_date,
    'Exceso','test-loan-new-2')$$,
  'superan el monto original','no se debe redibujar principal ya amortizado');

-- 12-13. Abono parcial, intereses y comisiones.
INSERT INTO test_state(key,value_uuid)
SELECT 'loan_partial_op',public.post_loan_payment(
 '40000000-0000-0000-0000-000000000002',
 '10000000-0000-0000-0000-000000000001',100,10,5,
 '20000000-0000-0000-0000-000000000003',
 '20000000-0000-0000-0000-000000000004',current_date,
 'Cuota parcial','test-loan-pay-1');
SELECT pg_temp.assert_true(
  (SELECT current_debt=400 FROM public.v_loan_balances
   WHERE id='40000000-0000-0000-0000-000000000002'),
  'solo el principal debe reducir la deuda');
SELECT pg_temp.assert_true(
  (SELECT coalesce(sum(amount),0)=15 FROM public.transactions
   WHERE operation_id=(SELECT value_uuid FROM test_state WHERE key='loan_partial_op')),
  'interés y comisión deben registrarse una vez como gasto');

-- Pago total válido y abono extra inválido.
INSERT INTO test_state(key,value_uuid)
SELECT 'loan_full_op',public.post_loan_payment(
 '40000000-0000-0000-0000-000000000002',
 '10000000-0000-0000-0000-000000000002',400,0,0,NULL,NULL,current_date,
 'Cancelación total','test-loan-pay-2');
SELECT pg_temp.assert_true(
  (SELECT current_debt=0 FROM public.v_loan_balances
   WHERE id='40000000-0000-0000-0000-000000000002'),
  'el pago total debe dejar deuda cero');
SELECT pg_temp.assert_raises(
  $$SELECT public.post_loan_payment(
    '40000000-0000-0000-0000-000000000002',
    '10000000-0000-0000-0000-000000000002',0.01,0,0,NULL,NULL,current_date,
    'Pago extra','test-loan-pay-x')$$,
  'supera saldo','no se permite capital negativo por sobrepago');

-- 14. Reverso de pago total restaura deuda y cuenta; reverso repetido falla.
INSERT INTO test_state(key,value_uuid)
SELECT 'loan_full_reversal',public.reverse_operation(
 (SELECT value_uuid FROM test_state WHERE key='loan_full_op'),current_date,
 'Reverso pago total','test-reversal-01');
SELECT pg_temp.assert_true(
  (SELECT current_debt=400 FROM public.v_loan_balances
   WHERE id='40000000-0000-0000-0000-000000000002'),
  'reversar el pago debe restaurar exactamente el principal');
SELECT pg_temp.assert_raises(
  format($q$SELECT public.reverse_operation('%s',current_date,
    'Segundo reverso','test-reversal-02')$q$,
    (SELECT value_uuid FROM test_state WHERE key='loan_full_op')),
  'Idempotency key','una operación no puede tener dos reversos');

-- Reversar el gasto en efectivo y verificar que desaparece del flujo, aunque
-- el reverso fuese contabilizado en otra fecha.
SELECT public.reverse_operation(
 (SELECT value_uuid FROM test_state WHERE key='cash_expense_op'),current_date+1,
 'Gasto anulado','test-reversal-03');
SELECT pg_temp.assert_true(
  NOT EXISTS(
    SELECT 1 FROM public.v_monthly_category_expenses x
    JOIN public.transactions t ON t.category_id=x.category_id
    WHERE t.operation_id=(SELECT value_uuid FROM test_state WHERE key='cash_expense_op')
      AND x.spent=420
  ),
  'una operación anulada no debe permanecer en el flujo mensual');

-- 15-17. Idempotencia, saldos y ledger ya ejercitados; comprobar invariantes.
SELECT pg_temp.assert_true(
  NOT EXISTS(
    SELECT 1 FROM public.v_card_balances WHERE kind='CREDIT' AND current_debt<0
  ) AND NOT EXISTS(
    SELECT 1 FROM public.v_loan_balances WHERE current_debt<0
  ),'ninguna deuda puede ser negativa');
SELECT pg_temp.assert_true(
  NOT EXISTS(
    SELECT 1
    FROM public.operations o
    LEFT JOIN public.ledger_entries le
      ON le.user_id=o.user_id AND le.operation_id=o.id
    WHERE o.user_id='00000000-0000-0000-0000-000000000001'
    GROUP BY o.id HAVING count(le.id)=0
  ),'cada operación financiera debe tener ledger');
SELECT pg_temp.assert_true(
  NOT EXISTS(
    SELECT 1
    FROM public.operations r
    JOIN public.ledger_entries re ON re.operation_id=r.id AND re.user_id=r.user_id
    JOIN public.ledger_entries oe
      ON oe.operation_id=r.reversal_of AND oe.user_id=r.user_id
     AND oe.entry_no=re.entry_no
    WHERE r.kind='REVERSAL' AND re.delta<>-oe.delta
  ),'cada asiento de reverso debe ser el opuesto exacto');

-- 18. Presupuesto: no cuenta pago de tarjeta ni gasto anulado.
INSERT INTO public.budgets(
 id,user_id,month_start,category_id,amount)
VALUES(
 '70000000-0000-0000-0000-000000000001',
 '00000000-0000-0000-0000-000000000001',
 date_trunc('month',current_date)::date,
 '20000000-0000-0000-0000-000000000002',500);
SELECT pg_temp.assert_true(
  (SELECT spent=380 FROM public.v_budget_progress
   WHERE id='70000000-0000-0000-0000-000000000001'),
  'presupuesto debe sumar débito+crédito, excluir gasto anulado y pago de tarjeta');

-- 19. Recurrencias: pendiente no mueve saldo, reejecución no duplica,
-- confirmación mueve una sola vez y la siguiente ocurrencia puede cancelarse.
INSERT INTO public.recurring_transactions(
 id,user_id,name,kind,category_id,amount,account_id,frequency,next_on)
VALUES(
 '60000000-0000-0000-0000-000000000001',
 '00000000-0000-0000-0000-000000000001','Diario prueba','EXPENSE',
 '20000000-0000-0000-0000-000000000002',25,
 '10000000-0000-0000-0000-000000000001','DAILY',current_date);
INSERT INTO test_state(key,value_numeric)
SELECT 'balance_before_pending',current_balance
FROM public.v_account_balances
WHERE id='10000000-0000-0000-0000-000000000001';
SELECT pg_temp.assert_true(public.generate_pending_occurrences(current_date)=1,
  'primera generación debe crear una ocurrencia');
SELECT pg_temp.assert_true(public.generate_pending_occurrences(current_date)=0,
  'segunda generación no debe duplicarla');
SELECT pg_temp.assert_true(
  (SELECT current_balance=(SELECT value_numeric FROM test_state WHERE key='balance_before_pending')
   FROM public.v_account_balances
   WHERE id='10000000-0000-0000-0000-000000000001'),
  'una ocurrencia pendiente no debe afectar saldo');
INSERT INTO test_state(key,value_uuid)
SELECT 'occurrence_id',id FROM public.recurring_occurrences
WHERE recurring_id='60000000-0000-0000-0000-000000000001'
  AND scheduled_on=current_date;
INSERT INTO test_state(key,value_uuid)
SELECT 'recurring_op',public.post_recurring_occurrence(
 (SELECT value_uuid FROM test_state WHERE key='occurrence_id'),
 'Confirmación recurrente','test-recurring-1');
SELECT pg_temp.assert_true(
  (SELECT status='CONFIRMED' FROM public.recurring_occurrences
   WHERE id=(SELECT value_uuid FROM test_state WHERE key='occurrence_id')),
  'la ocurrencia debe quedar confirmada');
SELECT pg_temp.assert_true(
  (SELECT value_uuid FROM test_state WHERE key='recurring_op')=
  public.post_recurring_occurrence(
    (SELECT value_uuid FROM test_state WHERE key='occurrence_id'),
    'Confirmación recurrente','test-recurring-1'),
  'reintentar confirmación debe devolver la misma operación');
SELECT pg_temp.assert_true(public.generate_pending_occurrences(current_date+1)=1,
  'debe crear la siguiente ocurrencia diaria');
SELECT public.skip_recurring_occurrence(id)
FROM public.recurring_occurrences
WHERE recurring_id='60000000-0000-0000-0000-000000000001'
  AND scheduled_on=current_date+1;
SELECT pg_temp.assert_true(
  (SELECT status='SKIPPED' FROM public.recurring_occurrences
   WHERE recurring_id='60000000-0000-0000-0000-000000000001'
     AND scheduled_on=current_date+1),
  'la ocurrencia pendiente debe poder cancelarse');

-- El cron global no queda expuesto a authenticated.
SELECT pg_temp.assert_true(
  NOT has_function_privilege('authenticated',
    'public.generate_pending_occurrences_all(date)','EXECUTE')
  AND has_function_privilege('service_role',
    'public.generate_pending_occurrences_all(date)','EXECUTE'),
  'solo service_role debe ejecutar el generador global');

-- 20. Seguridad de las siete vistas.
SELECT pg_temp.assert_true(
  (SELECT count(*)=7 FROM information_schema.views
   WHERE table_schema='public' AND table_name LIKE 'v\_%' ESCAPE '\'),
  'deben existir siete vistas financieras');
SELECT pg_temp.assert_true(
  NOT EXISTS(
    SELECT 1 FROM public.v_account_balances
    WHERE user_id='00000000-0000-0000-0000-000000000002'
  ),'las vistas deben respetar RLS');
SELECT pg_temp.assert_true(
  (SELECT net_worth=cash_available-total_debt
   FROM public.get_dashboard(current_date)),
  'patrimonio neto debe ser activos menos deudas');

-- Casos límite adicionales: sin sobregiro, aislamiento y revocación inmediata.
SELECT pg_temp.assert_raises(
  $$SELECT public.post_transfer(
    '10000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000002',999999,current_date,
    'Sin fondos','test-no-funds-1')$$,
  'Fondos insuficientes','no debe permitir saldo negativo sin sobregiro');

RESET ROLE;
UPDATE public.allowed_users SET is_active=false
WHERE email='mipistiyo.test.one@example.com';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
SELECT pg_temp.assert_true(NOT public.is_authorized(),
  'revocar whitelist debe invalidar acceso inmediatamente');
SELECT pg_temp.assert_true((SELECT count(*)=0 FROM public.accounts),
  'RLS debe ocultar todas las filas tras revocación');
SELECT pg_temp.assert_raises(
  $$SELECT public.post_transaction(
    'INCOME','20000000-0000-0000-0000-000000000001',1,
    '10000000-0000-0000-0000-000000000001',NULL,current_date,
    'No autorizado','test-revoked-01')$$,
  'no autorizado','RPC debe rechazar al usuario revocado');

RESET ROLE;

-- Comprobaciones estructurales finales.
SELECT pg_temp.assert_true(
  (SELECT count(*)=18 FROM pg_tables WHERE schemaname='public'
   AND tablename IN(
    'allowed_users','profiles','accounts','categories','cards','loans',
    'operations','ledger_entries','transactions','transfers',
    'credit_card_statements','card_payments','loan_payments',
    'financial_adjustments','budgets','recurring_transactions',
    'recurring_occurrences','import_history')),
  'deben existir las 18 tablas previstas');
SELECT pg_temp.assert_true(
  NOT EXISTS(
    SELECT 1 FROM pg_tables
    WHERE schemaname='public' AND tablename IN(
      'allowed_users','profiles','accounts','categories','cards','loans',
      'operations','ledger_entries','transactions','transfers',
      'credit_card_statements','card_payments','loan_payments',
      'financial_adjustments','budgets','recurring_transactions',
      'recurring_occurrences','import_history')
      AND NOT rowsecurity
  ),'RLS debe estar activo en las 18 tablas');
SELECT pg_temp.assert_true(
  NOT has_table_privilege('authenticated','public.allowed_users','SELECT')
  AND NOT has_table_privilege('authenticated','public.operations','INSERT')
  AND NOT has_table_privilege('authenticated','public.ledger_entries','INSERT'),
  'whitelist y libro mayor no deben ser escribibles desde el cliente');

DO $$ BEGIN RAISE NOTICE 'OK: todas las pruebas de MiPistiyo finalizaron'; END $$;

ROLLBACK;
