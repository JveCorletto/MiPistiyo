import { Suspense } from "react";
import { connection } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  FinanceDashboard,
  type ActivityItem,
  type BalanceItem,
  type BudgetProgress,
  type DashboardStats,
  type ExpenseCategory,
  type MonthBar,
} from "@/components/dashboard/finance-dashboard";

type PageParams = { month?: string | string[] };

// get_dashboard() devuelve una fila con columnas numéricas de PostgreSQL.
// Los valores numeric pueden recibirse como number o string.
type DashboardRpcRow = {
  income: number | string | null;
  expense: number | string | null;
  balance: number | string | null;
  cash_available: number | string | null;
  credit_debt: number | string | null;
  loan_debt: number | string | null;
  net_worth: number | string | null;
};

type MonthlyExpenseRpcRow = {
  category_id: string;
  category_name: string;
  spent: number | string | null;
};
const ZONE = "America/El_Salvador";

function toNumber(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function todayInElSalvador(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: ZONE,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());
  const year = parts.find((p) => p.type === "year")?.value ?? "2026";
  const month = parts.find((p) => p.type === "month")?.value ?? "01";
  return `${year}-${month}`;
}

function shiftMonth(ym: string, offset: number): string {
  const [year, month] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(year, month - 1 + offset, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthName(ym: string, style: "long" | "short" = "long") {
  const [year, month] = ym.split("-").map(Number);
  return new Intl.DateTimeFormat("es-SV", {
    month: style,
    ...(style === "long" ? { year: "numeric" } : {}),
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, 1)));
}

function errorBox(message: string) {
  return (
    <div role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 p-5 text-sm text-red-300">
      No se pudo cargar el Dashboard: {message}
    </div>
  );
}

async function DashboardContent({ searchParams }: { searchParams: Promise<PageParams> }) {
  // Next.js Cache Components: resolver la petición dentro de Suspense.
  await connection();
  const params = await searchParams;
  const currentMonth = todayInElSalvador();
  const requested = typeof params.month === "string" ? params.month : "";
  const month = /^(20\d{2})-(0[1-9]|1[0-2])$/.test(requested) ? requested : currentMonth;
  const monthStart = `${month}-01`;
  const oldestMonth = shiftMonth(month, -5);
  const supabase = await createClient();

  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) return errorBox("Tu sesión ha expirado. Volvé a iniciar sesión.");
  const userId = authData.user.id;

  const [
    dashboardResult,
    flowResult,
    expensesResult,
    accountResult,
    cardResult,
    loanResult,
    categoryResult,
    budgetResult,
    operationResult,
    historicalResult,
  ] = await Promise.all([
    supabase.rpc("get_dashboard", { p_month: monthStart }).maybeSingle(),
    supabase.from("v_monthly_financial_flow")
      .select("month_start,income,expense")
      .eq("user_id", userId)
      .gte("month_start", `${oldestMonth}-01`)
      .lte("month_start", monthStart)
      .order("month_start"),
    supabase.rpc("get_monthly_expenses", { p_month: monthStart }),
    supabase.from("v_account_balances")
      .select("id,name,kind,is_active,current_balance")
      .eq("user_id", userId),
    supabase.from("v_card_balances")
      .select("id,name,kind,is_active,current_debt,credit_limit")
      .eq("user_id", userId),
    supabase.from("v_loan_balances")
      .select("id,name,is_active,current_debt")
      .eq("user_id", userId),
    supabase.from("categories")
      .select("id,name,color")
      .eq("user_id", userId),
    supabase.from("v_budget_progress")
      .select("id,category_id,budget,spent")
      .eq("user_id", userId)
      .eq("month_start", monthStart),
    supabase.from("operations")
      .select("id,kind,effective_on,memo,created_at")
      .eq("user_id", userId)
      .neq("kind", "REVERSAL")
      .order("effective_on", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(18),
    supabase.from("historical_transactions")
      .select("id,kind,category_id,source_account_id,source_card_id,amount,effective_on,description,created_at")
      .eq("user_id", userId)
      .is("voided_at", null)
      .order("effective_on", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(18),
  ]);

  const firstError = [
    dashboardResult, flowResult, expensesResult, accountResult, cardResult,
    loanResult, categoryResult, budgetResult, operationResult, historicalResult,
  ].find((result) => result.error)?.error;
  if (firstError) return errorBox(firstError.message);

  const d = dashboardResult.data as DashboardRpcRow | null;
  if (!d) return errorBox("La consulta financiera no devolvió resultados.");

  const stats: DashboardStats = {
    income: toNumber(d.income),
    expense: toNumber(d.expense),
    balance: toNumber(d.balance),
    cash_available: toNumber(d.cash_available),
    credit_debt: toNumber(d.credit_debt),
    loan_debt: toNumber(d.loan_debt),
    net_worth: toNumber(d.net_worth),
  };

  const categoriesById = new Map((categoryResult.data ?? []).map((item) => [item.id, item]));
  const categoryName = (id: string | null) =>
    id ? categoriesById.get(id)?.name ?? "Sin categoría" : "Sin categoría";

  const expenseRows = (expensesResult.data ?? []) as MonthlyExpenseRpcRow[];
  const expenseCategories: ExpenseCategory[] = expenseRows
    .map((row): ExpenseCategory => ({
      id: row.category_id,
      name: row.category_name,
      spent: toNumber(row.spent),
      color: categoriesById.get(row.category_id)?.color ?? null,
    }))
    .filter((row) => row.spent > 0)
    .sort((a, b) => b.spent - a.spent);

  const flowByMonth = new Map((flowResult.data ?? [])
    .map((row) => [String(row.month_start).slice(0, 7), row]));
  const months: MonthBar[] = Array.from({ length: 6 }, (_, index) => {
    const key = shiftMonth(month, index - 5);
    const flow = flowByMonth.get(key);
    return {
      key,
      label: monthName(key, "short"),
      income: toNumber(flow?.income),
      expense: toNumber(flow?.expense),
    };
  });

  const accounts: BalanceItem[] = (accountResult.data ?? [])
    .map((row) => ({
      id: row.id,
      name: `${row.name}${row.is_active ? "" : " (inactiva)"}`,
      kind: row.kind,
      balance: toNumber(row.current_balance),
    }))
    .sort((a, b) => b.balance - a.balance);

  const cards: BalanceItem[] = (cardResult.data ?? [])
    .filter((row) => row.kind === "CREDIT")
    .map((row) => ({
      id: row.id,
      name: `${row.name}${row.is_active ? "" : " (inactiva)"}`,
      balance: toNumber(row.current_debt),
      limit: toNumber(row.credit_limit),
    }))
    .sort((a, b) => b.balance - a.balance);

  const loans: BalanceItem[] = (loanResult.data ?? [])
    .map((row) => ({
      id: row.id,
      name: `${row.name}${row.is_active ? "" : " (inactivo)"}`,
      balance: toNumber(row.current_debt),
    }))
    .sort((a, b) => b.balance - a.balance);

  const budgets: BudgetProgress[] = (budgetResult.data ?? [])
    .map((row) => ({
      name: row.category_id ? categoryName(row.category_id) : "Presupuesto general",
      overall: row.category_id == null,
      budget: toNumber(row.budget),
      spent: toNumber(row.spent),
    }))
    .sort((a, b) => Number(b.overall) - Number(a.overall) || b.spent - a.spent);

  const accountName = new Map((accountResult.data ?? []).map((row) => [row.id, row.name]));
  const cardName = new Map((cardResult.data ?? []).map((row) => [row.id, row.name]));
  const loanName = new Map((loanResult.data ?? []).map((row) => [row.id, row.name]));
  const sourceName = (accountId: string | null, cardId: string | null) =>
    accountId ? accountName.get(accountId) ?? "Cuenta" : cardId ? cardName.get(cardId) ?? "Tarjeta" : "Sin origen";

  const recentOperations = operationResult.data ?? [];
  const operationIds = recentOperations.map((row) => row.id);

  type Tx = {
    operation_id: string;
    kind: string;
    amount: number;
    description: string | null;
    category_id: string;
    source_account_id: string | null;
    source_card_id: string | null;
    effect_sign: number;
  };
  type Transfer = { operation_id: string; from_account_id: string; to_account_id: string; amount: number };
  type CardPayment = { operation_id: string; card_id: string; account_id: string; amount: number };
  type LoanPayment = { operation_id: string; loan_id: string; account_id: string; principal: number; interest: number; fees: number };
  type Entry = { operation_id: string; account_id: string | null; card_id: string | null; loan_id: string | null; delta: number };

  const txByOperation = new Map<string, Tx[]>();
  const transferByOperation = new Map<string, Transfer>();
  const cardPaymentByOperation = new Map<string, CardPayment>();
  const loanPaymentByOperation = new Map<string, LoanPayment>();
  const entryByOperation = new Map<string, Entry[]>();
  const reversed = new Set<string>();

  if (operationIds.length > 0) {
    const [
      transactionRows,
      transferRows,
      cardPaymentRows,
      loanPaymentRows,
      entryRows,
      reversalRows,
    ] = await Promise.all([
      supabase.from("transactions")
        .select("operation_id,kind,amount,description,category_id,source_account_id,source_card_id,effect_sign")
        .eq("user_id", userId).in("operation_id", operationIds),
      supabase.from("transfers")
        .select("operation_id,from_account_id,to_account_id,amount")
        .eq("user_id", userId).in("operation_id", operationIds),
      supabase.from("card_payments")
        .select("operation_id,card_id,account_id,amount")
        .eq("user_id", userId).in("operation_id", operationIds),
      supabase.from("loan_payments")
        .select("operation_id,loan_id,account_id,principal,interest,fees")
        .eq("user_id", userId).in("operation_id", operationIds),
      supabase.from("ledger_entries")
        .select("operation_id,account_id,card_id,loan_id,delta")
        .eq("user_id", userId).in("operation_id", operationIds),
      supabase.from("operations")
        .select("reversal_of")
        .eq("user_id", userId).in("reversal_of", operationIds),
    ]);

    const detailsError = [
      transactionRows, transferRows, cardPaymentRows, loanPaymentRows,
      entryRows, reversalRows,
    ].find((result) => result.error)?.error;
    if (detailsError) return errorBox(detailsError.message);

    for (const tx of transactionRows.data ?? []) {
      const items = txByOperation.get(tx.operation_id) ?? [];
      items.push(tx);
      txByOperation.set(tx.operation_id, items);
    }
    for (const transfer of transferRows.data ?? []) transferByOperation.set(transfer.operation_id, transfer);
    for (const payment of cardPaymentRows.data ?? []) cardPaymentByOperation.set(payment.operation_id, payment);
    for (const payment of loanPaymentRows.data ?? []) loanPaymentByOperation.set(payment.operation_id, payment);
    for (const entry of entryRows.data ?? []) {
      const items = entryByOperation.get(entry.operation_id) ?? [];
      items.push(entry);
      entryByOperation.set(entry.operation_id, items);
    }
    for (const row of reversalRows.data ?? []) {
      if (row.reversal_of) reversed.add(row.reversal_of);
    }
  }

  const activity: ActivityItem[] = recentOperations.map((op) => {
    const txs = txByOperation.get(op.id) ?? [];
    const transfer = transferByOperation.get(op.id);
    const cardPayment = cardPaymentByOperation.get(op.id);
    const loanPayment = loanPaymentByOperation.get(op.id);
    const entries = entryByOperation.get(op.id) ?? [];
    const firstTx = txs[0];

    let title = op.memo?.trim() || "Operación financiera";
    let detail = "Movimiento contabilizado";
    let amount = 0;
    let direction: ActivityItem["direction"] = "neutral";

    if (op.kind === "INCOME" || op.kind === "EXPENSE") {
      direction = op.kind === "INCOME" ? "income" : "expense";
      amount = txs.reduce((sum, tx) => sum + toNumber(tx.amount) * toNumber(tx.effect_sign), 0);
      title = firstTx?.description || op.memo || categoryName(firstTx?.category_id ?? null);
      detail = firstTx ? `${categoryName(firstTx.category_id)} · ${sourceName(firstTx.source_account_id, firstTx.source_card_id)}` : "Ingreso o gasto";
    } else if (op.kind === "TRANSFER" && transfer) {
      title = "Transferencia entre cuentas";
      amount = toNumber(transfer.amount);
      detail = `${accountName.get(transfer.from_account_id) ?? "Cuenta"} → ${accountName.get(transfer.to_account_id) ?? "Cuenta"}`;
    } else if (op.kind === "CARD_PAYMENT" && cardPayment) {
      title = "Pago a tarjeta";
      amount = toNumber(cardPayment.amount);
      detail = `${accountName.get(cardPayment.account_id) ?? "Cuenta"} → ${cardName.get(cardPayment.card_id) ?? "Tarjeta"}`;
    } else if (op.kind === "LOAN_PAYMENT" && loanPayment) {
      title = "Pago a préstamo";
      amount = toNumber(loanPayment.principal) + toNumber(loanPayment.interest) + toNumber(loanPayment.fees);
      detail = `${loanName.get(loanPayment.loan_id) ?? "Préstamo"} · Capital ${toNumber(loanPayment.principal).toFixed(2)}`;
    } else if (op.kind === "LOAN_DISBURSEMENT") {
      title = "Desembolso de préstamo";
      const accountEntry = entries.find((entry) => entry.account_id && toNumber(entry.delta) > 0);
      amount = toNumber(accountEntry?.delta);
      detail = accountEntry?.account_id ? accountName.get(accountEntry.account_id) ?? "Cuenta receptora" : "Cuenta receptora";
    } else if (op.kind === "ADJUSTMENT") {
      title = "Ajuste de conciliación";
      amount = Math.abs(toNumber(entries[0]?.delta));
      detail = op.memo ?? "Ajuste contable";
    }

    return {
      id: `operation-${op.id}`,
      date: op.effective_on,
      createdAt: op.created_at,
      title,
      detail,
      amount: Math.max(0, amount),
      direction,
      kind: op.kind,
      historical: false,
      reversed: reversed.has(op.id),
    };
  });

  for (const h of historicalResult.data ?? []) {
    activity.push({
      id: `historical-${h.id}`,
      date: h.effective_on,
      createdAt: h.created_at,
      title: h.description || categoryName(h.category_id),
      detail: `${categoryName(h.category_id)} · ${sourceName(h.source_account_id, h.source_card_id)}`,
      amount: toNumber(h.amount),
      direction: h.kind === "INCOME" ? "income" : "expense",
      kind: h.kind,
      historical: true,
      reversed: false,
    });
  }
  activity.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));

  return (
    <FinanceDashboard data={{
      month,
      monthLabel: monthName(month),
      prevMonth: shiftMonth(month, -1),
      nextMonth: shiftMonth(month, 1),
      currentMonth,
      stats,
      months,
      categories: expenseCategories,
      accounts,
      cards,
      loans,
      budgets,
      activity: activity.slice(0, 12),
    }} />
  );
}

export default function DashboardPage({ searchParams }: { searchParams: Promise<PageParams> }) {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-slate-400">Preparando tu resumen financiero...</div>}>
      <DashboardContent searchParams={searchParams} />
    </Suspense>
  );
}
