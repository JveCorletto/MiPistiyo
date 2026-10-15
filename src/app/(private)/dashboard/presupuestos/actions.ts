"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type BudgetActionState = {
  error: string | null;
  success: string | null;
};

const VALID_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const VALID_MONTH = /^20\d{2}-(0[1-9]|1[0-2])-01$/;

const fail = (error: string): BudgetActionState => ({ error, success: null });
const done = (success: string): BudgetActionState => ({ error: null, success });
const read = (data: FormData, field: string) => String(data.get(field) ?? "").trim();

function parseAmount(value: string): number | null {
  if (!/^\d{1,12}(?:\.\d{1,2})?$/.test(value)) return null;
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0 || !Number.isSafeInteger(Math.round(amount * 100))) return null;
  return amount;
}

function priorMonth(monthStart: string): string {
  const [year, month] = monthStart.slice(0, 7).split("-").map(Number);
  const previous = new Date(Date.UTC(year, month - 2, 1));
  return `${previous.getUTCFullYear()}-${String(previous.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

function refresh() {
  revalidatePath("/dashboard/presupuestos");
  revalidatePath("/dashboard");
}

async function authenticatedClient() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  return { supabase, user: error ? null : user };
}

// Crea un presupuesto general o por categoría y solo modifica el monto al editar.
export async function saveBudget(
  _previous: BudgetActionState,
  form: FormData,
): Promise<BudgetActionState> {
  const month = read(form, "month_start");
  const budgetId = read(form, "budget_id");
  const scope = read(form, "scope");
  const categoryId = read(form, "category_id");
  const amount = parseAmount(read(form, "amount"));

  if (!VALID_MONTH.test(month)) return fail("Mes inválido.");
  if (amount === null) return fail("Ingresá un importe mayor que cero, con máximo dos decimales.");
  if (budgetId && !VALID_UUID.test(budgetId)) return fail("Presupuesto inválido.");
  if (!["OVERALL", "CATEGORY"].includes(scope)) return fail("Seleccioná el tipo de presupuesto.");
  if (scope === "CATEGORY" && !VALID_UUID.test(categoryId)) return fail("Seleccioná una categoría válida.");

  const { supabase, user } = await authenticatedClient();
  if (!user) return fail("Tu sesión expiró. Iniciá sesión otra vez.");

  if (budgetId) {
    const { data: existing, error: existingError } = await supabase
      .from("budgets")
      .select("id")
      .eq("id", budgetId)
      .eq("user_id", user.id)
      .eq("month_start", month)
      .maybeSingle();
    if (existingError) return fail(existingError.message);
    if (!existing) return fail("Presupuesto no encontrado para este mes.");

    // Nunca cambiamos categoría o mes al editar: evitamos reasignaciones accidentales.
    const { data, error } = await supabase
      .from("budgets")
      .update({ amount })
      .eq("id", budgetId)
      .eq("user_id", user.id)
      .eq("month_start", month)
      .select("id")
      .maybeSingle();
    if (error) return fail(error.message);
    if (!data) return fail("No se pudo actualizar. Actualizá la página e intentá de nuevo.");
    refresh();
    return done("Presupuesto actualizado.");
  }

  const newCategoryId = scope === "CATEGORY" ? categoryId : null;
  if (newCategoryId) {
    const { data: category, error: categoryError } = await supabase
      .from("categories")
      .select("id")
      .eq("id", newCategoryId)
      .eq("user_id", user.id)
      .eq("kind", "EXPENSE")
      .eq("is_active", true)
      .maybeSingle();
    if (categoryError) return fail(categoryError.message);
    if (!category) return fail("La categoría no está disponible para presupuestos.");
  }

  const { error } = await supabase.from("budgets").insert({
    user_id: user.id,
    month_start: month,
    category_id: newCategoryId,
    amount,
    // category_kind queda en su DEFAULT 'EXPENSE' configurado en PostgreSQL.
  });
  if (error?.code === "23505") return fail("Ya existe un presupuesto para esa categoría y mes.");
  if (error) return fail(error.message);
  refresh();
  return done("Presupuesto creado correctamente.");
}

export async function deleteBudget(
  _previous: BudgetActionState,
  form: FormData,
): Promise<BudgetActionState> {
  const id = read(form, "budget_id");
  const month = read(form, "month_start");
  if (!VALID_UUID.test(id) || !VALID_MONTH.test(month)) return fail("Presupuesto o mes inválido.");

  const { supabase, user } = await authenticatedClient();
  if (!user) return fail("Tu sesión expiró.");

  const { data, error } = await supabase.from("budgets")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id)
    .eq("month_start", month)
    .select("id")
    .maybeSingle();
  if (error) return fail(error.message);
  if (!data) return fail("El presupuesto ya no existe o no te pertenece.");
  refresh();
  return done("Presupuesto eliminado. Los gastos registrados se conservaron.");
}

// Copia únicamente las categorías que todavía no tienen presupuesto en el mes destino.
// Es una sola sentencia INSERT: si PostgreSQL rechaza alguna fila, no se inserta ninguna.
export async function copyPreviousBudgets(
  _previous: BudgetActionState,
  form: FormData,
): Promise<BudgetActionState> {
  const month = read(form, "month_start");
  if (!VALID_MONTH.test(month)) return fail("Mes inválido.");
  if (month === "2000-01-01") return fail("No hay un mes anterior disponible.");

  const { supabase, user } = await authenticatedClient();
  if (!user) return fail("Tu sesión expiró.");

  const previous = priorMonth(month);
  const [last, current, active] = await Promise.all([
    supabase.from("budgets")
      .select("category_id,amount")
      .eq("user_id", user.id)
      .eq("month_start", previous),
    supabase.from("budgets")
      .select("category_id")
      .eq("user_id", user.id)
      .eq("month_start", month),
    supabase.from("categories")
      .select("id")
      .eq("user_id", user.id)
      .eq("kind", "EXPENSE")
      .eq("is_active", true),
  ]);
  const queryError = last.error ?? current.error ?? active.error;
  if (queryError) return fail(queryError.message);

  const currentRows = (current.data ?? []) as Array<{ category_id: string | null }>;
  const activeRows = (active.data ?? []) as Array<{ id: string }>;
  const previousRows = (last.data ?? []) as Array<{
    category_id: string | null;
    amount: number | string;
  }>;
  const existing = new Set(currentRows.map((item) => item.category_id ?? "__OVERALL__"));
  const activeIds = new Set(activeRows.map((item) => item.id));
  const missing = previousRows.filter((budget) => {
    const key = budget.category_id ?? "__OVERALL__";
    return !existing.has(key) && (budget.category_id === null || activeIds.has(budget.category_id));
  });

  if (missing.length === 0) return fail("No hay presupuestos nuevos para copiar desde el mes anterior.");

  const { error } = await supabase.from("budgets").insert(missing.map((budget) => ({
    user_id: user.id,
    month_start: month,
    category_id: budget.category_id,
    amount: budget.amount,
  })));
  if (error?.code === "23505") return fail("Los presupuestos cambiaron mientras copiabas. Actualizá la página e intentá otra vez.");
  if (error) return fail(error.message);
  refresh();
  return done(`Se copiaron ${missing.length} presupuesto${missing.length === 1 ? "" : "s"} del mes anterior.`);
}
