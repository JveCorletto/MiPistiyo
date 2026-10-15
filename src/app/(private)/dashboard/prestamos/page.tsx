import { Suspense } from "react";
import { connection } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { LoanManager } from "@/components/loans/loan-manager";

async function LoansContent() {
  await connection();
  const supabase = await createClient();

  const [
    loansResult,
    balancesResult,
    accountsResult,
    accountBalancesResult,
    categoriesResult,
    paymentsResult,
  ] = await Promise.all([
    supabase.from("loans").select(`
      id,name,lender,original_amount,opening_debt,balance_mode,
      started_on,annual_interest_rate,expected_installment,due_day,
      is_active,notes,created_at
    `).order("created_at", { ascending: false }),
    supabase.from("v_loan_balances")
      .select("id,current_debt"),
    supabase.from("accounts")
      .select("id,name,is_active"),
    supabase.from("v_account_balances")
      .select("id,current_balance"),
    supabase.from("categories")
      .select("id,name,kind,is_active").eq("kind", "EXPENSE").order("name"),
    supabase.from("loan_payments")
      .select("id,loan_id,account_id,operation_id,principal,interest,fees,created_at")
      .order("created_at", { ascending: false }).limit(100),
  ]);

  const queryError = loansResult.error ?? balancesResult.error ??
    accountsResult.error ?? accountBalancesResult.error ??
    categoriesResult.error ?? paymentsResult.error;

  if (queryError) {
    return <p role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-red-400">
      No se pudieron cargar los préstamos: {queryError.message}
    </p>;
  }

  const balances = new Map(
    (balancesResult.data ?? []).map((row) => [row.id, Number(row.current_debt)]),
  );
  const accountBalances = new Map(
    (accountBalancesResult.data ?? []).map((row) => [row.id, Number(row.current_balance)]),
  );
  const loans = (loansResult.data ?? []).map((loan) => ({
    ...loan,
    current_debt: balances.get(loan.id) ?? Number(loan.opening_debt),
  }));
  const accounts = (accountsResult.data ?? [])
    .filter((account) => account.is_active)
    .map((account) => ({
      id: account.id,
      name: account.name,
      current_balance: accountBalances.get(account.id) ?? 0,
    }));

  const payments = paymentsResult.data ?? [];
  const operationIds = [...new Set(payments.map((payment) => payment.operation_id))];
  const { data: operations, error: operationsError } = operationIds.length
    ? await supabase.from("operations")
        .select("id,effective_on,reversal_of")
        .or(`id.in.(${operationIds.join(",")}),reversal_of.in.(${operationIds.join(",")})`)
    : { data: [], error: null };

  if (operationsError) {
    return <p role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-red-400">
      No se pudieron cargar las fechas de los pagos: {operationsError.message}
    </p>;
  }

  const operationDates = new Map((operations ?? []).map((op) => [op.id, op.effective_on]));
  const reversed = new Set((operations ?? []).filter((op) => op.reversal_of)
    .map((op) => op.reversal_of));

  return <LoanManager
    loans={loans}
    accounts={accounts}
    categories={(categoriesResult.data ?? [])
      .filter((category) => category.is_active)
      .map((category) => ({ id: category.id, name: category.name }))}
    payments={payments.map((payment) => ({
      id: payment.id,
      loan_id: payment.loan_id,
      account_name: (accountsResult.data ?? []).find((a) => a.id === payment.account_id)?.name ?? "Cuenta",
      principal: Number(payment.principal),
      interest: Number(payment.interest),
      fees: Number(payment.fees),
      effective_on: operationDates.get(payment.operation_id) ?? payment.created_at.slice(0, 10),
      is_reversed: reversed.has(payment.operation_id),
    }))}
  />;
}

export default function LoansPage() {
  return <Suspense fallback={<div className="p-6 text-slate-400">Cargando préstamos...</div>}>
    <LoansContent />
  </Suspense>;
}
