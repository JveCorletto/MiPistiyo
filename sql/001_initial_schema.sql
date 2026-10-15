-- 001_initial_schema.sql
-- MiPistiyo | Supabase PostgreSQL 15+ | USD | America/El_Salvador
-- Esquema consolidado para un proyecto NUEVO. Ejecutar una sola vez como
-- propietario desde Supabase SQL Editor.
BEGIN;

CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS citext WITH SCHEMA extensions;

CREATE SCHEMA IF NOT EXISTS app_private;
REVOKE ALL ON SCHEMA app_private FROM PUBLIC, anon, authenticated;

-- 1. TIPOS -----------------------------------------------------------------
CREATE TYPE public.category_kind AS ENUM ('INCOME', 'EXPENSE');
CREATE TYPE public.account_kind AS ENUM ('CASH', 'BANK', 'WALLET');
CREATE TYPE public.card_kind AS ENUM ('DEBIT', 'CREDIT');
CREATE TYPE public.loan_balance_mode AS ENUM ('OPENING_BALANCE', 'TRACKED_DISBURSEMENTS');
CREATE TYPE public.operation_kind AS ENUM
  ('INCOME', 'EXPENSE', 'TRANSFER', 'CARD_PAYMENT', 'LOAN_DISBURSEMENT',
   'LOAN_PAYMENT', 'ADJUSTMENT', 'REVERSAL');
CREATE TYPE public.recurrence_frequency AS ENUM ('DAILY','WEEKLY','MONTHLY','YEARLY');
CREATE TYPE public.recurrence_status AS ENUM ('ACTIVE','PAUSED','ENDED');
CREATE TYPE public.occurrence_status AS ENUM ('PENDING','CONFIRMED','SKIPPED');
CREATE TYPE public.import_status AS ENUM ('PENDING','SUCCESS','FAILED');

-- 2. TABLAS (se conservan las 18 tablas del diseño original) ---------------
CREATE TABLE public.allowed_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email extensions.citext NOT NULL UNIQUE,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT allowed_email_valid CHECK (
    email = btrim(email::text)::extensions.citext
    AND length(email::text) BETWEEN 3 AND 320
    AND email::text ~* '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
  )
);

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE RESTRICT,
  display_name text,
  currency char(3) NOT NULL DEFAULT 'USD' CHECK (currency = 'USD'),
  timezone text NOT NULL DEFAULT 'America/El_Salvador',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT profiles_tz CHECK (timezone = 'America/El_Salvador'),
  CONSTRAINT profiles_name CHECK (
    display_name IS NULL OR length(btrim(display_name)) BETWEEN 1 AND 120
  )
);

CREATE TABLE public.accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  kind public.account_kind NOT NULL,
  currency char(3) NOT NULL DEFAULT 'USD' CHECK (currency = 'USD'),
  opening_balance numeric(18,2) NOT NULL DEFAULT 0,
  allow_overdraft boolean NOT NULL DEFAULT false,
  opened_on date NOT NULL DEFAULT ((now() AT TIME ZONE 'America/El_Salvador')::date),
  is_active boolean NOT NULL DEFAULT true,
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id,id),
  CONSTRAINT account_opening_balance_allowed CHECK (allow_overdraft OR opening_balance >= 0)
);

CREATE TABLE public.categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  kind public.category_kind NOT NULL,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 100),
  icon text,
  color text CHECK (color IS NULL OR color ~ '^#[0-9a-fA-F]{6}$'),
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id,id),
  UNIQUE(user_id,id,kind)
);
CREATE UNIQUE INDEX categories_unique_normalized
  ON public.categories(user_id,kind,lower(btrim(name)));

CREATE TABLE public.cards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  kind public.card_kind NOT NULL,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  issuer text,
  last_four char(4) CHECK (last_four IS NULL OR last_four ~ '^[0-9]{4}$'),
  account_id uuid,
  credit_limit numeric(18,2),
  opening_debt numeric(18,2),
  -- false permite reflejar compras/cargos bancarios que excedan el límite.
  -- true hace que post_transaction rechace compras por encima del límite.
  enforce_credit_limit boolean NOT NULL DEFAULT false,
  opened_on date NOT NULL DEFAULT ((now() AT TIME ZONE 'America/El_Salvador')::date),
  cutoff_day smallint,
  due_day smallint,
  due_month_offset smallint NOT NULL DEFAULT 1,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id,id),
  FOREIGN KEY (user_id,account_id) REFERENCES public.accounts(user_id,id) ON DELETE RESTRICT,
  CONSTRAINT card_fields CHECK (
    (kind = 'DEBIT' AND account_id IS NOT NULL AND credit_limit IS NULL
       AND opening_debt IS NULL AND cutoff_day IS NULL AND due_day IS NULL
       AND NOT enforce_credit_limit)
    OR (kind = 'CREDIT' AND account_id IS NULL
       AND credit_limit IS NOT NULL AND credit_limit > 0
       AND opening_debt IS NOT NULL AND opening_debt >= 0
       AND cutoff_day IS NOT NULL AND cutoff_day BETWEEN 1 AND 31
       AND due_day IS NOT NULL AND due_day BETWEEN 1 AND 31
       AND due_month_offset BETWEEN 0 AND 2)
  )
);

CREATE TABLE public.loans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  lender text NOT NULL CHECK (length(btrim(lender)) BETWEEN 1 AND 150),
  original_amount numeric(18,2) NOT NULL CHECK (original_amount > 0),
  opening_debt numeric(18,2) NOT NULL DEFAULT 0 CHECK (opening_debt >= 0),
  -- OPENING_BALANCE: deuda preexistente; nunca se desembolsa otra vez.
  -- TRACKED_DISBURSEMENTS: nace en cero y la app registra cada desembolso.
  balance_mode public.loan_balance_mode NOT NULL DEFAULT 'TRACKED_DISBURSEMENTS',
  started_on date NOT NULL,
  annual_interest_rate numeric(9,4) CHECK (annual_interest_rate >= 0),
  expected_installment numeric(18,2) CHECK (expected_installment > 0),
  due_day smallint CHECK (due_day BETWEEN 1 AND 31),
  is_active boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id,id),
  CONSTRAINT opening_loan_limit CHECK (opening_debt <= original_amount),
  CONSTRAINT loan_balance_mode_consistent CHECK (
    (balance_mode = 'OPENING_BALANCE' AND opening_debt > 0)
    OR (balance_mode = 'TRACKED_DISBURSEMENTS' AND opening_debt = 0)
  )
);

-- delta > 0 aumenta el activo (cuenta) o el pasivo (tarjeta/préstamo).
CREATE TABLE public.operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  kind public.operation_kind NOT NULL,
  effective_on date NOT NULL,
  memo text,
  idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 128),
  request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  reversal_of uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id,id),
  UNIQUE(user_id,idempotency_key),
  UNIQUE(reversal_of),
  FOREIGN KEY(user_id,reversal_of) REFERENCES public.operations(user_id,id) ON DELETE RESTRICT,
  CONSTRAINT only_reversals_reference CHECK ((kind = 'REVERSAL') = (reversal_of IS NOT NULL))
);

CREATE TABLE public.ledger_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  operation_id uuid NOT NULL,
  entry_no smallint NOT NULL CHECK (entry_no BETWEEN 1 AND 30),
  account_id uuid,
  card_id uuid,
  loan_id uuid,
  delta numeric(18,2) NOT NULL CHECK (delta <> 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id,operation_id,entry_no),
  FOREIGN KEY(user_id,operation_id) REFERENCES public.operations(user_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(user_id,account_id) REFERENCES public.accounts(user_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(user_id,card_id) REFERENCES public.cards(user_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(user_id,loan_id) REFERENCES public.loans(user_id,id) ON DELETE RESTRICT,
  CONSTRAINT exactly_one_ledger_target CHECK (num_nonnulls(account_id,card_id,loan_id) = 1)
);

CREATE TABLE public.transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  operation_id uuid NOT NULL,
  kind public.category_kind NOT NULL,
  category_id uuid NOT NULL,
  source_account_id uuid,
  source_card_id uuid,
  amount numeric(18,2) NOT NULL CHECK (amount > 0),
  effect_sign smallint NOT NULL DEFAULT 1 CHECK(effect_sign IN(-1,1)),
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id,id),
  FOREIGN KEY(user_id,operation_id) REFERENCES public.operations(user_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(user_id,category_id,kind) REFERENCES public.categories(user_id,id,kind) ON DELETE RESTRICT,
  FOREIGN KEY(user_id,source_account_id) REFERENCES public.accounts(user_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(user_id,source_card_id) REFERENCES public.cards(user_id,id) ON DELETE RESTRICT,
  CHECK (num_nonnulls(source_account_id,source_card_id) <= 1)
);

CREATE TABLE public.transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  operation_id uuid NOT NULL,
  from_account_id uuid NOT NULL,
  to_account_id uuid NOT NULL,
  amount numeric(18,2) NOT NULL CHECK(amount > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id,operation_id),
  FOREIGN KEY(user_id,operation_id) REFERENCES public.operations(user_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(user_id,from_account_id) REFERENCES public.accounts(user_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(user_id,to_account_id) REFERENCES public.accounts(user_id,id) ON DELETE RESTRICT,
  CHECK(from_account_id <> to_account_id)
);

CREATE TABLE public.credit_card_statements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  card_id uuid NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  due_on date NOT NULL,
  statement_balance numeric(18,2) NOT NULL CHECK (statement_balance >= 0),
  minimum_payment numeric(18,2) NOT NULL DEFAULT 0 CHECK (minimum_payment >= 0),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id,id),
  UNIQUE(user_id,id,card_id),
  UNIQUE(user_id,card_id,period_start),
  FOREIGN KEY(user_id,card_id) REFERENCES public.cards(user_id,id) ON DELETE RESTRICT,
  CHECK(period_start <= period_end AND due_on >= period_end),
  CHECK(minimum_payment <= statement_balance)
);

CREATE TABLE public.card_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  operation_id uuid NOT NULL,
  card_id uuid NOT NULL,
  account_id uuid NOT NULL,
  statement_id uuid,
  amount numeric(18,2) NOT NULL CHECK(amount > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id,operation_id),
  FOREIGN KEY(user_id,operation_id) REFERENCES public.operations(user_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(user_id,card_id) REFERENCES public.cards(user_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(user_id,account_id) REFERENCES public.accounts(user_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(user_id,statement_id,card_id)
    REFERENCES public.credit_card_statements(user_id,id,card_id) ON DELETE RESTRICT
);

CREATE TABLE public.loan_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  operation_id uuid NOT NULL,
  loan_id uuid NOT NULL,
  account_id uuid NOT NULL,
  principal numeric(18,2) NOT NULL DEFAULT 0 CHECK (principal >= 0),
  interest numeric(18,2) NOT NULL DEFAULT 0 CHECK (interest >= 0),
  fees numeric(18,2) NOT NULL DEFAULT 0 CHECK (fees >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id,operation_id),
  FOREIGN KEY(user_id,operation_id) REFERENCES public.operations(user_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(user_id,loan_id) REFERENCES public.loans(user_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(user_id,account_id) REFERENCES public.accounts(user_id,id) ON DELETE RESTRICT,
  CHECK (principal+interest+fees > 0)
);

CREATE TABLE public.financial_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  operation_id uuid NOT NULL,
  account_id uuid,
  card_id uuid,
  loan_id uuid,
  delta numeric(18,2) NOT NULL CHECK(delta <> 0),
  reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 5 AND 1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id,operation_id),
  FOREIGN KEY(user_id,operation_id) REFERENCES public.operations(user_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(user_id,account_id) REFERENCES public.accounts(user_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(user_id,card_id) REFERENCES public.cards(user_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(user_id,loan_id) REFERENCES public.loans(user_id,id) ON DELETE RESTRICT,
  CHECK(num_nonnulls(account_id,card_id,loan_id)=1)
);

CREATE TABLE public.budgets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  month_start date NOT NULL CHECK (EXTRACT(DAY FROM month_start)=1),
  category_id uuid,
  category_kind public.category_kind NOT NULL DEFAULT 'EXPENSE' CHECK(category_kind='EXPENSE'),
  amount numeric(18,2) NOT NULL CHECK(amount > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id,id),
  FOREIGN KEY(user_id,category_id,category_kind)
    REFERENCES public.categories(user_id,id,kind) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX budgets_one_overall
  ON public.budgets(user_id,month_start) WHERE category_id IS NULL;
CREATE UNIQUE INDEX budgets_one_per_category
  ON public.budgets(user_id,month_start,category_id) WHERE category_id IS NOT NULL;

CREATE TABLE public.recurring_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  name text NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 120),
  kind public.category_kind NOT NULL,
  category_id uuid NOT NULL,
  amount numeric(18,2) NOT NULL CHECK (amount > 0),
  account_id uuid,
  card_id uuid,
  frequency public.recurrence_frequency NOT NULL,
  anchor_day smallint CHECK(anchor_day BETWEEN 1 AND 31),
  next_on date NOT NULL,
  status public.recurrence_status NOT NULL DEFAULT 'ACTIVE',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id,id),
  FOREIGN KEY(user_id,category_id,kind) REFERENCES public.categories(user_id,id,kind) ON DELETE RESTRICT,
  FOREIGN KEY(user_id,account_id) REFERENCES public.accounts(user_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(user_id,card_id) REFERENCES public.cards(user_id,id) ON DELETE RESTRICT,
  CHECK(num_nonnulls(account_id,card_id)=1),
  CHECK(kind <> 'INCOME' OR card_id IS NULL),
  CHECK((frequency IN ('MONTHLY','YEARLY')) = (anchor_day IS NOT NULL))
);

CREATE TABLE public.recurring_occurrences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  recurring_id uuid NOT NULL,
  scheduled_on date NOT NULL,
  status public.occurrence_status NOT NULL DEFAULT 'PENDING',
  operation_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id,id),
  UNIQUE(user_id,recurring_id,scheduled_on),
  UNIQUE(user_id,operation_id),
  FOREIGN KEY(user_id,recurring_id) REFERENCES public.recurring_transactions(user_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(user_id,operation_id) REFERENCES public.operations(user_id,id) ON DELETE RESTRICT,
  CHECK((status = 'CONFIRMED') = (operation_id IS NOT NULL))
);

CREATE TABLE public.import_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  import_key uuid NOT NULL,
  backup_version text NOT NULL CHECK(length(btrim(backup_version)) BETWEEN 1 AND 50),
  source_sha256 text NOT NULL CHECK(source_sha256 ~ '^[0-9a-f]{64}$'),
  status public.import_status NOT NULL DEFAULT 'PENDING',
  records_processed integer NOT NULL DEFAULT 0 CHECK(records_processed >= 0),
  records_failed integer NOT NULL DEFAULT 0 CHECK(records_failed >= 0),
  errors_summary text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(metadata)='object'),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id,id),
  UNIQUE(user_id,import_key),
  UNIQUE(user_id,source_sha256),
  CHECK ((status='PENDING' AND completed_at IS NULL)
      OR (status IN ('SUCCESS','FAILED') AND completed_at IS NOT NULL))
);

-- 3. ÍNDICES ---------------------------------------------------------------
CREATE INDEX accounts_user ON public.accounts(user_id,is_active);
CREATE INDEX categories_user ON public.categories(user_id,kind,is_active);
CREATE INDEX cards_user ON public.cards(user_id,kind,is_active);
CREATE INDEX loans_user ON public.loans(user_id,is_active);
CREATE INDEX operations_user_date ON public.operations(user_id,effective_on DESC,created_at DESC);
CREATE INDEX operations_reversed ON public.operations(reversal_of) WHERE reversal_of IS NOT NULL;
CREATE INDEX ledger_account ON public.ledger_entries(user_id,account_id) WHERE account_id IS NOT NULL;
CREATE INDEX ledger_card ON public.ledger_entries(user_id,card_id) WHERE card_id IS NOT NULL;
CREATE INDEX ledger_loan ON public.ledger_entries(user_id,loan_id) WHERE loan_id IS NOT NULL;
CREATE INDEX ledger_operation ON public.ledger_entries(user_id,operation_id);
CREATE INDEX transactions_operation ON public.transactions(user_id,operation_id);
CREATE INDEX transactions_category ON public.transactions(user_id,category_id);
CREATE INDEX statements_card_period ON public.credit_card_statements(user_id,card_id,period_end DESC);
CREATE INDEX card_payments_statement ON public.card_payments(user_id,statement_id);
CREATE INDEX loan_payments_loan ON public.loan_payments(user_id,loan_id);
CREATE INDEX budgets_month ON public.budgets(user_id,month_start);
CREATE INDEX recurring_due ON public.recurring_transactions(user_id,status,next_on);
CREATE INDEX occurrences_due ON public.recurring_occurrences(user_id,status,scheduled_on);
CREATE INDEX imports_user ON public.import_history(user_id,created_at DESC);

-- 4. AUTORIZACIÓN, AUXILIARES Y TRIGGERS ----------------------------------
CREATE FUNCTION public.is_authorized()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1
    FROM auth.users u
    JOIN public.allowed_users a ON a.email = u.email::extensions.citext
    WHERE u.id = (SELECT auth.uid())
      AND u.email_confirmed_at IS NOT NULL
      AND a.is_active
  );
$$;

CREATE FUNCTION app_private.require_user()
RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_user uuid := (SELECT auth.uid());
BEGIN
  IF v_user IS NULL OR NOT public.is_authorized() THEN
    RAISE EXCEPTION 'Acceso no autorizado' USING ERRCODE = '42501';
  END IF;
  RETURN v_user;
END;
$$;

-- Serializa por usuario las mutaciones financieras. Esto hace seguros los
-- reintentos concurrentes, mantiene un orden global de bloqueo por usuario y
-- evita que dos cálculos de saldo se basen en el mismo estado anterior.
CREATE FUNCTION app_private.lock_financial_user(p_user uuid)
RETURNS void
LANGUAGE sql VOLATILE SET search_path = '' AS $$
  SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user::text, 0));
$$;

CREATE FUNCTION app_private.account_balance(p_user uuid, p_account uuid)
RETURNS numeric
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT (a.opening_balance + coalesce(sum(le.delta),0))::numeric(18,2)
  FROM public.accounts a
  LEFT JOIN public.ledger_entries le
    ON le.user_id=a.user_id AND le.account_id=a.id
  WHERE a.user_id=p_user AND a.id=p_account
  GROUP BY a.id,a.opening_balance;
$$;

CREATE FUNCTION app_private.card_debt(p_user uuid, p_card uuid)
RETURNS numeric
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT (coalesce(c.opening_debt,0) + coalesce(sum(le.delta),0))::numeric(18,2)
  FROM public.cards c
  LEFT JOIN public.ledger_entries le
    ON le.user_id=c.user_id AND le.card_id=c.id
  WHERE c.user_id=p_user AND c.id=p_card
  GROUP BY c.id,c.opening_debt;
$$;

CREATE FUNCTION app_private.loan_debt(p_user uuid, p_loan uuid)
RETURNS numeric
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT (l.opening_debt + coalesce(sum(le.delta),0))::numeric(18,2)
  FROM public.loans l
  LEFT JOIN public.ledger_entries le
    ON le.user_id=l.user_id AND le.loan_id=l.id
  WHERE l.user_id=p_user AND l.id=p_loan
  GROUP BY l.id,l.opening_debt;
$$;

-- Hook Before User Created de Supabase Auth. Solo se concede a
-- supabase_auth_admin al final del script.
CREATE FUNCTION public.before_user_created(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_email text := btrim(event->'user'->>'email');
BEGIN
  IF v_email IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.allowed_users
    WHERE email=v_email::extensions.citext AND is_active
  ) THEN
    RETURN jsonb_build_object('error',jsonb_build_object(
      'http_code',403,'message','Cuenta no autorizada'));
  END IF;
  RETURN '{}'::jsonb;
END;
$$;

-- Trigger de perfil recomendado por Supabase: no altera columnas ni funciones
-- internas de Auth; solo reacciona a altas/confirmaciones de auth.users.
CREATE FUNCTION app_private.sync_profile()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.email_confirmed_at IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.allowed_users a
    WHERE a.email=NEW.email::extensions.citext AND a.is_active
  ) THEN
    INSERT INTO public.profiles(user_id,display_name)
    VALUES (NEW.id,NULLIF(left(btrim(NEW.raw_user_meta_data->>'name'),120),''))
    ON CONFLICT (user_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER create_authorized_profile
AFTER INSERT OR UPDATE OF email,email_confirmed_at ON auth.users
FOR EACH ROW EXECUTE FUNCTION app_private.sync_profile();

CREATE FUNCTION public.ensure_profile()
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_user uuid := app_private.require_user(); v_id uuid;
BEGIN
  INSERT INTO public.profiles(user_id) VALUES(v_user)
  ON CONFLICT(user_id) DO NOTHING;
  SELECT id INTO v_id FROM public.profiles WHERE user_id=v_user;
  RETURN v_id;
END;
$$;

CREATE FUNCTION app_private.touch_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DO $$
DECLARE v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'profiles','accounts','categories','cards','loans','credit_card_statements',
    'budgets','recurring_transactions','recurring_occurrences','import_history'
  ] LOOP
    EXECUTE format(
      'CREATE TRIGGER touch_%I BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION app_private.touch_updated_at()',
      v_table,v_table);
  END LOOP;
END;
$$;

CREATE FUNCTION app_private.validate_statement()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_kind public.card_kind;
BEGIN
  SELECT kind INTO v_kind
  FROM public.cards WHERE user_id=NEW.user_id AND id=NEW.card_id;
  IF v_kind IS DISTINCT FROM 'CREDIT'::public.card_kind THEN
    RAISE EXCEPTION 'Estado de cuenta requiere tarjeta CREDIT';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER statement_credit_only
BEFORE INSERT OR UPDATE OF card_id,user_id ON public.credit_card_statements
FOR EACH ROW EXECUTE FUNCTION app_private.validate_statement();

CREATE FUNCTION app_private.validate_statement_amount()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_applied numeric(18,2);
BEGIN
  SELECT coalesce(sum(cp.amount),0) INTO v_applied
  FROM public.card_payments cp
  WHERE cp.user_id=NEW.user_id AND cp.statement_id=NEW.id
    AND NOT EXISTS(
      SELECT 1 FROM public.operations r WHERE r.reversal_of=cp.operation_id
    );
  IF NEW.statement_balance < v_applied THEN
    RAISE EXCEPTION 'Saldo al corte menor que pagos aplicados';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER statement_no_underpayment
BEFORE UPDATE OF statement_balance ON public.credit_card_statements
FOR EACH ROW EXECUTE FUNCTION app_private.validate_statement_amount();

CREATE FUNCTION app_private.validate_overdraft_setting()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF OLD.allow_overdraft AND NOT NEW.allow_overdraft
     AND app_private.account_balance(NEW.user_id,NEW.id) < 0 THEN
    RAISE EXCEPTION 'No se puede desactivar sobregiro con saldo negativo';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER account_overdraft_guard
BEFORE UPDATE OF allow_overdraft ON public.accounts
FOR EACH ROW EXECUTE FUNCTION app_private.validate_overdraft_setting();

CREATE FUNCTION app_private.next_recurring_date(
  p_date date, p_frequency public.recurrence_frequency, p_anchor smallint)
RETURNS date
LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE v_first date; v_days integer;
BEGIN
  IF p_frequency='DAILY' THEN RETURN p_date+1; END IF;
  IF p_frequency='WEEKLY' THEN RETURN p_date+7; END IF;
  IF p_frequency='MONTHLY' THEN
    v_first := (date_trunc('month',p_date::timestamp)+interval '1 month')::date;
  ELSIF p_frequency='YEARLY' THEN
    v_first := (date_trunc('month',p_date::timestamp)+interval '1 year')::date;
  ELSE
    RAISE EXCEPTION 'Frecuencia desconocida';
  END IF;
  v_days := extract(day FROM (v_first+interval '1 month - 1 day'))::integer;
  RETURN v_first+(least(coalesce(p_anchor,extract(day FROM p_date)::int),v_days)-1);
END;
$$;

CREATE FUNCTION app_private.begin_operation(
  p_kind public.operation_kind, p_effective_on date, p_memo text,
  p_key text, p_payload jsonb, p_reversal_of uuid DEFAULT NULL,
  OUT operation_id uuid, OUT is_new boolean)
RETURNS record
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_user uuid := app_private.require_user();
  v_hash text;
  v_existing_hash text;
BEGIN
  IF p_effective_on IS NULL OR p_key IS NULL OR length(p_key) NOT BETWEEN 8 AND 128 THEN
    RAISE EXCEPTION 'Fecha e idempotency_key (8..128) obligatorias';
  END IF;
  PERFORM app_private.lock_financial_user(v_user);
  v_hash := encode(extensions.digest(
    convert_to(jsonb_build_object(
      'kind',p_kind,'reversal_of',p_reversal_of,'payload',p_payload
    )::text,'UTF8'),'sha256'),'hex');

  INSERT INTO public.operations(
    user_id,kind,effective_on,memo,idempotency_key,request_hash,reversal_of)
  VALUES(v_user,p_kind,p_effective_on,p_memo,p_key,v_hash,p_reversal_of)
  ON CONFLICT DO NOTHING
  RETURNING id INTO operation_id;

  is_new := operation_id IS NOT NULL;
  IF NOT is_new THEN
    SELECT id,request_hash INTO operation_id,v_existing_hash
    FROM public.operations
    WHERE user_id=v_user AND idempotency_key=p_key;
    IF operation_id IS NULL OR v_existing_hash<>v_hash THEN
      RAISE EXCEPTION 'Idempotency key ya usada con otros parámetros';
    END IF;
  END IF;
END;
$$;

CREATE FUNCTION public.confirm_recurring_occurrence(
  p_occurrence uuid, p_operation uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_user uuid := app_private.require_user();
  v_rule public.recurring_transactions%ROWTYPE;
  v_occ public.recurring_occurrences%ROWTYPE;
BEGIN
  PERFORM app_private.lock_financial_user(v_user);
  SELECT * INTO v_occ
  FROM public.recurring_occurrences
  WHERE id=p_occurrence AND user_id=v_user
  FOR UPDATE;
  IF NOT FOUND OR v_occ.status<>'PENDING' THEN
    RAISE EXCEPTION 'Ocurrencia no pendiente';
  END IF;

  SELECT * INTO v_rule
  FROM public.recurring_transactions
  WHERE id=v_occ.recurring_id AND user_id=v_user;

  IF NOT EXISTS (
    SELECT 1
    FROM public.operations o
    JOIN public.transactions t
      ON t.operation_id=o.id AND t.user_id=o.user_id
    WHERE o.id=p_operation AND o.user_id=v_user
      AND o.kind::text=v_rule.kind::text
      AND t.kind=v_rule.kind
      AND t.category_id=v_rule.category_id
      AND t.amount=v_rule.amount
      AND t.effect_sign=1
      AND t.source_account_id IS NOT DISTINCT FROM v_rule.account_id
      AND t.source_card_id IS NOT DISTINCT FROM v_rule.card_id
      AND NOT EXISTS(
        SELECT 1 FROM public.operations r WHERE r.reversal_of=o.id
      )
  ) THEN
    RAISE EXCEPTION 'Operación no corresponde a la recurrencia';
  END IF;

  UPDATE public.recurring_occurrences
  SET status='CONFIRMED',operation_id=p_operation
  WHERE id=p_occurrence AND user_id=v_user;
END;
$$;

CREATE FUNCTION app_private.generate_occurrences_for_user(
  p_user uuid, p_through date)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_rule public.recurring_transactions%ROWTYPE;
  v_created integer := 0;
  v_steps integer;
BEGIN
  PERFORM app_private.lock_financial_user(p_user);
  FOR v_rule IN
    SELECT * FROM public.recurring_transactions
    WHERE user_id=p_user AND status='ACTIVE' AND next_on<=p_through
    ORDER BY id FOR UPDATE
  LOOP
    v_steps := 0;
    WHILE v_rule.next_on<=p_through AND v_steps<100 LOOP
      INSERT INTO public.recurring_occurrences(user_id,recurring_id,scheduled_on)
      VALUES(p_user,v_rule.id,v_rule.next_on)
      ON CONFLICT(user_id,recurring_id,scheduled_on) DO NOTHING;
      IF FOUND THEN v_created:=v_created+1; END IF;
      v_rule.next_on := app_private.next_recurring_date(
        v_rule.next_on,v_rule.frequency,v_rule.anchor_day);
      v_steps:=v_steps+1;
    END LOOP;
    IF v_rule.next_on<=p_through THEN
      RAISE EXCEPTION 'Regla recurrente % excede 100 ocurrencias por ejecución',v_rule.id;
    END IF;
    UPDATE public.recurring_transactions
    SET next_on=v_rule.next_on WHERE id=v_rule.id;
  END LOOP;
  RETURN v_created;
END;
$$;

-- RPC de usuario: solo crea pendientes; nunca modifica saldos.
CREATE FUNCTION public.generate_pending_occurrences(p_through date)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_user uuid := app_private.require_user();
  v_today date := (now() AT TIME ZONE 'America/El_Salvador')::date;
BEGIN
  IF p_through IS NULL OR p_through<v_today OR p_through>v_today+90 THEN
    RAISE EXCEPTION 'Fecha permitida: hoy hasta hoy + 90 días';
  END IF;
  RETURN app_private.generate_occurrences_for_user(v_user,p_through);
END;
$$;

-- RPC exclusiva de service_role para Vercel Cron/Edge Function. Procesa todas
-- las cuentas autorizadas y confirmadas; no contabiliza los pendientes.
CREATE FUNCTION public.generate_pending_occurrences_all(p_through date)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_user uuid;
  v_total integer := 0;
  v_today date := (now() AT TIME ZONE 'America/El_Salvador')::date;
BEGIN
  IF p_through IS NULL OR p_through<v_today OR p_through>v_today+90 THEN
    RAISE EXCEPTION 'Fecha permitida: hoy hasta hoy + 90 días';
  END IF;
  FOR v_user IN
    SELECT u.id
    FROM auth.users u
    JOIN public.allowed_users a ON a.email=u.email::extensions.citext
    WHERE a.is_active AND u.email_confirmed_at IS NOT NULL
    ORDER BY u.id
  LOOP
    v_total := v_total + app_private.generate_occurrences_for_user(v_user,p_through);
  END LOOP;
  RETURN v_total;
END;
$$;

CREATE FUNCTION public.seed_default_categories()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_user uuid := app_private.require_user(); v_count integer;
BEGIN
  WITH names(kind,name,sort_order) AS (
    VALUES
      ('INCOME'::public.category_kind,'Salario',1),
      ('INCOME','Freelance',2),('INCOME','Bonificaciones',3),
      ('INCOME','Ventas',4),('INCOME','Otros',5),
      ('EXPENSE','Alimentación',1),('EXPENSE','Transporte',2),
      ('EXPENSE','Combustible',3),('EXPENSE','Vivienda',4),
      ('EXPENSE','Servicios',5),('EXPENSE','Salud',6),
      ('EXPENSE','Entretenimiento',7),('EXPENSE','Educación',8),
      ('EXPENSE','Compras',9),('EXPENSE','Otros',10)
  ), ins AS (
    INSERT INTO public.categories(user_id,kind,name,sort_order)
    SELECT v_user,n.kind,n.name,n.sort_order FROM names n
    ON CONFLICT DO NOTHING RETURNING 1
  )
  SELECT count(*) INTO v_count FROM ins;
  RETURN v_count;
END;
$$;

-- 5. OPERACIONES FINANCIERAS ATÓMICAS -------------------------------------
-- Cada RPC completa cabecera, detalles y ledger en una transacción PostgreSQL.
-- Nunca se concede escritura directa a operations ni ledger_entries.

CREATE FUNCTION public.post_transaction(
  p_kind public.category_kind, p_category_id uuid, p_amount numeric,
  p_account_id uuid, p_card_id uuid, p_effective_on date,
  p_note text, p_idempotency_key text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_user uuid := app_private.require_user();
  v_op uuid; v_new boolean;
  v_account public.accounts%ROWTYPE;
  v_card public.cards%ROWTYPE;
  v_category_kind public.category_kind;
  v_account_id uuid;
  v_balance numeric(18,2);
  v_debt numeric(18,2);
BEGIN
  IF p_amount IS NULL OR p_amount<=0 OR round(p_amount,2)<>p_amount THEN
    RAISE EXCEPTION 'Monto inválido (máximo 2 decimales)';
  END IF;
  IF num_nonnulls(p_account_id,p_card_id)<>1
     OR (p_kind='INCOME' AND p_card_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Origen: una cuenta o una tarjeta (ingreso solo cuenta)';
  END IF;

  SELECT operation_id,is_new INTO v_op,v_new
  FROM app_private.begin_operation(
    CASE WHEN p_kind='INCOME' THEN 'INCOME'::public.operation_kind
         ELSE 'EXPENSE'::public.operation_kind END,
    p_effective_on,p_note,p_idempotency_key,
    jsonb_build_object('kind',p_kind,'category',p_category_id,'amount',p_amount,
      'account',p_account_id,'card',p_card_id,'date',p_effective_on,'note',p_note));
  IF NOT v_new THEN RETURN v_op; END IF;

  SELECT kind INTO v_category_kind
  FROM public.categories
  WHERE user_id=v_user AND id=p_category_id AND is_active;
  IF NOT FOUND OR v_category_kind<>p_kind THEN
    RAISE EXCEPTION 'Categoría no válida o archivada';
  END IF;

  IF p_card_id IS NOT NULL THEN
    SELECT * INTO v_card
    FROM public.cards
    WHERE id=p_card_id AND user_id=v_user
    FOR UPDATE;
    IF NOT FOUND OR NOT v_card.is_active THEN
      RAISE EXCEPTION 'Tarjeta no válida o inactiva';
    END IF;
    IF v_card.kind='DEBIT' THEN
      v_account_id:=v_card.account_id;
    ELSE
      v_debt:=app_private.card_debt(v_user,v_card.id);
      IF v_card.enforce_credit_limit AND v_debt+p_amount>v_card.credit_limit THEN
        RAISE EXCEPTION 'Compra supera el límite configurado de la tarjeta';
      END IF;
    END IF;
  ELSE
    v_account_id:=p_account_id;
  END IF;

  IF v_account_id IS NOT NULL THEN
    SELECT * INTO v_account
    FROM public.accounts
    WHERE id=v_account_id AND user_id=v_user
    FOR UPDATE;
    IF NOT FOUND OR NOT v_account.is_active OR v_account.currency<>'USD' THEN
      RAISE EXCEPTION 'Cuenta no válida, inactiva o de moneda incompatible';
    END IF;
    IF p_kind='EXPENSE' THEN
      v_balance:=app_private.account_balance(v_user,v_account.id);
      IF NOT v_account.allow_overdraft AND v_balance-p_amount<0 THEN
        RAISE EXCEPTION 'Fondos insuficientes; la cuenta no permite sobregiro';
      END IF;
    END IF;
  END IF;

  INSERT INTO public.transactions(
    user_id,operation_id,kind,category_id,source_account_id,source_card_id,
    amount,description)
  VALUES(v_user,v_op,p_kind,p_category_id,p_account_id,p_card_id,p_amount,p_note);

  IF v_account_id IS NOT NULL THEN
    INSERT INTO public.ledger_entries(
      user_id,operation_id,entry_no,account_id,delta)
    VALUES(v_user,v_op,1,v_account_id,
      CASE WHEN p_kind='INCOME' THEN p_amount ELSE -p_amount END);
  ELSE
    INSERT INTO public.ledger_entries(
      user_id,operation_id,entry_no,card_id,delta)
    VALUES(v_user,v_op,1,p_card_id,p_amount);
  END IF;
  RETURN v_op;
END;
$$;

CREATE FUNCTION public.post_transfer(
  p_from_account uuid, p_to_account uuid, p_amount numeric,
  p_effective_on date, p_note text, p_idempotency_key text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_user uuid := app_private.require_user();
  v_op uuid; v_new boolean;
  v_account public.accounts%ROWTYPE;
  v_from public.accounts%ROWTYPE;
  v_count integer:=0;
  v_balance numeric(18,2);
BEGIN
  IF p_from_account IS NULL OR p_to_account IS NULL
     OR p_from_account=p_to_account OR p_amount IS NULL OR p_amount<=0
     OR round(p_amount,2)<>p_amount THEN
    RAISE EXCEPTION 'Transferencia inválida';
  END IF;

  SELECT operation_id,is_new INTO v_op,v_new
  FROM app_private.begin_operation(
    'TRANSFER',p_effective_on,p_note,p_idempotency_key,
    jsonb_build_object('from',p_from_account,'to',p_to_account,'amount',p_amount,
      'date',p_effective_on,'note',p_note));
  IF NOT v_new THEN RETURN v_op; END IF;

  FOR v_account IN
    SELECT * FROM public.accounts
    WHERE user_id=v_user AND id IN(p_from_account,p_to_account)
    ORDER BY id FOR UPDATE
  LOOP
    IF NOT v_account.is_active OR v_account.currency<>'USD' THEN
      RAISE EXCEPTION 'Cuenta inactiva o moneda incompatible';
    END IF;
    IF v_account.id=p_from_account THEN v_from:=v_account; END IF;
    v_count:=v_count+1;
  END LOOP;
  IF v_count<>2 THEN
    RAISE EXCEPTION 'Cuenta de origen o destino no encontrada';
  END IF;
  v_balance:=app_private.account_balance(v_user,p_from_account);
  IF NOT v_from.allow_overdraft AND v_balance-p_amount<0 THEN
    RAISE EXCEPTION 'Fondos insuficientes; la cuenta de origen no permite sobregiro';
  END IF;

  INSERT INTO public.transfers(
    user_id,operation_id,from_account_id,to_account_id,amount)
  VALUES(v_user,v_op,p_from_account,p_to_account,p_amount);
  INSERT INTO public.ledger_entries(
    user_id,operation_id,entry_no,account_id,delta)
  VALUES
    (v_user,v_op,1,p_from_account,-p_amount),
    (v_user,v_op,2,p_to_account,p_amount);
  RETURN v_op;
END;
$$;

CREATE FUNCTION public.post_card_payment(
  p_card_id uuid, p_account_id uuid, p_amount numeric, p_statement_id uuid,
  p_effective_on date, p_note text, p_idempotency_key text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_user uuid := app_private.require_user();
  v_op uuid; v_new boolean;
  v_card public.cards%ROWTYPE;
  v_account public.accounts%ROWTYPE;
  v_statement public.credit_card_statements%ROWTYPE;
  v_debt numeric(18,2); v_balance numeric(18,2); v_applied numeric(18,2);
BEGIN
  IF p_amount IS NULL OR p_amount<=0 OR round(p_amount,2)<>p_amount THEN
    RAISE EXCEPTION 'Monto inválido';
  END IF;
  SELECT operation_id,is_new INTO v_op,v_new
  FROM app_private.begin_operation(
    'CARD_PAYMENT',p_effective_on,p_note,p_idempotency_key,
    jsonb_build_object('card',p_card_id,'account',p_account_id,'amount',p_amount,
      'statement',p_statement_id,'date',p_effective_on,'note',p_note));
  IF NOT v_new THEN RETURN v_op; END IF;

  SELECT * INTO v_account
  FROM public.accounts
  WHERE id=p_account_id AND user_id=v_user
  FOR UPDATE;
  IF NOT FOUND OR NOT v_account.is_active OR v_account.currency<>'USD' THEN
    RAISE EXCEPTION 'Cuenta de pago no válida';
  END IF;
  SELECT * INTO v_card
  FROM public.cards
  WHERE id=p_card_id AND user_id=v_user
  FOR UPDATE;
  IF NOT FOUND OR v_card.kind<>'CREDIT' OR NOT v_card.is_active THEN
    RAISE EXCEPTION 'Tarjeta de crédito no válida';
  END IF;

  v_balance:=app_private.account_balance(v_user,p_account_id);
  IF NOT v_account.allow_overdraft AND v_balance-p_amount<0 THEN
    RAISE EXCEPTION 'Fondos insuficientes para pagar la tarjeta';
  END IF;
  v_debt:=app_private.card_debt(v_user,p_card_id);
  IF p_amount>v_debt THEN
    RAISE EXCEPTION 'Pago mayor que deuda actual';
  END IF;

  IF p_statement_id IS NOT NULL THEN
    SELECT * INTO v_statement
    FROM public.credit_card_statements
    WHERE id=p_statement_id AND card_id=p_card_id AND user_id=v_user
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Estado de cuenta no corresponde a tarjeta';
    END IF;
    SELECT coalesce(sum(cp.amount),0) INTO v_applied
    FROM public.card_payments cp
    WHERE cp.user_id=v_user AND cp.statement_id=p_statement_id
      AND NOT EXISTS(
        SELECT 1 FROM public.operations r WHERE r.reversal_of=cp.operation_id
      );
    IF p_amount>v_statement.statement_balance-v_applied THEN
      RAISE EXCEPTION 'Pago supera saldo restante del estado de cuenta';
    END IF;
  END IF;

  INSERT INTO public.card_payments(
    user_id,operation_id,card_id,account_id,statement_id,amount)
  VALUES(v_user,v_op,p_card_id,p_account_id,p_statement_id,p_amount);
  INSERT INTO public.ledger_entries(
    user_id,operation_id,entry_no,account_id,delta)
  VALUES(v_user,v_op,1,p_account_id,-p_amount);
  INSERT INTO public.ledger_entries(
    user_id,operation_id,entry_no,card_id,delta)
  VALUES(v_user,v_op,2,p_card_id,-p_amount);
  RETURN v_op;
END;
$$;

CREATE FUNCTION public.post_loan_disbursement(
  p_loan_id uuid, p_account_id uuid, p_amount numeric,
  p_effective_on date, p_note text, p_idempotency_key text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_user uuid := app_private.require_user();
  v_op uuid; v_new boolean;
  v_loan public.loans%ROWTYPE;
  v_account public.accounts%ROWTYPE;
  v_disbursed numeric(18,2);
BEGIN
  IF p_amount IS NULL OR p_amount<=0 OR round(p_amount,2)<>p_amount THEN
    RAISE EXCEPTION 'Monto inválido';
  END IF;
  SELECT operation_id,is_new INTO v_op,v_new
  FROM app_private.begin_operation(
    'LOAN_DISBURSEMENT',p_effective_on,p_note,p_idempotency_key,
    jsonb_build_object('loan',p_loan_id,'account',p_account_id,'amount',p_amount,
      'date',p_effective_on,'note',p_note));
  IF NOT v_new THEN RETURN v_op; END IF;

  SELECT * INTO v_account
  FROM public.accounts
  WHERE id=p_account_id AND user_id=v_user
  FOR UPDATE;
  IF NOT FOUND OR NOT v_account.is_active OR v_account.currency<>'USD' THEN
    RAISE EXCEPTION 'Cuenta no válida';
  END IF;
  SELECT * INTO v_loan
  FROM public.loans
  WHERE id=p_loan_id AND user_id=v_user
  FOR UPDATE;
  IF NOT FOUND OR NOT v_loan.is_active THEN
    RAISE EXCEPTION 'Préstamo no válido';
  END IF;
  IF v_loan.balance_mode<>'TRACKED_DISBURSEMENTS' THEN
    RAISE EXCEPTION 'La deuda inicial ya representa este préstamo; no debe desembolsarse otra vez';
  END IF;

  SELECT coalesce(sum(le.delta),0)::numeric(18,2) INTO v_disbursed
  FROM public.ledger_entries le
  JOIN public.operations o
    ON o.user_id=le.user_id AND o.id=le.operation_id
  WHERE le.user_id=v_user AND le.loan_id=p_loan_id
    AND o.kind='LOAN_DISBURSEMENT' AND le.delta>0
    AND NOT EXISTS(
      SELECT 1 FROM public.operations r WHERE r.reversal_of=o.id
    );
  IF v_disbursed+p_amount>v_loan.original_amount THEN
    RAISE EXCEPTION 'Desembolsos acumulados superan el monto original del préstamo';
  END IF;

  INSERT INTO public.ledger_entries(
    user_id,operation_id,entry_no,account_id,delta)
  VALUES(v_user,v_op,1,p_account_id,p_amount);
  INSERT INTO public.ledger_entries(
    user_id,operation_id,entry_no,loan_id,delta)
  VALUES(v_user,v_op,2,p_loan_id,p_amount);
  RETURN v_op;
END;
$$;

CREATE FUNCTION public.post_loan_payment(
  p_loan_id uuid, p_account_id uuid, p_principal numeric,
  p_interest numeric, p_fees numeric, p_interest_category uuid,
  p_fee_category uuid, p_effective_on date, p_note text,
  p_idempotency_key text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_user uuid := app_private.require_user();
  v_op uuid; v_new boolean;
  v_loan public.loans%ROWTYPE;
  v_account public.accounts%ROWTYPE;
  v_debt numeric(18,2); v_balance numeric(18,2); v_total numeric(18,2);
BEGIN
  IF p_principal IS NULL OR p_interest IS NULL OR p_fees IS NULL
     OR least(p_principal,p_interest,p_fees)<0
     OR p_principal+p_interest+p_fees<=0
     OR round(p_principal,2)<>p_principal
     OR round(p_interest,2)<>p_interest
     OR round(p_fees,2)<>p_fees THEN
    RAISE EXCEPTION 'Desglose inválido';
  END IF;
  v_total:=p_principal+p_interest+p_fees;
  SELECT operation_id,is_new INTO v_op,v_new
  FROM app_private.begin_operation(
    'LOAN_PAYMENT',p_effective_on,p_note,p_idempotency_key,
    jsonb_build_object('loan',p_loan_id,'account',p_account_id,
      'principal',p_principal,'interest',p_interest,'fees',p_fees,
      'interest_category',p_interest_category,'fee_category',p_fee_category,
      'date',p_effective_on,'note',p_note));
  IF NOT v_new THEN RETURN v_op; END IF;

  IF p_interest>0 AND NOT EXISTS(
    SELECT 1 FROM public.categories
    WHERE id=p_interest_category AND user_id=v_user
      AND kind='EXPENSE' AND is_active
  ) THEN
    RAISE EXCEPTION 'Categoría de intereses inválida';
  END IF;
  IF p_fees>0 AND NOT EXISTS(
    SELECT 1 FROM public.categories
    WHERE id=p_fee_category AND user_id=v_user
      AND kind='EXPENSE' AND is_active
  ) THEN
    RAISE EXCEPTION 'Categoría de comisiones inválida';
  END IF;

  SELECT * INTO v_account
  FROM public.accounts
  WHERE id=p_account_id AND user_id=v_user
  FOR UPDATE;
  IF NOT FOUND OR NOT v_account.is_active OR v_account.currency<>'USD' THEN
    RAISE EXCEPTION 'Cuenta no válida';
  END IF;
  SELECT * INTO v_loan
  FROM public.loans
  WHERE id=p_loan_id AND user_id=v_user
  FOR UPDATE;
  IF NOT FOUND OR NOT v_loan.is_active THEN
    RAISE EXCEPTION 'Préstamo no válido';
  END IF;

  v_balance:=app_private.account_balance(v_user,p_account_id);
  IF NOT v_account.allow_overdraft AND v_balance-v_total<0 THEN
    RAISE EXCEPTION 'Fondos insuficientes para pagar el préstamo';
  END IF;
  v_debt:=app_private.loan_debt(v_user,p_loan_id);
  IF p_principal>v_debt THEN
    RAISE EXCEPTION 'Abono a capital supera saldo adeudado';
  END IF;

  INSERT INTO public.loan_payments(
    user_id,operation_id,loan_id,account_id,principal,interest,fees)
  VALUES(v_user,v_op,p_loan_id,p_account_id,p_principal,p_interest,p_fees);
  INSERT INTO public.ledger_entries(
    user_id,operation_id,entry_no,account_id,delta)
  VALUES(v_user,v_op,1,p_account_id,-v_total);
  IF p_principal>0 THEN
    INSERT INTO public.ledger_entries(
      user_id,operation_id,entry_no,loan_id,delta)
    VALUES(v_user,v_op,2,p_loan_id,-p_principal);
  END IF;
  IF p_interest>0 THEN
    INSERT INTO public.transactions(
      user_id,operation_id,kind,category_id,source_account_id,amount,description)
    VALUES(v_user,v_op,'EXPENSE',p_interest_category,p_account_id,p_interest,
      'Intereses de préstamo');
  END IF;
  IF p_fees>0 THEN
    INSERT INTO public.transactions(
      user_id,operation_id,kind,category_id,source_account_id,amount,description)
    VALUES(v_user,v_op,'EXPENSE',p_fee_category,p_account_id,p_fees,
      'Comisiones de préstamo');
  END IF;
  RETURN v_op;
END;
$$;

CREATE FUNCTION public.post_adjustment(
  p_account_id uuid, p_card_id uuid, p_loan_id uuid, p_delta numeric,
  p_effective_on date, p_reason text, p_idempotency_key text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_user uuid := app_private.require_user();
  v_op uuid; v_new boolean;
  v_account public.accounts%ROWTYPE;
  v_debt numeric(18,2);
BEGIN
  IF num_nonnulls(p_account_id,p_card_id,p_loan_id)<>1
     OR p_delta IS NULL OR p_delta=0 OR round(p_delta,2)<>p_delta
     OR length(btrim(coalesce(p_reason,''))) NOT BETWEEN 5 AND 1000 THEN
    RAISE EXCEPTION 'Ajuste o justificación inválidos';
  END IF;
  SELECT operation_id,is_new INTO v_op,v_new
  FROM app_private.begin_operation(
    'ADJUSTMENT',p_effective_on,p_reason,p_idempotency_key,
    jsonb_build_object('account',p_account_id,'card',p_card_id,'loan',p_loan_id,
      'delta',p_delta,'date',p_effective_on,'reason',p_reason));
  IF NOT v_new THEN RETURN v_op; END IF;

  IF p_account_id IS NOT NULL THEN
    SELECT * INTO v_account
    FROM public.accounts
    WHERE id=p_account_id AND user_id=v_user
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Cuenta desconocida'; END IF;
    IF NOT v_account.allow_overdraft
       AND app_private.account_balance(v_user,p_account_id)+p_delta<0 THEN
      RAISE EXCEPTION 'Ajuste deja saldo de cuenta negativo';
    END IF;
  ELSIF p_card_id IS NOT NULL THEN
    PERFORM 1 FROM public.cards
    WHERE id=p_card_id AND user_id=v_user AND kind='CREDIT'
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Tarjeta de crédito desconocida'; END IF;
    v_debt:=app_private.card_debt(v_user,p_card_id);
    IF v_debt+p_delta<0 THEN
      RAISE EXCEPTION 'Deuda de tarjeta no puede ser negativa';
    END IF;
  ELSE
    PERFORM 1 FROM public.loans
    WHERE id=p_loan_id AND user_id=v_user
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Préstamo desconocido'; END IF;
    v_debt:=app_private.loan_debt(v_user,p_loan_id);
    IF v_debt+p_delta<0 THEN
      RAISE EXCEPTION 'Deuda de préstamo no puede ser negativa';
    END IF;
  END IF;

  INSERT INTO public.financial_adjustments(
    user_id,operation_id,account_id,card_id,loan_id,delta,reason)
  VALUES(v_user,v_op,p_account_id,p_card_id,p_loan_id,p_delta,p_reason);
  INSERT INTO public.ledger_entries(
    user_id,operation_id,entry_no,account_id,card_id,loan_id,delta)
  VALUES(v_user,v_op,1,p_account_id,p_card_id,p_loan_id,p_delta);
  RETURN v_op;
END;
$$;

CREATE FUNCTION public.reverse_operation(
  p_original uuid, p_effective_on date, p_reason text, p_idempotency_key text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_user uuid := app_private.require_user();
  v_original public.operations%ROWTYPE;
  v_op uuid; v_new boolean;
  v_entry public.ledger_entries%ROWTYPE;
  v_target record;
  v_account public.accounts%ROWTYPE;
  v_current numeric(18,2);
BEGIN
  IF length(btrim(coalesce(p_reason,'')))<5 THEN
    RAISE EXCEPTION 'Justificación obligatoria (mínimo 5 caracteres)';
  END IF;
  PERFORM app_private.lock_financial_user(v_user);
  SELECT * INTO v_original
  FROM public.operations
  WHERE id=p_original AND user_id=v_user
  FOR UPDATE;
  IF NOT FOUND OR v_original.kind='REVERSAL' THEN
    RAISE EXCEPTION 'Operación original no válida';
  END IF;

  SELECT operation_id,is_new INTO v_op,v_new
  FROM app_private.begin_operation(
    'REVERSAL',p_effective_on,p_reason,p_idempotency_key,
    jsonb_build_object('original',p_original,'date',p_effective_on,'reason',p_reason),
    p_original);
  IF NOT v_new THEN RETURN v_op; END IF;

  -- Se bloquean y validan primero cuentas, luego tarjetas y préstamos. La
  -- cerradura asesora por usuario impide carreras con cualquier otra RPC.
  FOR v_target IN
    SELECT account_id AS id,(-sum(delta))::numeric(18,2) AS reversal_delta
    FROM public.ledger_entries
    WHERE user_id=v_user AND operation_id=p_original AND account_id IS NOT NULL
    GROUP BY account_id ORDER BY account_id
  LOOP
    SELECT * INTO v_account
    FROM public.accounts WHERE id=v_target.id AND user_id=v_user
    FOR UPDATE;
    v_current:=app_private.account_balance(v_user,v_target.id);
    IF NOT v_account.allow_overdraft AND v_current+v_target.reversal_delta<0 THEN
      RAISE EXCEPTION 'Reverso deja saldo de cuenta negativo';
    END IF;
  END LOOP;

  FOR v_target IN
    SELECT card_id AS id,(-sum(delta))::numeric(18,2) AS reversal_delta
    FROM public.ledger_entries
    WHERE user_id=v_user AND operation_id=p_original AND card_id IS NOT NULL
    GROUP BY card_id ORDER BY card_id
  LOOP
    PERFORM 1 FROM public.cards
    WHERE id=v_target.id AND user_id=v_user FOR UPDATE;
    v_current:=app_private.card_debt(v_user,v_target.id);
    IF v_current+v_target.reversal_delta<0 THEN
      RAISE EXCEPTION 'Reverso deja deuda de tarjeta negativa';
    END IF;
  END LOOP;

  FOR v_target IN
    SELECT loan_id AS id,(-sum(delta))::numeric(18,2) AS reversal_delta
    FROM public.ledger_entries
    WHERE user_id=v_user AND operation_id=p_original AND loan_id IS NOT NULL
    GROUP BY loan_id ORDER BY loan_id
  LOOP
    PERFORM 1 FROM public.loans
    WHERE id=v_target.id AND user_id=v_user FOR UPDATE;
    v_current:=app_private.loan_debt(v_user,v_target.id);
    IF v_current+v_target.reversal_delta<0 THEN
      RAISE EXCEPTION 'Reverso deja deuda de préstamo negativa';
    END IF;
  END LOOP;

  FOR v_entry IN
    SELECT * FROM public.ledger_entries
    WHERE user_id=v_user AND operation_id=p_original
    ORDER BY entry_no
  LOOP
    INSERT INTO public.ledger_entries(
      user_id,operation_id,entry_no,account_id,card_id,loan_id,delta)
    VALUES(v_user,v_op,v_entry.entry_no,v_entry.account_id,
      v_entry.card_id,v_entry.loan_id,-v_entry.delta);
  END LOOP;

  INSERT INTO public.transactions(
    user_id,operation_id,kind,category_id,source_account_id,source_card_id,
    amount,effect_sign,description)
  SELECT v_user,v_op,kind,category_id,source_account_id,source_card_id,
    amount,-effect_sign,'Reverso: '||coalesce(description,'')
  FROM public.transactions
  WHERE user_id=v_user AND operation_id=p_original;
  RETURN v_op;
END;
$$;

CREATE FUNCTION public.post_recurring_occurrence(
  p_occurrence uuid, p_note text, p_idempotency_key text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_user uuid := app_private.require_user();
  v_occ public.recurring_occurrences%ROWTYPE;
  v_rule public.recurring_transactions%ROWTYPE;
  v_op uuid; v_old_key text;
BEGIN
  PERFORM app_private.lock_financial_user(v_user);
  SELECT * INTO v_occ
  FROM public.recurring_occurrences
  WHERE id=p_occurrence AND user_id=v_user
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ocurrencia desconocida'; END IF;
  IF v_occ.status='CONFIRMED' THEN
    SELECT idempotency_key INTO v_old_key
    FROM public.operations WHERE id=v_occ.operation_id AND user_id=v_user;
    IF v_old_key=p_idempotency_key THEN RETURN v_occ.operation_id; END IF;
    RAISE EXCEPTION 'Ocurrencia ya confirmada con otra clave';
  END IF;
  IF v_occ.status<>'PENDING' THEN
    RAISE EXCEPTION 'Ocurrencia no pendiente';
  END IF;
  SELECT * INTO v_rule
  FROM public.recurring_transactions
  WHERE id=v_occ.recurring_id AND user_id=v_user AND status<>'ENDED';
  IF NOT FOUND THEN RAISE EXCEPTION 'Regla recurrente no disponible'; END IF;

  v_op:=public.post_transaction(
    v_rule.kind,v_rule.category_id,v_rule.amount,v_rule.account_id,v_rule.card_id,
    v_occ.scheduled_on,p_note,p_idempotency_key);
  PERFORM public.confirm_recurring_occurrence(p_occurrence,v_op);
  RETURN v_op;
END;
$$;

CREATE FUNCTION public.skip_recurring_occurrence(p_occurrence uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_user uuid := app_private.require_user();
BEGIN
  PERFORM app_private.lock_financial_user(v_user);
  UPDATE public.recurring_occurrences
  SET status='SKIPPED'
  WHERE id=p_occurrence AND user_id=v_user AND status='PENDING';
  IF NOT FOUND THEN RAISE EXCEPTION 'Ocurrencia no pendiente'; END IF;
END;
$$;

-- 6. VISTAS SEGURAS, SALDOS Y DASHBOARD -----------------------------------
CREATE VIEW public.v_account_balances WITH (security_invoker=true) AS
SELECT a.id,a.user_id,a.name,a.kind,a.is_active,a.currency,a.allow_overdraft,
  (a.opening_balance+coalesce(x.delta,0))::numeric(18,2) AS current_balance
FROM public.accounts a
LEFT JOIN (
  SELECT user_id,account_id,sum(delta)::numeric(18,2) AS delta
  FROM public.ledger_entries
  WHERE account_id IS NOT NULL
  GROUP BY user_id,account_id
) x ON x.user_id=a.user_id AND x.account_id=a.id;

CREATE VIEW public.v_card_balances WITH (security_invoker=true) AS
SELECT c.id,c.user_id,c.name,c.kind,c.is_active,c.credit_limit,
  c.enforce_credit_limit,
  (coalesce(c.opening_debt,0)+coalesce(x.delta,0))::numeric(18,2) AS current_debt,
  CASE WHEN c.kind='CREDIT' THEN
    (c.credit_limit-coalesce(c.opening_debt,0)-coalesce(x.delta,0))::numeric(18,2)
  END AS available_credit,
  CASE WHEN c.kind='CREDIT' THEN
    greatest(0,coalesce(c.opening_debt,0)+coalesce(x.delta,0)-c.credit_limit)::numeric(18,2)
  END AS over_limit_amount
FROM public.cards c
LEFT JOIN (
  SELECT user_id,card_id,sum(delta)::numeric(18,2) AS delta
  FROM public.ledger_entries
  WHERE card_id IS NOT NULL
  GROUP BY user_id,card_id
) x ON x.user_id=c.user_id AND x.card_id=c.id;

CREATE VIEW public.v_loan_balances WITH (security_invoker=true) AS
SELECT l.id,l.user_id,l.name,l.lender,l.is_active,l.original_amount,l.balance_mode,
  (l.opening_debt+coalesce(x.delta,0))::numeric(18,2) AS current_debt
FROM public.loans l
LEFT JOIN (
  SELECT user_id,loan_id,sum(delta)::numeric(18,2) AS delta
  FROM public.ledger_entries
  WHERE loan_id IS NOT NULL
  GROUP BY user_id,loan_id
) x ON x.user_id=l.user_id AND x.loan_id=l.id;

CREATE VIEW public.v_card_statements WITH (security_invoker=true) AS
SELECT s.*,
  coalesce(p.applied,0)::numeric(18,2) AS payments_applied,
  greatest(0,s.statement_balance-coalesce(p.applied,0))::numeric(18,2)
    AS statement_remaining
FROM public.credit_card_statements s
LEFT JOIN (
  SELECT cp.user_id,cp.statement_id,sum(cp.amount)::numeric(18,2) AS applied
  FROM public.card_payments cp
  WHERE cp.statement_id IS NOT NULL
    AND NOT EXISTS(
      SELECT 1 FROM public.operations r WHERE r.reversal_of=cp.operation_id
    )
  GROUP BY cp.user_id,cp.statement_id
) p ON p.user_id=s.user_id AND p.statement_id=s.id;

-- Las operaciones anuladas se excluyen por completo del mes original y del
-- mes del reverso. El ledger sí conserva ambos asientos para auditoría.
CREATE VIEW public.v_monthly_category_expenses WITH (security_invoker=true) AS
SELECT t.user_id,date_trunc('month',o.effective_on::timestamp)::date AS month_start,
  t.category_id,c.name AS category_name,
  coalesce(sum(t.amount*t.effect_sign),0)::numeric(18,2) AS spent
FROM public.transactions t
JOIN public.operations o ON o.id=t.operation_id AND o.user_id=t.user_id
JOIN public.categories c ON c.id=t.category_id AND c.user_id=t.user_id
WHERE t.kind='EXPENSE' AND o.kind<>'REVERSAL'
  AND NOT EXISTS(
    SELECT 1 FROM public.operations r WHERE r.reversal_of=o.id
  )
GROUP BY t.user_id,date_trunc('month',o.effective_on::timestamp)::date,
  t.category_id,c.name;

CREATE VIEW public.v_monthly_financial_flow WITH (security_invoker=true) AS
SELECT t.user_id,date_trunc('month',o.effective_on::timestamp)::date AS month_start,
  coalesce(sum(CASE WHEN t.kind='INCOME' THEN t.amount*t.effect_sign ELSE 0 END),0)::numeric(18,2) AS income,
  coalesce(sum(CASE WHEN t.kind='EXPENSE' THEN t.amount*t.effect_sign ELSE 0 END),0)::numeric(18,2) AS expense,
  coalesce(sum(CASE WHEN t.kind='INCOME' THEN t.amount*t.effect_sign
                    ELSE -t.amount*t.effect_sign END),0)::numeric(18,2) AS balance
FROM public.transactions t
JOIN public.operations o ON o.id=t.operation_id AND o.user_id=t.user_id
WHERE o.kind<>'REVERSAL'
  AND NOT EXISTS(
    SELECT 1 FROM public.operations r WHERE r.reversal_of=o.id
  )
GROUP BY t.user_id,date_trunc('month',o.effective_on::timestamp)::date;

CREATE VIEW public.v_budget_progress WITH (security_invoker=true) AS
SELECT b.id,b.user_id,b.month_start,b.category_id,b.amount AS budget,
  CASE WHEN b.category_id IS NULL THEN
    coalesce((
      SELECT sum(x.spent)
      FROM public.v_monthly_category_expenses x
      WHERE x.user_id=b.user_id AND x.month_start=b.month_start
    ),0)
  ELSE coalesce((
    SELECT x.spent
    FROM public.v_monthly_category_expenses x
    WHERE x.user_id=b.user_id AND x.month_start=b.month_start
      AND x.category_id=b.category_id
  ),0) END::numeric(18,2) AS spent
FROM public.budgets b;

CREATE FUNCTION public.preview_card_dates(p_card_id uuid,p_month date)
RETURNS TABLE(cutoff_on date,due_on date)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  WITH c AS (
    SELECT cutoff_day,due_day,due_month_offset
    FROM public.cards
    WHERE id=p_card_id AND user_id=(SELECT auth.uid()) AND kind='CREDIT'
  ), months AS (
    SELECT date_trunc('month',p_month::timestamp)::date AS first_day
  ), bases AS (
    SELECT m.first_day,
      (m.first_day+make_interval(months=>c.due_month_offset))::date AS due_first,
      c.cutoff_day,c.due_day
    FROM months m CROSS JOIN c
  )
  SELECT
    (b.first_day+least(b.cutoff_day,
      extract(day FROM (b.first_day+interval '1 month - 1 day'))::int)-1)::date,
    (b.due_first+least(b.due_day,
      extract(day FROM (b.due_first+interval '1 month - 1 day'))::int)-1)::date
  FROM bases b
  WHERE p_month IS NOT NULL AND public.is_authorized();
$$;

CREATE FUNCTION public.get_dashboard(p_month date)
RETURNS TABLE(
  month_start date,income numeric,expense numeric,balance numeric,
  cash_available numeric,credit_debt numeric,loan_debt numeric,
  total_debt numeric,net_worth numeric)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  WITH mo AS (
    SELECT date_trunc('month',p_month::timestamp)::date AS d
  ), f AS (
    SELECT coalesce(sum(z.income),0)::numeric(18,2) AS income,
      coalesce(sum(z.expense),0)::numeric(18,2) AS expense,
      coalesce(sum(z.balance),0)::numeric(18,2) AS balance
    FROM public.v_monthly_financial_flow z
    WHERE z.user_id=(SELECT auth.uid()) AND z.month_start=(SELECT d FROM mo)
  ), a AS (
    SELECT coalesce(sum(current_balance),0)::numeric(18,2) AS s
    FROM public.v_account_balances WHERE user_id=(SELECT auth.uid())
  ), c AS (
    SELECT coalesce(sum(current_debt),0)::numeric(18,2) AS s
    FROM public.v_card_balances
    WHERE user_id=(SELECT auth.uid()) AND kind='CREDIT'
  ), l AS (
    SELECT coalesce(sum(current_debt),0)::numeric(18,2) AS s
    FROM public.v_loan_balances WHERE user_id=(SELECT auth.uid())
  )
  SELECT mo.d,f.income,f.expense,f.balance,a.s,c.s,l.s,
    (c.s+l.s)::numeric(18,2),
    (a.s-c.s-l.s)::numeric(18,2)
  FROM mo CROSS JOIN f CROSS JOIN a CROSS JOIN c CROSS JOIN l
  WHERE p_month IS NOT NULL AND public.is_authorized();
$$;

CREATE FUNCTION public.get_monthly_expenses(p_month date)
RETURNS TABLE(category_id uuid,category_name text,spent numeric)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT x.category_id,x.category_name,x.spent
  FROM public.v_monthly_category_expenses x
  WHERE public.is_authorized() AND p_month IS NOT NULL
    AND x.user_id=(SELECT auth.uid())
    AND x.month_start=date_trunc('month',p_month::timestamp)::date
  ORDER BY x.spent DESC,x.category_name;
$$;

-- 7. RLS Y MÍNIMO PRIVILEGIO ----------------------------------------------
DO $$
DECLARE v_name text;
BEGIN
  FOREACH v_name IN ARRAY ARRAY[
    'allowed_users','profiles','accounts','categories','cards','loans',
    'operations','ledger_entries','transactions','transfers',
    'credit_card_statements','card_payments','loan_payments',
    'financial_adjustments','budgets','recurring_transactions',
    'recurring_occurrences','import_history'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',v_name);
    EXECUTE format(
      'REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated',v_name);
  END LOOP;
END;
$$;

-- Sin política ni GRANT sobre allowed_users: solo propietario/Supabase SQL.
DO $$
DECLARE v_name text;
BEGIN
  FOREACH v_name IN ARRAY ARRAY[
    'profiles','accounts','categories','cards','loans','operations',
    'ledger_entries','transactions','transfers','credit_card_statements',
    'card_payments','loan_payments','financial_adjustments','budgets',
    'recurring_transactions','recurring_occurrences','import_history'
  ] LOOP
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (user_id=(SELECT auth.uid()) AND (SELECT public.is_authorized()))',
      'select_self_'||v_name,v_name);
    EXECUTE format('GRANT SELECT ON TABLE public.%I TO authenticated',v_name);
  END LOOP;
END;
$$;

-- Escritura directa solo para configuración/documentos. Todas las operaciones
-- financieras y confirmaciones recurrentes se hacen mediante RPC.
DO $$
DECLARE v_name text;
BEGIN
  FOREACH v_name IN ARRAY ARRAY[
    'accounts','categories','cards','loans','credit_card_statements',
    'budgets','recurring_transactions'
  ] LOOP
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (user_id=(SELECT auth.uid()) AND (SELECT public.is_authorized()))',
      'insert_self_'||v_name,v_name);
    EXECUTE format('GRANT INSERT ON TABLE public.%I TO authenticated',v_name);
  END LOOP;
END;
$$;

DO $$
DECLARE v_name text;
BEGIN
  FOREACH v_name IN ARRAY ARRAY[
    'profiles','accounts','categories','cards','loans','credit_card_statements',
    'budgets','recurring_transactions'
  ] LOOP
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (user_id=(SELECT auth.uid()) AND (SELECT public.is_authorized())) WITH CHECK (user_id=(SELECT auth.uid()) AND (SELECT public.is_authorized()))',
      'update_self_'||v_name,v_name);
  END LOOP;
END;
$$;

GRANT UPDATE(display_name) ON public.profiles TO authenticated;
GRANT UPDATE(name,is_active,description,allow_overdraft) ON public.accounts TO authenticated;
GRANT UPDATE(name,icon,color,sort_order,is_active) ON public.categories TO authenticated;
GRANT UPDATE(name,issuer,last_four,credit_limit,enforce_credit_limit,
  cutoff_day,due_day,due_month_offset,is_active) ON public.cards TO authenticated;
GRANT UPDATE(name,lender,annual_interest_rate,expected_installment,due_day,
  is_active,notes) ON public.loans TO authenticated;
GRANT UPDATE(due_on,minimum_payment,statement_balance,notes)
  ON public.credit_card_statements TO authenticated;
GRANT UPDATE(amount,category_id,month_start) ON public.budgets TO authenticated;
GRANT UPDATE(name,kind,category_id,amount,account_id,card_id,frequency,
  anchor_day,next_on,status,notes) ON public.recurring_transactions TO authenticated;

CREATE POLICY delete_self_budgets
ON public.budgets FOR DELETE TO authenticated
USING (user_id=(SELECT auth.uid()) AND (SELECT public.is_authorized()));
GRANT DELETE ON public.budgets TO authenticated;

REVOKE CREATE ON SCHEMA public FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA public TO service_role;

DO $$
DECLARE v_func record;
BEGIN
  FOR v_func IN
    SELECT p.oid::regprocedure AS signature
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname IN ('public','app_private')
      AND p.proname IN (
        'is_authorized','require_user','lock_financial_user','account_balance',
        'card_debt','loan_debt','before_user_created','sync_profile',
        'ensure_profile','touch_updated_at','validate_statement',
        'validate_statement_amount','validate_overdraft_setting',
        'next_recurring_date','begin_operation','confirm_recurring_occurrence',
        'generate_occurrences_for_user','generate_pending_occurrences',
        'generate_pending_occurrences_all','seed_default_categories',
        'post_transaction','post_transfer','post_card_payment',
        'post_loan_disbursement','post_loan_payment','post_adjustment',
        'reverse_operation','post_recurring_occurrence',
        'skip_recurring_occurrence','preview_card_dates','get_dashboard',
        'get_monthly_expenses'
      )
  LOOP
    EXECUTE format(
      'REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated',
      v_func.signature);
  END LOOP;
END;
$$;

-- Hook Auth.
GRANT USAGE ON SCHEMA public TO supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.before_user_created(jsonb) TO supabase_auth_admin;

-- API autenticada.
GRANT EXECUTE ON FUNCTION public.is_authorized() TO authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_profile() TO authenticated;
GRANT EXECUTE ON FUNCTION public.seed_default_categories() TO authenticated;
GRANT EXECUTE ON FUNCTION public.post_transaction(
  public.category_kind,uuid,numeric,uuid,uuid,date,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.post_transfer(
  uuid,uuid,numeric,date,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.post_card_payment(
  uuid,uuid,numeric,uuid,date,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.post_loan_disbursement(
  uuid,uuid,numeric,date,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.post_loan_payment(
  uuid,uuid,numeric,numeric,numeric,uuid,uuid,date,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.post_adjustment(
  uuid,uuid,uuid,numeric,date,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reverse_operation(
  uuid,date,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.generate_pending_occurrences(date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.post_recurring_occurrence(uuid,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.skip_recurring_occurrence(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.preview_card_dates(uuid,date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_dashboard(date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_monthly_expenses(date) TO authenticated;

-- Únicamente el secreto server-side service_role puede ejecutar el cron global.
GRANT EXECUTE ON FUNCTION public.generate_pending_occurrences_all(date) TO service_role;
-- Trazabilidad de importaciones futuras desde un backend privilegiado.
GRANT SELECT,INSERT,UPDATE ON public.import_history TO service_role;

DO $$
DECLARE v_name text;
BEGIN
  FOREACH v_name IN ARRAY ARRAY[
    'v_account_balances','v_card_balances','v_loan_balances',
    'v_card_statements','v_monthly_category_expenses',
    'v_monthly_financial_flow','v_budget_progress'
  ] LOOP
    EXECUTE format(
      'REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated',v_name);
    EXECUTE format('GRANT SELECT ON TABLE public.%I TO authenticated',v_name);
  END LOOP;
END;
$$;

COMMIT;

-- Comprobaciones no destructivas posteriores al COMMIT.
SELECT tablename,rowsecurity
FROM pg_tables
WHERE schemaname='public' AND tablename IN (
  'allowed_users','profiles','accounts','categories','cards','loans',
  'operations','ledger_entries','transactions','transfers',
  'credit_card_statements','card_payments','loan_payments','budgets',
  'recurring_transactions','recurring_occurrences','financial_adjustments',
  'import_history')
ORDER BY tablename;

SELECT tablename,cmd,roles,policyname
FROM pg_policies
WHERE schemaname='public'
ORDER BY tablename,cmd,policyname;

SELECT routine_name,security_type
FROM information_schema.routines
WHERE routine_schema='public' AND routine_name IN (
  'post_transaction','post_transfer','post_card_payment',
  'post_loan_disbursement','post_loan_payment','reverse_operation',
  'get_dashboard','before_user_created')
ORDER BY routine_name;
