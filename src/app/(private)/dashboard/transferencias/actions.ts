"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type FinanceActionState = {
  error: string | null;
  success: string | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const validId = (id: string) => UUID.test(id);
const field = (form: FormData, name: string) => String(form.get(name) ?? "").trim();
const fail = (error: string): FinanceActionState => ({ error, success: null });
const done = (success: string): FinanceActionState => ({ error: null, success });

function parseAmount(raw: string, allowZero = false): number | null {
  if (!/^\d{1,12}(?:\.\d{1,2})?$/.test(raw)) return null;
  const value = Number(raw);
  const cents = Math.round(value * 100);
  if (!Number.isSafeInteger(cents) || (!allowZero && cents <= 0) || cents < 0) {
    return null;
  }
  return cents / 100;
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function refreshFinance(): void {
  for (const path of [
    "/dashboard",
    "/dashboard/transferencias",
    "/dashboard/cuentas",
    "/dashboard/tarjetas",
    "/dashboard/prestamos",
    "/dashboard/movimientos",
    "/dashboard/presupuestos",
  ]) revalidatePath(path);
}

/**
 * Todas las operaciones financieras pasan por RPCs con permisos controlados.
 * Nunca se escriben directamente operations, ledger_entries o transactions.
 */
export async function createFinanceOperation(
  _previous: FinanceActionState,
  form: FormData,
): Promise<FinanceActionState> {
  const mode = field(form, "mode");
  const accountId = field(form, "account_id");
  const effectiveOn = field(form, "effective_on");
  const note = field(form, "note");
  const key = field(form, "idempotency_key");

  if (!validId(key) || !validDate(effectiveOn)) {
    return fail("Fecha o identificador de operación inválidos.");
  }
  if (note.length > 600) return fail("La nota no debe superar 600 caracteres.");
  if (!validId(accountId)) return fail("Seleccioná una cuenta válida.");

  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return fail("Tu sesión expiró. Iniciá sesión nuevamente.");

  if (mode === "INTERNAL") {
    const toAccount = field(form, "to_account_id");
    const amount = parseAmount(field(form, "amount"));
    if (!validId(toAccount) || accountId === toAccount) {
      return fail("Elegí dos cuentas propias diferentes.");
    }
    if (amount === null) return fail("El monto de la transferencia no es válido.");

    const { error } = await supabase.rpc("post_transfer", {
      p_from_account: accountId,
      p_to_account: toAccount,
      p_amount: amount,
      p_effective_on: effectiveOn,
      p_note: note || null,
      p_idempotency_key: key,
    });
    if (error) return fail(error.message);
    refreshFinance();
    return done("Transferencia interna registrada. No genera ingreso ni gasto.");
  }

  if (mode === "EXTERNAL") {
    const direction = field(form, "direction");
    const counterparty = field(form, "counterparty").replace(/\s+/g, " ");
    const categoryId = field(form, "category_id");
    const amount = parseAmount(field(form, "amount"));

    if (direction !== "OUT" && direction !== "IN") {
      return fail("Seleccioná si enviás o recibís dinero.");
    }
    if (counterparty.length < 2 || counterparty.length > 120) {
      return fail("Escribí el nombre del destinatario o remitente (2–120 caracteres).");
    }
    if (!validId(categoryId) || amount === null) {
      return fail("Elegí una categoría y un monto válidos.");
    }

    // IMPORTANTE: sólo transferencias a/de terceros que SEAN gasto o ingreso.
    // Entre cuentas propias (aunque sean bancos distintos) se usa post_transfer.
    const description = `Transferencia externa ${direction === "OUT" ? "a" : "de"}: ${counterparty}` +
      (note ? ` · ${note}` : "");

    const { error } = await supabase.rpc("post_transaction", {
      p_kind: direction === "OUT" ? "EXPENSE" : "INCOME",
      p_category_id: categoryId,
      p_amount: amount,
      p_account_id: accountId,
      p_card_id: null,
      p_effective_on: effectiveOn,
      p_note: description,
      p_idempotency_key: key,
    });
    if (error) return fail(error.message);
    refreshFinance();
    return done(direction === "OUT"
      ? "Transferencia a tercero registrada como gasto."
      : "Transferencia recibida registrada como ingreso.");
  }

  if (mode === "CARD") {
    const cardId = field(form, "card_id");
    const amount = parseAmount(field(form, "amount"));
    if (!validId(cardId) || amount === null) {
      return fail("Elegí una tarjeta de crédito y un monto válidos.");
    }

    const { error } = await supabase.rpc("post_card_payment", {
      p_card_id: cardId,
      p_account_id: accountId,
      p_amount: amount,
      p_statement_id: null, // Abono general; la conciliación por estado de cuenta vendrá después.
      p_effective_on: effectiveOn,
      p_note: note || null,
      p_idempotency_key: key,
    });
    if (error) return fail(error.message);
    refreshFinance();
    return done("Pago aplicado: baja el saldo de la cuenta y la deuda de la tarjeta, sin duplicar gastos.");
  }

  if (mode === "LOAN") {
    const loanId = field(form, "loan_id");
    const principal = parseAmount(field(form, "principal") || "0", true);
    const interest = parseAmount(field(form, "interest") || "0", true);
    const fees = parseAmount(field(form, "fees") || "0", true);
    const interestCategory = field(form, "interest_category");
    const feeCategory = field(form, "fee_category");

    if (!validId(loanId) || principal === null || interest === null || fees === null) {
      return fail("Revisá los importes del abono.");
    }
    if (Math.round((principal + interest + fees) * 100) <= 0) {
      return fail("El abono total debe ser mayor que cero.");
    }
    if (interest > 0 && !validId(interestCategory)) {
      return fail("Seleccioná la categoría de intereses.");
    }
    if (fees > 0 && !validId(feeCategory)) {
      return fail("Seleccioná la categoría de comisiones.");
    }

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
    if (error) return fail(error.message);
    refreshFinance();
    return done("Pago de préstamo registrado. El capital reduce deuda; intereses y comisiones son gastos.");
  }

  return fail("Tipo de operación no reconocido.");
}
