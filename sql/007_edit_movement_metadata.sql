-- MiPistiyo / 007_edit_movement_metadata.sql
-- Ejecutar después de 006_advanced_history.sql. Requiere respaldo.
-- Habilita edición SOLO de metadatos, auditada, sin tocar ledger, importes,
-- cuentas, tarjetas, tipos de operación ni fechas efectivas.
BEGIN;
SET LOCAL lock_timeout = '10s';

ALTER TABLE public.operations
  ADD COLUMN IF NOT EXISTS occurred_time time(0) without time zone;
ALTER TABLE public.historical_transactions
  ADD COLUMN IF NOT EXISTS occurred_time time(0) without time zone;

-- Auditoría de modificaciones, solo lectura para el usuario propietario.
CREATE TABLE public.movement_metadata_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  movement_id uuid NOT NULL,
  origin text NOT NULL CHECK (origin IN ('OPERATION','HISTORICAL')),
  previous_description text,
  new_description text,
  previous_category_id uuid,
  new_category_id uuid,
  previous_occurred_time time(0) without time zone,
  new_occurred_time time(0) without time zone,
  changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX movement_metadata_changes_lookup
  ON public.movement_metadata_changes (user_id, origin, movement_id, changed_at DESC);
ALTER TABLE public.movement_metadata_changes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.movement_metadata_changes FROM PUBLIC,anon,authenticated;
CREATE POLICY movement_metadata_changes_read_own
  ON public.movement_metadata_changes FOR SELECT TO authenticated
  USING (user_id=(SELECT auth.uid()) AND (SELECT public.is_authorized()));
GRANT SELECT ON public.movement_metadata_changes TO authenticated;

CREATE FUNCTION public.update_movement_metadata(
  p_id uuid, p_origin text, p_description text,
  p_category_id uuid, p_occurred_time text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_user uuid := app_private.require_user();
  v_operation public.operations%ROWTYPE;
  v_transaction public.transactions%ROWTYPE;
  v_historical public.historical_transactions%ROWTYPE;
  v_description text := nullif(btrim(coalesce(p_description,'')), '');
  v_time time(0) without time zone;
  v_before_description text;
  v_before_category uuid;
  v_before_time time(0) without time zone;
  v_kind public.category_kind;
  v_category_active boolean;
  v_is_external boolean := false;
BEGIN
  IF p_id IS NULL OR p_origin IS NULL OR p_origin NOT IN ('OPERATION','HISTORICAL') THEN
    RAISE EXCEPTION 'Movimiento inválido';
  END IF;
  IF length(coalesce(v_description,'')) > 1000 THEN
    RAISE EXCEPTION 'La descripción no puede superar 1000 caracteres';
  END IF;
  IF nullif(btrim(coalesce(p_occurred_time,'')),'') IS NOT NULL THEN
    IF p_occurred_time !~ '^[0-9]{2}:[0-9]{2}$' THEN
      RAISE EXCEPTION 'La hora debe tener formato HH:MM';
    END IF;
    v_time := make_time(substring(p_occurred_time,1,2)::int,
                        substring(p_occurred_time,4,2)::int,0);
  END IF;

  PERFORM app_private.lock_financial_user(v_user);

  IF p_origin='HISTORICAL' THEN
    SELECT * INTO v_historical FROM public.historical_transactions
     WHERE id=p_id AND user_id=v_user FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Movimiento histórico no encontrado'; END IF;
    IF v_historical.voided_at IS NOT NULL THEN
      RAISE EXCEPTION 'No se puede modificar un movimiento anulado';
    END IF;
    IF p_category_id IS NULL THEN RAISE EXCEPTION 'La categoría es obligatoria'; END IF;
    v_kind := v_historical.kind;
    v_before_description := v_historical.description;
    v_before_category := v_historical.category_id;
    v_before_time := v_historical.occurred_time;

  ELSE
    SELECT * INTO v_operation FROM public.operations
     WHERE id=p_id AND user_id=v_user FOR UPDATE;
    IF NOT FOUND OR v_operation.kind='REVERSAL' THEN
      RAISE EXCEPTION 'Operación no encontrada';
    END IF;
    IF EXISTS (SELECT 1 FROM public.operations
      WHERE user_id=v_user AND reversal_of=p_id) THEN
      RAISE EXCEPTION 'No se puede modificar una operación anulada';
    END IF;
    v_before_time := v_operation.occurred_time;
    IF v_operation.kind IN ('INCOME','EXPENSE') THEN
      SELECT * INTO v_transaction FROM public.transactions
       WHERE operation_id=p_id AND user_id=v_user AND effect_sign=1 FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Detalle financiero no encontrado'; END IF;
      v_kind := v_transaction.kind;
      v_before_description := coalesce(nullif(v_transaction.description,''),nullif(v_operation.memo,''));
      v_before_category := v_transaction.category_id;
      IF p_category_id IS NULL THEN RAISE EXCEPTION 'La categoría es obligatoria'; END IF;
      v_is_external := (v_transaction.description LIKE 'Transferencia externa a:%'
                    OR v_transaction.description LIKE 'Transferencia externa de:%');
      IF v_is_external AND (
         (v_transaction.description LIKE 'Transferencia externa a:%'
           AND coalesce(v_description,'') NOT LIKE 'Transferencia externa a:%')
         OR (v_transaction.description LIKE 'Transferencia externa de:%'
           AND coalesce(v_description,'') NOT LIKE 'Transferencia externa de:%')
      ) THEN
        RAISE EXCEPTION 'Conservá el prefijo de transferencia externa para mantener su clasificación';
      END IF;
    ELSE
      IF p_category_id IS NOT NULL THEN
        RAISE EXCEPTION 'Esta operación no admite edición de categoría';
      END IF;
      v_before_description := v_operation.memo;
      v_before_category := NULL;
    END IF;
  END IF;

  IF p_category_id IS NOT NULL AND p_category_id IS DISTINCT FROM v_before_category THEN
    SELECT is_active INTO v_category_active FROM public.categories
      WHERE user_id=v_user AND id=p_category_id AND kind=v_kind;
    IF NOT FOUND OR NOT v_category_active THEN
      RAISE EXCEPTION 'Elegí una categoría activa del mismo tipo';
    END IF;
  END IF;

  IF v_before_description IS NOT DISTINCT FROM v_description
     AND v_before_category IS NOT DISTINCT FROM p_category_id
     AND v_before_time IS NOT DISTINCT FROM v_time THEN
    RETURN p_id;
  END IF;

  IF p_origin='HISTORICAL' THEN
    UPDATE public.historical_transactions
       SET description=v_description, category_id=p_category_id,
           occurred_time=v_time
     WHERE id=p_id AND user_id=v_user;
  ELSE
    UPDATE public.operations
       SET memo=v_description, occurred_time=v_time
     WHERE id=p_id AND user_id=v_user;
    IF v_operation.kind IN ('INCOME','EXPENSE') THEN
      UPDATE public.transactions
         SET description=v_description, category_id=p_category_id
       WHERE id=v_transaction.id AND user_id=v_user;
    END IF;
  END IF;

  INSERT INTO public.movement_metadata_changes(
    user_id,movement_id,origin,previous_description,new_description,
    previous_category_id,new_category_id,
    previous_occurred_time,new_occurred_time
  ) VALUES (
    v_user,p_id,p_origin,v_before_description,v_description,
    v_before_category,p_category_id,v_before_time,v_time
  );

  RETURN p_id;
END;
$$;
REVOKE ALL ON FUNCTION public.update_movement_metadata(uuid,text,text,uuid,text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.update_movement_metadata(uuid,text,text,uuid,text)
  TO authenticated;

-- Misma vista 006, con UNA columna nueva al FINAL para no romper
-- el orden y los consumidores actuales de PostgREST.
CREATE OR REPLACE VIEW public.v_movement_history
WITH (security_invoker=true) AS
WITH records AS (
  SELECT o.id, o.user_id, 'OPERATION'::text AS origin,
    CASE
      WHEN o.kind='EXPENSE' AND tx.description LIKE 'Transferencia externa a:%' THEN 'EXTERNAL_OUT'
      WHEN o.kind='INCOME' AND tx.description LIKE 'Transferencia externa de:%' THEN 'EXTERNAL_IN'
      ELSE o.kind::text
    END AS kind,
    o.effective_on, o.created_at,
    coalesce(nullif(tx.description,''),nullif(o.memo,'')) AS description,
    (CASE o.kind
      WHEN 'INCOME' THEN tx.amount
      WHEN 'EXPENSE' THEN tx.amount
      WHEN 'TRANSFER' THEN tr.amount
      WHEN 'CARD_PAYMENT' THEN cp.amount
      WHEN 'LOAN_PAYMENT' THEN (lp.principal + lp.interest + lp.fees)
      WHEN 'LOAN_DISBURSEMENT' THEN d_account.delta
      WHEN 'ADJUSTMENT' THEN abs(adj.delta)
      ELSE 0
    END)::numeric(18,2) AS amount,
    tx.category_id,
    coalesce(tx.source_account_id,tr.from_account_id,cp.account_id,
      lp.account_id,adj.account_id,d_account.account_id) AS account_id,
    tr.to_account_id,
    coalesce(tx.source_card_id,cp.card_id,adj.card_id) AS card_id,
    coalesce(lp.loan_id,adj.loan_id,d_loan.loan_id) AS loan_id,
    coalesce(lp.principal,0)::numeric(18,2) AS principal,
    coalesce(lp.interest,0)::numeric(18,2) AS interest,
    coalesce(lp.fees,0)::numeric(18,2) AS fees,
    adj.delta AS adjustment_delta,
    (r.id IS NOT NULL) AS is_reversed,
    r.created_at AS reversed_at,
    r.memo AS reversal_reason,
    o.occurred_time AS occurred_time
  FROM public.operations o
  LEFT JOIN public.transactions tx
    ON tx.user_id=o.user_id AND tx.operation_id=o.id
    AND o.kind IN ('INCOME','EXPENSE') AND tx.effect_sign=1
  LEFT JOIN public.transfers tr
    ON tr.user_id=o.user_id AND tr.operation_id=o.id
  LEFT JOIN public.card_payments cp
    ON cp.user_id=o.user_id AND cp.operation_id=o.id
  LEFT JOIN public.loan_payments lp
    ON lp.user_id=o.user_id AND lp.operation_id=o.id
  LEFT JOIN public.financial_adjustments adj
    ON adj.user_id=o.user_id AND adj.operation_id=o.id
  LEFT JOIN public.ledger_entries d_account
    ON d_account.user_id=o.user_id AND d_account.operation_id=o.id
    AND o.kind='LOAN_DISBURSEMENT' AND d_account.account_id IS NOT NULL
    AND d_account.delta>0
  LEFT JOIN public.ledger_entries d_loan
    ON d_loan.user_id=o.user_id AND d_loan.operation_id=o.id
    AND o.kind='LOAN_DISBURSEMENT' AND d_loan.loan_id IS NOT NULL
    AND d_loan.delta>0
  LEFT JOIN public.operations r
    ON r.user_id=o.user_id AND r.reversal_of=o.id
  WHERE o.kind<>'REVERSAL'
  UNION ALL
  SELECT h.id,h.user_id,'HISTORICAL'::text,h.kind::text,
    h.effective_on,h.created_at,h.description,h.amount,h.category_id,
    h.source_account_id,NULL::uuid,h.source_card_id,NULL::uuid,
    0::numeric(18,2),0::numeric(18,2),0::numeric(18,2),NULL::numeric(18,2),
    (h.voided_at IS NOT NULL),h.voided_at,h.void_reason,
    h.occurred_time
  FROM public.historical_transactions h
)
SELECT r.id,r.user_id,r.origin,r.kind,r.effective_on,r.created_at,
  r.description,r.amount,r.category_id,r.account_id,r.to_account_id,
  r.card_id,r.loan_id,r.principal,r.interest,r.fees,r.adjustment_delta,
  r.is_reversed,r.reversed_at,r.reversal_reason,
  c.name AS category_name,
  a.name AS account_name,
  ta.name AS to_account_name,
  ca.name AS card_name,
  l.name AS loan_name,
  concat_ws(' ',r.description,c.name,a.name,ta.name,ca.name,l.name) AS search_text,
  r.occurred_time
FROM records r
LEFT JOIN public.categories c ON c.user_id=r.user_id AND c.id=r.category_id
LEFT JOIN public.accounts a ON a.user_id=r.user_id AND a.id=r.account_id
LEFT JOIN public.accounts ta ON ta.user_id=r.user_id AND ta.id=r.to_account_id
LEFT JOIN public.cards ca ON ca.user_id=r.user_id AND ca.id=r.card_id
LEFT JOIN public.loans l ON l.user_id=r.user_id AND l.id=r.loan_id;

REVOKE ALL ON public.v_movement_history FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.v_movement_history TO authenticated;

COMMIT;
NOTIFY pgrst, 'reload schema';
