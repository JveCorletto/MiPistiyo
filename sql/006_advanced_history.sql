-- MiPistiyo / 006_advanced_history.sql
-- Aplicar DESPUÉS de 003_historical_movements.sql.
-- Requiere respaldo previo. No borra operaciones ni modifica saldos de apertura.
BEGIN;
SET LOCAL lock_timeout = '10s';

-- Los registros históricos no tienen ledger. Su anulación es lógica y
-- se excluye de los reportes; los registros permanecen para auditoría.
ALTER TABLE public.historical_transactions
  ADD COLUMN IF NOT EXISTS voided_at timestamptz,
  ADD COLUMN IF NOT EXISTS void_reason text;

ALTER TABLE public.historical_transactions
  ADD CONSTRAINT historical_void_consistency CHECK (
    (voided_at IS NULL AND void_reason IS NULL)
    OR (voided_at IS NOT NULL AND void_reason IS NOT NULL
      AND length(btrim(void_reason)) BETWEEN 5 AND 1000)
  );

CREATE OR REPLACE FUNCTION public.void_historical_transaction(
  p_historical uuid, p_reason text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_user uuid := app_private.require_user();
  v_record public.historical_transactions%ROWTYPE;
BEGIN
  IF p_historical IS NULL THEN
    RAISE EXCEPTION 'Movimiento histórico obligatorio';
  END IF;
  IF length(btrim(coalesce(p_reason,''))) NOT BETWEEN 5 AND 1000 THEN
    RAISE EXCEPTION 'Justificación entre 5 y 1000 caracteres';
  END IF;
  PERFORM app_private.lock_financial_user(v_user);
  SELECT * INTO v_record FROM public.historical_transactions
  WHERE id=p_historical AND user_id=v_user FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Movimiento histórico no encontrado';
  END IF;
  IF v_record.voided_at IS NOT NULL THEN
    RAISE EXCEPTION 'Movimiento histórico ya anulado';
  END IF;
  UPDATE public.historical_transactions
  SET voided_at=now(), void_reason=btrim(p_reason)
  WHERE id=p_historical AND user_id=v_user;
  RETURN p_historical;
END;
$$;
REVOKE ALL ON FUNCTION public.void_historical_transaction(uuid,text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.void_historical_transaction(uuid,text) TO authenticated;

-- Estas vistas preservan exactamente sus columnas previas, para no romper
-- get_dashboard(), get_monthly_expenses() ni v_budget_progress.
CREATE OR REPLACE VIEW public.v_monthly_category_expenses
WITH (security_invoker=true) AS
WITH entries AS (
  SELECT t.user_id,o.effective_on,t.category_id,t.amount*t.effect_sign AS amount
  FROM public.transactions t
  JOIN public.operations o ON o.id=t.operation_id AND o.user_id=t.user_id
  WHERE t.kind='EXPENSE' AND o.kind<>'REVERSAL'
    AND NOT EXISTS (SELECT 1 FROM public.operations r WHERE r.reversal_of=o.id)
  UNION ALL
  SELECT h.user_id,h.effective_on,h.category_id,h.amount
  FROM public.historical_transactions h
  WHERE h.kind='EXPENSE' AND h.voided_at IS NULL
)
SELECT e.user_id,date_trunc('month',e.effective_on::timestamp)::date AS month_start,
  e.category_id,c.name AS category_name,
  coalesce(sum(e.amount),0)::numeric(18,2) AS spent
FROM entries e
JOIN public.categories c ON c.user_id=e.user_id AND c.id=e.category_id
GROUP BY e.user_id,date_trunc('month',e.effective_on::timestamp)::date,
  e.category_id,c.name;

CREATE OR REPLACE VIEW public.v_monthly_financial_flow
WITH (security_invoker=true) AS
WITH entries AS (
  SELECT t.user_id,o.effective_on,t.kind,t.amount*t.effect_sign AS amount
  FROM public.transactions t
  JOIN public.operations o ON o.id=t.operation_id AND o.user_id=t.user_id
  WHERE o.kind<>'REVERSAL'
    AND NOT EXISTS (SELECT 1 FROM public.operations r WHERE r.reversal_of=o.id)
  UNION ALL
  SELECT h.user_id,h.effective_on,h.kind,h.amount
  FROM public.historical_transactions h
  WHERE h.voided_at IS NULL
)
SELECT e.user_id,date_trunc('month',e.effective_on::timestamp)::date AS month_start,
  coalesce(sum(CASE WHEN e.kind='INCOME' THEN e.amount ELSE 0 END),0)::numeric(18,2) AS income,
  coalesce(sum(CASE WHEN e.kind='EXPENSE' THEN e.amount ELSE 0 END),0)::numeric(18,2) AS expense,
  coalesce(sum(CASE WHEN e.kind='INCOME' THEN e.amount ELSE -e.amount END),0)::numeric(18,2) AS balance
FROM entries e
GROUP BY e.user_id,date_trunc('month',e.effective_on::timestamp)::date;

-- Una FILA POR OPERACIÓN: pagos de préstamos que tienen intereses y comisiones
-- no aparecen duplicados como varias transacciones.
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
    r.memo AS reversal_reason
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
    (h.voided_at IS NOT NULL),h.voided_at,h.void_reason
  FROM public.historical_transactions h
)
SELECT r.*,
  c.name AS category_name,
  a.name AS account_name,
  ta.name AS to_account_name,
  ca.name AS card_name,
  l.name AS loan_name,
  concat_ws(' ',r.description,c.name,a.name,ta.name,ca.name,l.name) AS search_text
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
