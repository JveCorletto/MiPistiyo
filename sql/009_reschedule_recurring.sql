-- MiPistiyo · 009_reschedule_recurring_CORREGIDO.sql
-- Requiere 001 (recurrencias) y 008 (notificaciones).
-- Permite editar datos y reprogramar SOLO vencimientos PENDING de una regla.
-- No toca operaciones, ledger_entries ni vencimientos CONFIRMED / SKIPPED.
BEGIN;

CREATE OR REPLACE FUNCTION public.update_recurring_rule(
  p_rule uuid,
  p_name text,
  p_amount numeric,
  p_notes text,
  p_change_schedule boolean DEFAULT false,
  p_frequency public.recurrence_frequency DEFAULT NULL,
  p_next_on date DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user uuid := app_private.require_user();
  v_rule public.recurring_transactions%ROWTYPE;
  v_today date := (now() AT TIME ZONE 'America/El_Salvador')::date;
  v_first_pending date;
  v_rescheduled boolean := false;
  v_max_past_days integer;
BEGIN
  IF p_rule IS NULL THEN
    RAISE EXCEPTION 'Identificador de recurrencia obligatorio';
  END IF;
  IF p_name IS NULL OR length(btrim(p_name)) NOT BETWEEN 1 AND 120 THEN
    RAISE EXCEPTION 'Nombre inválido (1 a 120 caracteres)';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 OR p_amount > 999999999999.99
     OR round(p_amount, 2) <> p_amount THEN
    RAISE EXCEPTION 'Importe inválido (máximo dos decimales)';
  END IF;
  IF p_notes IS NOT NULL AND length(p_notes) > 1000 THEN
    RAISE EXCEPTION 'Las notas exceden los 1000 caracteres';
  END IF;

  -- Mismo candado que la generación y confirmación de pagos.
  PERFORM app_private.lock_financial_user(v_user);
  SELECT * INTO v_rule
  FROM public.recurring_transactions
  WHERE id = p_rule AND user_id = v_user
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Recurrencia no encontrada';
  END IF;
  IF v_rule.status = 'ENDED' THEN
    RAISE EXCEPTION 'No se puede editar una recurrencia finalizada';
  END IF;

  IF coalesce(p_change_schedule, false) THEN
    IF p_frequency IS NULL OR p_next_on IS NULL THEN
      RAISE EXCEPTION 'Seleccioná la nueva frecuencia y fecha';
    END IF;
    -- Evitar CASE ... THEN dentro de la expresión IF de PL/pgSQL.
    -- La fecha se valida antes de modificar vencimientos.
    IF p_frequency = 'DAILY' THEN
      v_max_past_days := 30;
    ELSE
      v_max_past_days := 90;
    END IF;

    IF p_next_on < (v_today - v_max_past_days)
       OR p_next_on > (v_today + 1825) THEN
      RAISE EXCEPTION 'Fecha fuera de rango (máximo 30 días atrás para reglas diarias y 90 para las demás)';
    END IF;

    -- next_on es un cursor: la generación lo adelanta 45+ días.
    -- Si hay pendientes, el primero es la fecha visible al usuario.
    SELECT min(scheduled_on) INTO v_first_pending
    FROM public.recurring_occurrences
    WHERE user_id = v_user AND recurring_id = p_rule AND status = 'PENDING';

    v_rescheduled := (
      p_frequency IS DISTINCT FROM v_rule.frequency OR
      p_next_on IS DISTINCT FROM coalesce(v_first_pending, v_rule.next_on)
    );

    IF v_rescheduled THEN
      IF EXISTS (
        SELECT 1 FROM public.recurring_occurrences
        WHERE user_id = v_user AND recurring_id = p_rule
          AND scheduled_on = p_next_on AND status <> 'PENDING'
      ) THEN
        RAISE EXCEPTION 'La fecha elegida ya tiene un vencimiento confirmado u omitido. Elegí otra fecha';
      END IF;

      -- Guardamos las notificaciones anteriores como leídas y reprogramadas,
      -- para que no continúen figurando como avisos vigentes.
      UPDATE public.notifications n
      SET read_at = coalesce(n.read_at, now()),
          message = 'Aviso archivado porque se reprogramó la recurrencia.'
      WHERE n.user_id = v_user AND n.kind = 'RECURRING'
        AND EXISTS (
          SELECT 1 FROM public.recurring_occurrences o
          WHERE o.id = n.entity_id AND o.user_id = v_user
            AND o.recurring_id = p_rule AND o.status = 'PENDING'
        );

      -- ¡Nunca borrar CONFIRMED o SKIPPED! Son parte del historial.
      DELETE FROM public.recurring_occurrences
      WHERE user_id = v_user AND recurring_id = p_rule AND status = 'PENDING';
    END IF;
  END IF;

  UPDATE public.recurring_transactions
  SET name = btrim(p_name),
      amount = p_amount,
      notes = nullif(btrim(p_notes), ''),
      frequency = CASE WHEN v_rescheduled THEN p_frequency ELSE frequency END,
      anchor_day = CASE WHEN v_rescheduled THEN
        CASE WHEN p_frequency IN ('MONTHLY', 'YEARLY') THEN extract(day from p_next_on)::smallint
             ELSE NULL::smallint END
        ELSE anchor_day END,
      next_on = CASE WHEN v_rescheduled THEN p_next_on ELSE next_on END
  WHERE id = p_rule AND user_id = v_user;

  RETURN v_rescheduled;
END;
$$;

REVOKE ALL ON FUNCTION public.update_recurring_rule(uuid,text,numeric,text,boolean,public.recurrence_frequency,date)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_recurring_rule(uuid,text,numeric,text,boolean,public.recurrence_frequency,date)
  TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;