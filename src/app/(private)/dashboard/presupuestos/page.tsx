import { Suspense } from "react";
import { connection } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  BudgetManager,
  type BudgetItem,
  type ExpenseCategory,
  type UnbudgetedExpense,
} from "@/components/budgets/budget-manager";

type PageParams = { month?: string | string[] };
type CategoryDbRow = { id: string; name: string; color: string | null; kind: string; is_active: boolean };
type BudgetDbRow = { id: string; month_start: string; category_id: string | null; amount: string | number };
type ProgressDbRow = { id: string; category_id: string | null; budget: string | number; spent: string | number };
type ExpenseDbRow = { category_id: string; category_name: string; spent: string | number };
const ZONE = "America/El_Salvador";

function currentMonth(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: ZONE,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  if (!year || !month) throw new Error("No se pudo determinar el mes actual.");
  return `${year}-${month}`;
}

function shiftMonth(yearMonth: string, amount: number): string {
  const [year, month] = yearMonth.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1 + amount, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(yearMonth: string) {
  const [year, month] = yearMonth.split("-").map(Number);
  const name = new Intl.DateTimeFormat("es-SV", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, 1)));
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function numeric(value: unknown): number {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

async function BudgetsContent({ searchParams }: { searchParams: Promise<PageParams> }) {
  // Compatible con Cache Components de Next.js 16 y Suspense.
  await connection();
  const params = await searchParams;
  const requested = typeof params.month === "string" ? params.month : "";
  const yearMonth = /^20\d{2}-(0[1-9]|1[0-2])$/.test(requested)
    ? requested
    : currentMonth();
  const monthStart = `${yearMonth}-01`;
  const previous = shiftMonth(yearMonth, -1);
  const previousStart = `${previous}-01`;

  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return <p role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 p-5 text-red-300">
      Tu sesión ha expirado. Volvé a iniciar sesión.
    </p>;
  }

  const [categoriesResult, budgetsResult, progressResult, expensesResult] = await Promise.all([
    supabase.from("categories")
      .select("id,name,color,kind,is_active")
      .eq("user_id", user.id)
      .eq("kind", "EXPENSE")
      .order("name"),
    supabase.from("budgets")
      .select("id,month_start,category_id,amount")
      .eq("user_id", user.id)
      .in("month_start", [monthStart, previousStart]),
    supabase.from("v_budget_progress")
      .select("id,category_id,budget,spent")
      .eq("user_id", user.id)
      .eq("month_start", monthStart),
    supabase.from("v_monthly_category_expenses")
      .select("category_id,category_name,spent")
      .eq("user_id", user.id)
      .eq("month_start", monthStart),
  ]);

  const error = categoriesResult.error ?? budgetsResult.error ?? progressResult.error ?? expensesResult.error;
  if (error) {
    return <p role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 p-5 text-red-300">
      No se pudieron cargar los presupuestos: {error.message}
    </p>;
  }

  const categoryRows = (categoriesResult.data ?? []) as CategoryDbRow[];
  const budgetRows = (budgetsResult.data ?? []) as BudgetDbRow[];
  const progressRows = (progressResult.data ?? []) as ProgressDbRow[];
  const expenseRows = (expensesResult.data ?? []) as ExpenseDbRow[];

  const categories: ExpenseCategory[] = categoryRows.map((category) => ({
    id: category.id,
    name: category.name,
    color: category.color,
    is_active: category.is_active,
  }));
  const categoryById = new Map(categories.map((category) => [category.id, category]));

  const budgetsThisMonth = budgetRows.filter((budget) => budget.month_start === monthStart);
  const budgetIds = new Set(budgetsThisMonth.map((budget) => budget.id));

  // La vista aplica gastos contabilizados + históricos sin duplicar saldos.
  // Requiere que cada presupuesto tenga su fila calculada para no mostrar ceros incorrectos.
  if (progressRows.some((row) => !budgetIds.has(row.id)) ||
      progressRows.length !== budgetsThisMonth.length) {
    return <p role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 p-5 text-red-300">
      El avance de presupuestos no coincide con los registros del mes. Actualizá la página o revisá la vista v_budget_progress.
    </p>;
  }

  const budgets: BudgetItem[] = progressRows.map((row) => {
    const category = row.category_id ? categoryById.get(row.category_id) : null;
    return {
      id: row.id,
      category_id: row.category_id,
      name: row.category_id ? category?.name ?? "Categoría archivada" : "Presupuesto general",
      color: category?.color ?? null,
      amount: numeric(row.budget),
      spent: numeric(row.spent),
      is_active: category?.is_active ?? true,
    };
  });

  const spentByCategory = expenseRows.map((row) => ({
    category_id: row.category_id,
    name: row.category_name,
    spent: numeric(row.spent),
    color: categoryById.get(row.category_id)?.color ?? null,
  }));
  const totalSpent = spentByCategory.reduce((sum, row) => sum + row.spent, 0);
  const budgetedCategoryIds = new Set(budgets
    .filter((row) => row.category_id !== null)
    .map((row) => row.category_id));
  const unbudgeted: UnbudgetedExpense[] = spentByCategory
    .filter((row) => row.spent > 0 && !budgetedCategoryIds.has(row.category_id))
    .sort((a, b) => b.spent - a.spent);

  const currentKeys = new Set(budgetsThisMonth
    .map((row) => row.category_id ?? "__OVERALL__"));
  const activeIds = new Set(categories.filter((category) => category.is_active)
    .map((category) => category.id));
  const copyableCount = budgetRows
    .filter((row) => row.month_start === previousStart)
    .filter((row) => !currentKeys.has(row.category_id ?? "__OVERALL__"))
    .filter((row) => row.category_id === null || activeIds.has(row.category_id)).length;

  return <BudgetManager
    monthStart={monthStart}
    monthLabel={monthLabel(yearMonth)}
    previousMonth={previous}
    nextMonth={shiftMonth(yearMonth, 1)}
    categories={categories}
    budgets={budgets}
    totalSpent={totalSpent}
    unbudgeted={unbudgeted}
    copyableCount={copyableCount}
  />;
}

export default function BudgetsPage({ searchParams }: { searchParams: Promise<PageParams> }) {
  return <Suspense fallback={<div className="p-6 text-slate-400">Cargando presupuestos...</div>}>
    <BudgetsContent searchParams={searchParams} />
  </Suspense>;
}
