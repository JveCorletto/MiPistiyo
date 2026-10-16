-- MiPistiyo · 008_notifications.sql
-- Ejecutar UNA VEZ después del esquema y las migraciones 003–007.
-- Aditiva: no modifica cuentas, operaciones, saldos ni movimientos.
BEGIN;

CREATE TABLE public.notification_preferences (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  remind_days smallint NOT NULL DEFAULT 3 CHECK (remind_days BETWEEN 0 AND 14),
  recurring_enabled boolean NOT NULL DEFAULT true,
  cards_enabled boolean NOT NULL DEFAULT true,
  loans_enabled boolean NOT NULL DEFAULT true,
  email_enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('RECURRING','CARD','LOAN')),
  entity_id uuid NOT NULL,
  due_on date NOT NULL,
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  message text NOT NULL CHECK (length(message) BETWEEN 1 AND 600),
  href text NOT NULL CHECK (href IN ('/dashboard/recurrentes','/dashboard/transferencias')),
  dedupe_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz,
  emailed_at timestamptz,
  email_claimed_at timestamptz,
  email_attempts smallint NOT NULL DEFAULT 0,
  UNIQUE (user_id,dedupe_key)
);

CREATE INDEX notifications_unread ON public.notifications(user_id,created_at DESC) WHERE read_at IS NULL;
CREATE INDEX notifications_email_queue ON public.notifications(created_at) WHERE emailed_at IS NULL AND email_attempts < 3;

ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.notification_preferences, public.notifications FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.notification_preferences TO authenticated;
GRANT UPDATE (remind_days,recurring_enabled,cards_enabled,loans_enabled,email_enabled,updated_at)
  ON public.notification_preferences TO authenticated;
GRANT SELECT ON public.notifications TO authenticated;
GRANT UPDATE (read_at) ON public.notifications TO authenticated;

CREATE POLICY notification_preferences_select ON public.notification_preferences FOR SELECT TO authenticated
  USING (user_id=(select auth.uid()) AND (select public.is_authorized()));
CREATE POLICY notification_preferences_insert ON public.notification_preferences FOR INSERT TO authenticated
  WITH CHECK (user_id=(select auth.uid()) AND (select public.is_authorized()));
CREATE POLICY notification_preferences_update ON public.notification_preferences FOR UPDATE TO authenticated
  USING (user_id=(select auth.uid()) AND (select public.is_authorized()))
  WITH CHECK (user_id=(select auth.uid()) AND (select public.is_authorized()));
CREATE POLICY notifications_select ON public.notifications FOR SELECT TO authenticated
  USING (user_id=(select auth.uid()) AND (select public.is_authorized()));
CREATE POLICY notifications_mark_read ON public.notifications FOR UPDATE TO authenticated
  USING (user_id=(select auth.uid()) AND (select public.is_authorized()))
  WITH CHECK (user_id=(select auth.uid()) AND (select public.is_authorized()));

-- Fecha habitual aproximada. Las deudas de tarjetas pueden tener fecha real distinta.
CREATE FUNCTION app_private.next_notification_due(p_today date,p_day int)
RETURNS date LANGUAGE sql IMMUTABLE SET search_path='' AS $$
  WITH months AS (
    SELECT (date_trunc('month',p_today::timestamp) + (g.i || ' months')::interval)::date AS start_on
    FROM generate_series(0,1) AS g(i)
  ), candidates AS (
    SELECT (m.start_on + (least(p_day,
      extract(day from (m.start_on + interval '1 month' - interval '1 day'))::int)-1))::date AS due
    FROM months m
  )
  SELECT min(due) FROM candidates WHERE due >= p_today;
$$;

CREATE FUNCTION app_private.refresh_due_notifications_user(p_user uuid,p_today date)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  p public.notification_preferences%ROWTYPE;
  v_count int := 0;
  v_rows int;
BEGIN
  INSERT INTO public.notification_preferences(user_id) VALUES(p_user)
    ON CONFLICT(user_id) DO NOTHING;
  SELECT * INTO STRICT p FROM public.notification_preferences WHERE user_id=p_user;

  -- Avisos de recurrencias ya atendidas dejan de figurar como pendientes.
  UPDATE public.notifications n SET read_at=now()
  WHERE n.user_id=p_user AND n.kind='RECURRING' AND n.read_at IS NULL
    AND EXISTS (
      SELECT 1 FROM public.recurring_occurrences o
      WHERE o.user_id=p_user AND o.id=n.entity_id AND o.status <> 'PENDING'
    );

  IF p.recurring_enabled THEN
    -- Genera vencimientos sin contabilizar pagos ni modificar saldos.
    PERFORM app_private.generate_occurrences_for_user(p_user,p_today+p.remind_days);
    INSERT INTO public.notifications (user_id,kind,entity_id,due_on,title,message,href,dedupe_key)
    SELECT o.user_id,'RECURRING',o.id,o.scheduled_on,
      'Pago programado: '||r.name,
      CASE WHEN o.scheduled_on < p_today THEN 'Pago programado vencido; revisá si ya lo realizaste.'
           WHEN o.scheduled_on = p_today THEN 'Pago programado para hoy. Confirmalo solo si ya lo realizaste.'
           ELSE 'Tu pago programado se aproxima. Confirmalo cuando lo realices.' END,
      '/dashboard/recurrentes', 'recurring:'||o.id::text
    FROM public.recurring_occurrences o
    JOIN public.recurring_transactions r ON r.id=o.recurring_id AND r.user_id=o.user_id
    WHERE o.user_id=p_user AND o.status='PENDING' AND r.status='ACTIVE' AND r.kind='EXPENSE'
      AND o.scheduled_on BETWEEN p_today-7 AND p_today+p.remind_days
    ON CONFLICT(user_id,dedupe_key) DO NOTHING;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    v_count := v_count+v_rows;
  END IF;

  IF p.cards_enabled THEN
    -- Prioridad a vencimiento de estado de cuenta, cuando existe.
    INSERT INTO public.notifications(user_id,kind,entity_id,due_on,title,message,href,dedupe_key)
    SELECT c.user_id,'CARD',c.id,s.due_on,
      'Vence estado de cuenta: '||c.name,
      'Revisá en el banco el importe exigible; pagar capital no equivale a un gasto nuevo.',
      '/dashboard/transferencias','card-statement:'||s.id::text
    FROM public.credit_card_statements s
    JOIN public.cards c ON c.id=s.card_id AND c.user_id=s.user_id
    WHERE c.user_id=p_user AND c.is_active AND c.kind='CREDIT'
      AND s.due_on BETWEEN p_today AND p_today+p.remind_days
      AND app_private.card_debt(p_user,c.id)>0
      AND s.statement_balance > (
        SELECT coalesce(sum(cp.amount),0)
        FROM public.card_payments cp
        WHERE cp.user_id=p_user AND cp.statement_id=s.id
          AND NOT EXISTS (SELECT 1 FROM public.operations rev WHERE rev.reversal_of=cp.operation_id)
      )
    ON CONFLICT(user_id,dedupe_key) DO NOTHING;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    v_count := v_count+v_rows;

    -- Si no hay estado de cuenta con vencimiento para este período: fecha habitual orientativa.
    INSERT INTO public.notifications(user_id,kind,entity_id,due_on,title,message,href,dedupe_key)
    SELECT c.user_id,'CARD',c.id,d.due,
      'Fecha habitual de tarjeta: '||c.name,
      'Aviso orientativo basado en el día configurado. Confirmá la fecha y el importe en tu banco.',
      '/dashboard/transferencias','card-estimated:'||c.id::text||':'||d.due::text
    FROM public.cards c
    CROSS JOIN LATERAL (SELECT app_private.next_notification_due(p_today,c.due_day) AS due) d
    WHERE c.user_id=p_user AND c.is_active AND c.kind='CREDIT' AND c.due_day IS NOT NULL
      AND d.due BETWEEN p_today AND p_today+p.remind_days
      AND app_private.card_debt(p_user,c.id)>0
      AND NOT EXISTS (
        SELECT 1 FROM public.credit_card_statements s
        WHERE s.user_id=p_user AND s.card_id=c.id
          AND date_trunc('month',s.due_on::timestamp)=date_trunc('month',d.due::timestamp)
      )
    ON CONFLICT(user_id,dedupe_key) DO NOTHING;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    v_count := v_count+v_rows;
  END IF;

  IF p.loans_enabled THEN
    INSERT INTO public.notifications(user_id,kind,entity_id,due_on,title,message,href,dedupe_key)
    SELECT l.user_id,'LOAN',l.id,d.due,
      'Cuota de préstamo: '||l.name,
      'Fecha habitual orientativa. Verificá cuota y vencimiento con la entidad financiera.',
      '/dashboard/transferencias','loan:'||l.id::text||':'||d.due::text
    FROM public.loans l
    CROSS JOIN LATERAL (SELECT app_private.next_notification_due(p_today,l.due_day) AS due) d
    WHERE l.user_id=p_user AND l.is_active AND l.due_day IS NOT NULL
      AND d.due BETWEEN p_today AND p_today+p.remind_days
      AND app_private.loan_debt(p_user,l.id)>0
    ON CONFLICT(user_id,dedupe_key) DO NOTHING;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    v_count := v_count+v_rows;
  END IF;
  RETURN v_count;
END;
$$;

-- El usuario solo puede generar avisos para sí mismo; no admite user_id arbitrario.
CREATE FUNCTION public.refresh_due_notifications()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  v_user uuid := app_private.require_user();
  v_today date := (now() AT TIME ZONE 'America/El_Salvador')::date;
BEGIN
  RETURN app_private.refresh_due_notifications_user(v_user,v_today);
END;
$$;

-- Exclusiva para CRON/service_role: rellena pendientes, genera avisos una vez por fecha.
CREATE FUNCTION public.run_due_notification_job()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  v_user uuid;
  v_total int := 0;
  v_today date := (now() AT TIME ZONE 'America/El_Salvador')::date;
BEGIN
  FOR v_user IN
    SELECT u.id FROM auth.users u
    JOIN public.allowed_users a ON a.email=u.email::extensions.citext
    WHERE a.is_active AND u.email_confirmed_at IS NOT NULL
    ORDER BY u.id
  LOOP
    v_total := v_total + app_private.refresh_due_notifications_user(v_user,v_today);
  END LOOP;
  RETURN v_total;
END;
$$;

-- Reclamación atómica; evita que dos workers procesen el mismo correo a la vez.
CREATE FUNCTION public.claim_notification_emails(p_limit int DEFAULT 25)
RETURNS TABLE(id uuid,user_id uuid,title text,message text,due_on date,href text)
LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
  WITH picked AS (
    SELECT n.id FROM public.notifications n
    JOIN public.notification_preferences p ON p.user_id=n.user_id
    WHERE p.email_enabled AND n.emailed_at IS NULL AND n.email_attempts<3
      AND (n.email_claimed_at IS NULL OR n.email_claimed_at < now()-interval '20 minutes')
      AND n.due_on >= (now() AT TIME ZONE 'America/El_Salvador')::date-7
      AND (
        (n.kind='RECURRING' AND EXISTS(
          SELECT 1 FROM public.recurring_occurrences o
          JOIN public.recurring_transactions r ON r.id=o.recurring_id AND r.user_id=o.user_id
          WHERE o.id=n.entity_id AND o.user_id=n.user_id AND o.status='PENDING' AND r.status='ACTIVE'))
        OR (n.kind='CARD' AND app_private.card_debt(n.user_id,n.entity_id)>0)
        OR (n.kind='LOAN' AND app_private.loan_debt(n.user_id,n.entity_id)>0)
      )
    ORDER BY n.created_at, n.id
    LIMIT greatest(1,least(coalesce(p_limit,25),25))
    FOR UPDATE OF n SKIP LOCKED
  ), claimed AS (
    UPDATE public.notifications n SET email_claimed_at=now(),email_attempts=n.email_attempts+1
    FROM picked WHERE n.id=picked.id
    RETURNING n.id,n.user_id,n.title,n.message,n.due_on,n.href
  )
  SELECT c.id,c.user_id,c.title,c.message,c.due_on,c.href FROM claimed c;
$$;

CREATE FUNCTION public.complete_notification_email(p_id uuid,p_success boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  UPDATE public.notifications SET
    emailed_at=CASE WHEN p_success THEN now() ELSE emailed_at END,
    email_claimed_at=NULL
  WHERE id=p_id;
END;
$$;

REVOKE ALL ON FUNCTION app_private.next_notification_due(date,int) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION app_private.refresh_due_notifications_user(uuid,date) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.refresh_due_notifications() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.run_due_notification_job() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.claim_notification_emails(int) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.complete_notification_email(uuid,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_due_notifications() TO authenticated;
GRANT EXECUTE ON FUNCTION public.run_due_notification_job() TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_notification_emails(int) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_notification_email(uuid,boolean) TO service_role;

COMMIT;
