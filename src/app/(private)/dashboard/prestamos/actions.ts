"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type LoanActionState = {
  error: string | null;
  success: string | null;
};

const invalid = (error: string): LoanActionState => ({ error, success: null });
const done = (success: string): LoanActionState => ({ error: null, success });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function text(form: FormData, name: string): string {
  return String(form.get(name) ?? "").trim();
}

function money(raw: string, allowZero = false): number | null {
  if (!/^\d{1,12}(?:\.\d{1,2})?$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(Math.round(value * 100)) &&
    (allowZero ? value >= 0 : value > 0)
    ? value
    : null;
}

function optionalMoney(raw: string): number | null | undefined {
  if (!raw) return null;
  return money(raw);
}

function optionalRate(raw: string): number | null | undefined {
  if (!raw) return null;
  if (!/^\d{1,3}(?:\.\d{1,4})?$/.test(raw)) return undefined;
  const rate = Number(raw);
  return rate <= 100 ? rate : undefined;
}

function optionalDay(raw: string): number | null | undefined {
  if (!raw) return null;
  const day = Number(raw);
  return /^\d{1,2}$/.test(raw) && Number.isInteger(day) && day >= 1 && day <= 31
    ? day
    : undefined;
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(d.valueOf()) && d.toISOString().slice(0, 10) === value;
}

function refreshLoans(): void {
  for (const path of [
    "/dashboard", "/dashboard/prestamos", "/dashboard/cuentas",
    "/dashboard/movimientos",
  ]) revalidatePath(path);
}

export async function createLoan(
  _previous: LoanActionState,
  form: FormData,
): Promise<LoanActionState> {
  const name = text(form, "name");
  const lender = text(form, "lender");
  const mode = text(form, "balance_mode");
  const original = money(text(form, "original_amount"));
  const opening = mode === "OPENING_BALANCE"
    ? money(text(form, "opening_debt"))
    : 0;
  const startedOn = text(form, "started_on");
  const rate = optionalRate(text(form, "annual_interest_rate"));
  const installment = optionalMoney(text(form, "expected_installment"));
  const dueDay = optionalDay(text(form, "due_day"));
  const notes = text(form, "notes");

  if (!name || name.length > 120 || !lender || lender.length > 150) {
    return invalid("Ingresa un nombre y acreedor válidos.");
  }
  if (!['OPENING_BALANCE', 'TRACKED_DISBURSEMENTS'].includes(mode)) {
    return invalid("Seleccioná el tipo de préstamo.");
  }
  if (original === null || opening === null || opening > original) {
    return invalid("Verificá el monto original y la deuda inicial.");
  }
  if (!validDate(startedOn)) return invalid("La fecha de inicio no es válida.");
  if (rate === undefined || installment === undefined || dueDay === undefined) {
    return invalid("Verificá interés, cuota y día de pago.");
  }
  if (notes.length > 1000) return invalid("Las notas exceden 1,000 caracteres.");

  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return invalid("Iniciá sesión nuevamente.");

  const { error } = await supabase.from("loans").insert({
    user_id: user.id,
    name,
    lender,
    original_amount: original,
    opening_debt: opening,
    balance_mode: mode,
    started_on: startedOn,
    annual_interest_rate: rate,
    expected_installment: installment,
    due_day: dueDay,
    notes: notes || null,
  });

  if (error) return invalid(error.message);
  refreshLoans();
  return done(mode === "OPENING_BALANCE"
    ? "Préstamo existente registrado sin duplicar el desembolso."
    : "Préstamo creado. Registrá su desembolso cuando recibás el dinero.");
}

export async function updateLoan(
  _previous: LoanActionState,
  form: FormData,
): Promise<LoanActionState> {
  const loanId = text(form, "loan_id");
  const name = text(form, "name");
  const lender = text(form, "lender");
  const rate = optionalRate(text(form, "annual_interest_rate"));
  const installment = optionalMoney(text(form, "expected_installment"));
  const dueDay = optionalDay(text(form, "due_day"));
  const notes = text(form, "notes");

  if (!UUID.test(loanId)) return invalid("Préstamo inválido.");
  if (!name || name.length > 120 || !lender || lender.length > 150) {
    return invalid("Ingresá un nombre y acreedor válidos.");
  }
  if (rate === undefined || installment === undefined || dueDay === undefined) {
    return invalid("Verificá interés, cuota y día de pago.");
  }
  if (notes.length > 1000) return invalid("Las notas exceden 1,000 caracteres.");

  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return invalid("Iniciá sesión nuevamente.");

  // No modifica los importes de apertura ni la modalidad contable.
  const { data, error } = await supabase
    .from("loans")
    .update({
      name,
      lender,
      annual_interest_rate: rate,
      expected_installment: installment,
      due_day: dueDay,
      notes: notes || null,
    })
    .eq("id", loanId)
    .eq("user_id", user.id)
    .select("id")
    .maybeSingle();

  if (error) return invalid(error.message);
  if (!data) return invalid("No se encontró el préstamo.");
  refreshLoans();
  return done("Préstamo actualizado.");
}

export async function toggleLoan(
  _previous: LoanActionState,
  form: FormData,
): Promise<LoanActionState> {
  const loanId = text(form, "loan_id");
  if (!UUID.test(loanId)) return invalid("Préstamo inválido.");

  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return invalid("Iniciá sesión nuevamente.");

  const { data: loan, error: loanError } = await supabase.from("loans")
    .select("id,is_active")
    .eq("id", loanId).eq("user_id", user.id).maybeSingle();
  if (loanError) return invalid(loanError.message);
  if (!loan) return invalid("Préstamo no encontrado.");

  if (loan.is_active) {
    const { data: balance, error: balanceError } = await supabase
      .from("v_loan_balances")
      .select("current_debt")
      .eq("id", loanId).eq("user_id", user.id).maybeSingle();
    if (balanceError) return invalid(balanceError.message);
    if (!balance || Number(balance.current_debt) !== 0) {
      return invalid("No podés archivar un préstamo con deuda pendiente.");
    }
  }

  const { data, error } = await supabase.from("loans")
    .update({ is_active: !loan.is_active })
    .eq("id", loanId).eq("user_id", user.id)
    .eq("is_active", loan.is_active)
    .select("id").maybeSingle();
  if (error) return invalid(error.message);
  if (!data) return invalid("El préstamo cambió de estado. Actualizá la página.");
  refreshLoans();
  return done(loan.is_active ? "Préstamo archivado." : "Préstamo reactivado.");
}

export async function disburseLoan(
  _previous: LoanActionState,
  form: FormData,
): Promise<LoanActionState> {
  const loanId = text(form, "loan_id");
  const accountId = text(form, "account_id");
  const amount = money(text(form, "amount"));
  const effectiveOn = text(form, "effective_on");
  const note = text(form, "note");
  const key = text(form, "idempotency_key");

  if (!UUID.test(loanId) || !UUID.test(accountId) || !UUID.test(key)) {
    return invalid("Seleccioná el préstamo y la cuenta receptora.");
  }
  if (amount === null || !validDate(effectiveOn) || note.length > 1000) {
    return invalid("Verificá monto, fecha y nota.");
  }

  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return invalid("Iniciá sesión nuevamente.");

  const { error } = await supabase.rpc("post_loan_disbursement", {
    p_loan_id: loanId,
    p_account_id: accountId,
    p_amount: amount,
    p_effective_on: effectiveOn,
    p_note: note || null,
    p_idempotency_key: key,
  });
  if (error) return invalid(error.message);
  refreshLoans();
  return done("Desembolso registrado: aumenta el dinero disponible y la deuda.");
}

export async function payLoan(
  _previous: LoanActionState,
  form: FormData,
): Promise<LoanActionState> {
  const loanId = text(form, "loan_id");
  const accountId = text(form, "account_id");
  const principal = money(text(form, "principal") || "0", true);
  const interest = money(text(form, "interest") || "0", true);
  const fees = money(text(form, "fees") || "0", true);
  const interestCategory = text(form, "interest_category");
  const feeCategory = text(form, "fee_category");
  const effectiveOn = text(form, "effective_on");
  const note = text(form, "note");
  const key = text(form, "idempotency_key");

  if (!UUID.test(loanId) || !UUID.test(accountId) || !UUID.test(key)) {
    return invalid("Préstamo, cuenta o identificador no válidos.");
  }
  if (principal === null || interest === null || fees === null ||
      principal + interest + fees <= 0 || !validDate(effectiveOn)) {
    return invalid("Indicá un desglose y una fecha válidos.");
  }
  if (interest > 0 && !UUID.test(interestCategory)) {
    return invalid("Seleccioná la categoría para los intereses.");
  }
  if (fees > 0 && !UUID.test(feeCategory)) {
    return invalid("Seleccioná la categoría para las comisiones.");
  }
  if (note.length > 1000) return invalid("La nota es demasiado larga.");

  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return invalid("Iniciá sesión nuevamente.");

  const { error } = await supabase.rpc("post_loan_payment", {
    p_loan_id: loanId,
    p_account_id: accountId,
    p_principal: principal,
    p_interest: interest,
    p_fees: fees,
    p_interest_category: interest > 0 ? interestCategory : null,
    p_fee_category: fees > 0 ? feeCategory : null,
    p_effective_on: effectiveOn,
    p_note: note || null,
    p_idempotency_key: key,
  });
  if (error) return invalid(error.message);
  refreshLoans();
  return done("Pago registrado: disminuye el saldo de tu cuenta y el capital adeudado.");
}
