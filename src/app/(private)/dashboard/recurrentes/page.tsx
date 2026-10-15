import { Suspense } from "react";
import { connection } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  RecurringManager,
  type RecurringRule,
  type RecurringOccurrence,
  type CategoryOption,
  type SourceOption,
  type DebtReminder,
} from "@/components/recurring/recurring-manager";

const ZONE = "America/El_Salvador";

type DbRule = {
  id: string; name: string; kind: "INCOME" | "EXPENSE"; category_id: string;
  amount: number | string; account_id: string | null; card_id: string | null;
  frequency: "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
  anchor_day: number | null; next_on: string;
  status: "ACTIVE" | "PAUSED" | "ENDED"; notes: string | null;
};
type DbOccurrence = {
  id: string; recurring_id: string; scheduled_on: string;
  status: "PENDING" | "CONFIRMED" | "SKIPPED";
};
type DbCategory = { id: string; kind: "INCOME" | "EXPENSE"; name: string; is_active: boolean };
type DbAccount = { id: string; name: string; is_active: boolean };
type DbCard = { id: string; name: string; kind: "DEBIT" | "CREDIT"; is_active: boolean; due_day: number | null };
type DbLoan = { id: string; name: string; is_active: boolean; due_day: number | null; expected_installment: number | string | null };

function todayInElSalvador() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: ZONE, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function addDays(ymd: string, days: number) {
  const date = new Date(`${ymd}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Fecha orientativa por día habitual; no sustituye el estado de cuenta bancario. */
function nextMonthlyDue(today: string, day: number): string {
  const [year, month] = today.split("-").map(Number);
  for (let shift = 0; shift < 2; shift += 1) {
    const first = new Date(Date.UTC(year, month - 1 + shift, 1));
    const y = first.getUTCFullYear();
    const m = first.getUTCMonth();
    const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    const date = `${y}-${String(m + 1).padStart(2, "0")}-${String(Math.min(day, last)).padStart(2, "0")}`;
    if (date >= today) return date;
  }
  return today;
}

async function RecurringContent() {
  await connection();
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return <p role="alert" className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-5 text-rose-300">
      Tu sesión ha expirado. Volvé a iniciar sesión.
    </p>;
  }

  const today = todayInElSalvador();
  const horizon = addDays(today, 45);

  // La RPC genera únicamente PENDIENTES; no descuenta fondos ni carga tarjetas.
  // Es idempotente: existe UNIQUE(user_id, recurring_id, scheduled_on).
  const generated = await supabase.rpc("generate_pending_occurrences", {
    p_through: horizon,
  });

  const [rulesQuery, pendingQuery, recentQuery, categoriesQuery, accountsQuery, cardsQuery, loansQuery] = await Promise.all([
    supabase.from("recurring_transactions")
      .select("id,name,kind,category_id,amount,account_id,card_id,frequency,anchor_day,next_on,status,notes")
      .eq("user_id", user.id).order("created_at", { ascending: false }).limit(200),
    supabase.from("recurring_occurrences")
      .select("id,recurring_id,scheduled_on,status")
      .eq("user_id", user.id).eq("status", "PENDING")
      .lte("scheduled_on", horizon).order("scheduled_on", { ascending: true }).limit(200),
    supabase.from("recurring_occurrences")
      .select("id,recurring_id,scheduled_on,status")
      .eq("user_id", user.id).in("status", ["CONFIRMED", "SKIPPED"])
      .order("scheduled_on", { ascending: false }).limit(20),
    supabase.from("categories").select("id,name,kind,is_active")
      .eq("user_id", user.id).order("name"),
    supabase.from("accounts").select("id,name,is_active")
      .eq("user_id", user.id).order("name"),
    supabase.from("cards").select("id,name,kind,is_active,due_day")
      .eq("user_id", user.id).order("name"),
    supabase.from("loans").select("id,name,is_active,due_day,expected_installment")
      .eq("user_id", user.id).order("name"),
  ]);

  const queryError = rulesQuery.error ?? pendingQuery.error ?? recentQuery.error ??
    categoriesQuery.error ?? accountsQuery.error ?? cardsQuery.error ?? loansQuery.error;
  if (queryError) {
    return <p role="alert" className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-5 text-rose-300">
      No se pudo cargar el módulo de recurrencias: {queryError.message}
    </p>;
  }

  const ruleRows = (rulesQuery.data ?? []) as DbRule[];
  const categoryRows = (categoriesQuery.data ?? []) as DbCategory[];
  const accountRows = (accountsQuery.data ?? []) as DbAccount[];
  const cardRows = (cardsQuery.data ?? []) as DbCard[];
  const loanRows = (loansQuery.data ?? []) as DbLoan[];
  const categoryMap = new Map(categoryRows.map((row) => [row.id, row.name]));
  const sourceMap = new Map([
    ...accountRows.map((row) => [row.id, row.name] as const),
    ...cardRows.map((row) => [row.id, row.name] as const),
  ]);

  const rules: RecurringRule[] = ruleRows.map((row) => ({
    ...row,
    amount: Number(row.amount),
    category_name: categoryMap.get(row.category_id) ?? "Categoría archivada",
    source_name: sourceMap.get(row.account_id ?? row.card_id ?? "") ?? "Origen desconocido",
  }));
  const byRule = new Map(rules.map((rule) => [rule.id, rule]));
  function withRule(rows: DbOccurrence[]): RecurringOccurrence[] {
    return rows.flatMap((row) => {
      const rule = byRule.get(row.recurring_id);
      return rule ? [{ ...row, rule }] : [];
    });
  }

  const categories: CategoryOption[] = categoryRows.map(({ id, name, kind, is_active }) => ({ id, name, kind, is_active }));
  const sources: SourceOption[] = [
    ...accountRows.map((item) => ({ id: item.id, name: item.name, type: "ACCOUNT" as const, active: item.is_active })),
    ...cardRows.map((item) => ({ id: item.id, name: item.name, type: "CARD" as const, active: item.is_active })),
  ];

  const reminders: DebtReminder[] = [
    ...cardRows
      .filter((card) => card.is_active && card.kind === "CREDIT" && card.due_day !== null)
      .map((card) => ({
        id: card.id, kind: "CARD" as const, name: card.name,
        due_on: nextMonthlyDue(today, Number(card.due_day)),
        amount: null, href: "/dashboard/transferencias",
      })),
    ...loanRows
      .filter((loan) => loan.is_active && loan.due_day !== null)
      .map((loan) => ({
        id: loan.id, kind: "LOAN" as const, name: loan.name,
        due_on: nextMonthlyDue(today, Number(loan.due_day)),
        amount: loan.expected_installment == null ? null : Number(loan.expected_installment),
        href: "/dashboard/prestamos",
      })),
  ].sort((a, b) => a.due_on.localeCompare(b.due_on));

  return <RecurringManager
    today={today}
    horizon={horizon}
    generationError={generated.error?.message ?? null}
    rules={rules}
    pending={withRule((pendingQuery.data ?? []) as DbOccurrence[])}
    recent={withRule((recentQuery.data ?? []) as DbOccurrence[])}
    categories={categories}
    sources={sources}
    reminders={reminders}
  />;
}

export default function RecurringPage() {
  return <Suspense fallback={<div className="p-6 text-slate-400">Cargando pagos recurrentes...</div>}>
    <RecurringContent />
  </Suspense>;
}
