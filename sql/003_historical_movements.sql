-- MiPistiyo - 003_historical_movements.sql
-- Ejecutar UNA SOLA VEZ después de 001_initial_schema_corrected.sql.
-- No elimina ni altera saldos iniciales, tarjetas, cuentas ni ledger existente.
BEGIN;

CREATE TABLE public.historical_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  kind public.category_kind NOT NULL,
  category_id uuid NOT NULL,
  source_account_id uuid,
  source_card_id uuid,
  amount numeric(18,2) NOT NULL CHECK (amount > 0),
  effective_on date NOT NULL,
  description text CHECK (description IS NULL OR length(description) <= 1000),
  -- Es exclusivamente detalle YA INCLUIDO en el saldo de apertura.
  included_in_opening_balance boolean NOT NULL DEFAULT true
    CHECK (included_in_opening_balance = true),
  idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 128),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, id),
  UNIQUE (user_id, idempotency_key),
  FOREIGN KEY (user_id, category_id, kind)
    REFERENCES public.categories(user_id,id,kind) ON DELETE RESTRICT,
  FOREIGN KEY (user_id, source_account_id)
    REFERENCES public.accounts(user_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (user_id, source_card_id)
    REFERENCES public.cards(user_id,id) ON DELETE RESTRICT,
  CONSTRAINT historical_one_source CHECK (
    num_nonnulls(source_account_id,source_card_id)=1),
  CONSTRAINT historical_income_account CHECK (
    kind='EXPENSE' OR source_card_id IS NULL)
);
CREATE INDEX historical_transactions_user_date
  ON public.historical_transactions(user_id,effective_on DESC);
CREATE INDEX historical_transactions_category
  ON public.historical_transactions(user_id,category_id);

ALTER TABLE public.historical_transactions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.historical_transactions FROM PUBLIC, anon, authenticated;
CREATE POLICY historical_select_self ON public.historical_transactions
  FOR SELECT TO authenticated
  USING (user_id=(SELECT auth.uid()) AND (SELECT public.is_authorized()));
GRANT SELECT ON public.historical_transactions TO authenticated;

-- Escritura únicamente a través de esta RPC. No crea ledger_entries,
-- no cambia deuda ni disponibilidad. La fecha debe estar incluida en
-- el período del saldo de apertura del instrumento correspondiente.
CREATE FUNCTION public.post_historical_transaction(
  p_kind public.category_kind,
  p_category_id uuid,
  p_amount numeric,
  p_account_id uuid,
  p_card_id uuid,
  p_effective_on date,
  p_note text,
  p_idempotency_key text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_user uuid := app_private.require_user();
  v_existing public.historical_transactions%ROWTYPE;
  v_id uuid;
  v_category public.categories%ROWTYPE;
  v_account public.accounts%ROWTYPE;
  v_card public.cards%ROWTYPE;
  v_opened_on date;
BEGIN
  IF p_amount IS NULL OR p_amount<=0 OR round(p_amount,2)<>p_amount THEN
    RAISE EXCEPTION 'Monto histórico inválido';
  END IF;
  IF p_effective_on IS NULL THEN
    RAISE EXCEPTION 'Fecha histórica obligatoria';
  END IF;
  IF num_nonnulls(p_account_id,p_card_id)<>1 OR
     (p_kind='INCOME' AND p_card_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Fuente histórica inválida';
  END IF;
  IF p_idempotency_key IS NULL OR length(p_idempotency_key) NOT BETWEEN 8 AND 128 THEN
    RAISE EXCEPTION 'Clave de idempotencia inválida';
  END IF;
  IF length(coalesce(p_note,''))>1000 THEN
    RAISE EXCEPTION 'Descripción demasiado extensa';
  END IF;

  PERFORM app_private.lock_financial_user(v_user);
  SELECT * INTO v_existing FROM public.historical_transactions
  WHERE user_id=v_user AND idempotency_key=p_idempotency_key;
  IF FOUND THEN
    IF v_existing.kind IS DISTINCT FROM p_kind
       OR v_existing.category_id IS DISTINCT FROM p_category_id
       OR v_existing.amount IS DISTINCT FROM p_amount
       OR v_existing.source_account_id IS DISTINCT FROM p_account_id
       OR v_existing.source_card_id IS DISTINCT FROM p_card_id
       OR v_existing.effective_on IS DISTINCT FROM p_effective_on
       OR v_existing.description IS DISTINCT FROM nullif(p_note,'') THEN
      RAISE EXCEPTION 'Clave de idempotencia ya usada con datos diferentes';
    END IF;
    RETURN v_existing.id;
  END IF;

  SELECT * INTO v_category FROM public.categories
  WHERE user_id=v_user AND id=p_category_id AND kind=p_kind AND is_active;
  IF NOT FOUND THEN RAISE EXCEPTION 'Categoría no válida'; END IF;

  IF p_account_id IS NOT NULL THEN
    SELECT * INTO v_account FROM public.accounts
    WHERE user_id=v_user AND id=p_account_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Cuenta no encontrada'; END IF;
    v_opened_on:=v_account.opened_on;
  ELSE
    SELECT * INTO v_card FROM public.cards
    WHERE user_id=v_user AND id=p_card_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Tarjeta no encontrada'; END IF;
    v_opened_on:=v_card.opened_on;
    IF v_card.kind='DEBIT' THEN
      SELECT * INTO v_account FROM public.accounts
      WHERE user_id=v_user AND id=v_card.account_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'Cuenta vinculada no encontrada'; END IF;
      v_opened_on:=least(v_opened_on,v_account.opened_on);
    END IF;
  END IF;

  IF p_effective_on > v_opened_on THEN
    RAISE EXCEPTION 'La fecha (%) es posterior a la apertura contable (%)',
      p_effective_on,v_opened_on;
  END IF;

  INSERT INTO public.historical_transactions (
    user_id,kind,category_id,source_account_id,source_card_id,
    amount,effective_on,description,idempotency_key)
  VALUES (v_user,p_kind,p_category_id,p_account_id,p_card_id,
    p_amount,p_effective_on,nullif(p_note,''),p_idempotency_key)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.post_historical_transaction(
  public.category_kind,uuid,numeric,uuid,uuid,date,text,text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.post_historical_transaction(
  public.category_kind,uuid,numeric,uuid,uuid,date,text,text)
  TO authenticated;

-- Reportes: contabilizados + históricos incluidos en apertura.
-- El agregado es analítico: NO afecta el libro mayor ni las vistas de saldos.
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
  FROM public.historical_transactions h WHERE h.kind='EXPENSE'
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
)
SELECT e.user_id,date_trunc('month',e.effective_on::timestamp)::date AS month_start,
  coalesce(sum(CASE WHEN e.kind='INCOME' THEN e.amount ELSE 0 END),0)::numeric(18,2) AS income,
  coalesce(sum(CASE WHEN e.kind='EXPENSE' THEN e.amount ELSE 0 END),0)::numeric(18,2) AS expense,
  coalesce(sum(CASE WHEN e.kind='INCOME' THEN e.amount ELSE -e.amount END),0)::numeric(18,2) AS balance
FROM entries e
GROUP BY e.user_id,date_trunc('month',e.effective_on::timestamp)::date;

-- Las dos vistas continúan siendo security_invoker y sus grants se preservan.
-- Asegurar permiso SELECT de la tabla nueva para los consumidores de vistas.
COMMIT;

-- Validación estructural (no modifica datos)
SELECT tablename, rowsecurity FROM pg_tables
WHERE schemaname='public' AND tablename='historical_transactions';
SELECT proname FROM pg_proc WHERE proname='post_historical_transaction'
  AND pronamespace='public'::regnamespace;