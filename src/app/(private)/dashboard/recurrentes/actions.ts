"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type RecurringActionState = { error: string | null; success: string | null };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FREQUENCIES = ["DAILY", "WEEKLY", "MONTHLY", "YEARLY"] as const;
const fail = (error: string): RecurringActionState => ({ error, success: null });
const done = (success: string): RecurringActionState => ({ error: null, success });
const field = (form: FormData, key: string) => String(form.get(key) ?? "").trim();

function parseAmount(raw: string): number | null {
  if (!/^\d{1,12}(?:\.\d{1,2})?$/.test(raw)) return null;
  const cents = Math.round(Number(raw) * 100);
  return Number.isSafeInteger(cents) && cents > 0 ? cents / 100 : null;
}

function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function todayInElSalvador() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/El_Salvador", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function refresh() {
  for (const path of [
    "/dashboard/recurrentes", "/dashboard", "/dashboard/movimientos",
    "/dashboard/cuentas", "/dashboard/tarjetas", "/dashboard/presupuestos",
  ]) revalidatePath(path);
}

async function context() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  return { supabase, user: error ? null : user };
}

/** Alta de regla y edición transaccional de su programación (SQL 009). */
export async function saveRecurring(
  _previous: RecurringActionState,
  form: FormData,
): Promise<RecurringActionState> {
  const id = field(form, "rule_id");
  const name = field(form, "name").replace(/\s+/g, " ");
  const notes = field(form, "notes");
  const amount = parseAmount(field(form, "amount"));

  if (name.length < 1 || name.length > 120) return fail("El nombre debe tener entre 1 y 120 caracteres.");
  if (notes.length > 1000) return fail("Las notas no deben exceder 1000 caracteres.");
  if (amount === null) return fail("Ingresá un importe válido, mayor a cero y con hasta dos decimales.");
  if (id && !UUID.test(id)) return fail("Regla recurrente inválida.");

  const { supabase, user } = await context();
  if (!user) return fail("Tu sesión expiró. Volvé a iniciar sesión.");

  if (id) {
    const changeSchedule = field(form, "reschedule") === "true";
    const frequency = field(form, "frequency");
    const nextOn = field(form, "next_on");

    if (changeSchedule) {
      if (!FREQUENCIES.some((value) => value === frequency) || !validDate(nextOn)) {
        return fail("Seleccioná una frecuencia y una fecha válidas.");
      }
      const dateToday = todayInElSalvador();
      const allowedMin = new Date(`${dateToday}T00:00:00.000Z`);
      allowedMin.setUTCDate(allowedMin.getUTCDate() - (frequency === "DAILY" ? 30 : 90));
      const allowedMax = new Date(`${dateToday}T00:00:00.000Z`);
      allowedMax.setUTCDate(allowedMax.getUTCDate() + 1825);
      if (nextOn < allowedMin.toISOString().slice(0, 10) ||
          nextOn > allowedMax.toISOString().slice(0, 10)) {
        return fail("Elegí una fecha entre hace 90 días y los próximos cinco años.");
      }
    }

    const { data, error } = await supabase.rpc("update_recurring_rule", {
      p_rule: id,
      p_name: name,
      p_amount: amount,
      p_notes: notes || null,
      p_change_schedule: changeSchedule,
      p_frequency: changeSchedule ? frequency : null,
      p_next_on: changeSchedule ? nextOn : null,
    });
    if (error) return fail(error.message);
    refresh();
    revalidatePath("/dashboard/notificaciones");
    return done(data === true
      ? "Recurrencia reprogramada. Los vencimientos pendientes se recalcularán; los pagos ya procesados se conservan."
      : "Recurrencia actualizada correctamente.");
  }

  const kind = field(form, "kind");
  const categoryId = field(form, "category_id");
  const sourceType = field(form, "source_type");
  const sourceId = field(form, "source_id");
  const frequency = field(form, "frequency");
  const nextOn = field(form, "next_on");

  if (kind !== "INCOME" && kind !== "EXPENSE") return fail("Seleccioná gasto o ingreso.");
  if (!UUID.test(categoryId) || !UUID.test(sourceId)) return fail("Elegí categoría y cuenta o tarjeta.");
  if (sourceType !== "ACCOUNT" && sourceType !== "CARD") return fail("Seleccioná el origen.");
  if (kind === "INCOME" && sourceType === "CARD") return fail("Un ingreso recurrente debe ingresar a una cuenta.");
  if (!FREQUENCIES.some((value) => value === frequency)) return fail("Frecuencia inválida.");
  if (!validDate(nextOn) || nextOn < todayInElSalvador()) {
    return fail("La primera fecha programada debe ser hoy o una fecha futura.");
  }

  const [categoryResult, sourceResult] = await Promise.all([
    supabase.from("categories").select("id")
      .eq("id", categoryId).eq("user_id", user.id).eq("kind", kind)
      .eq("is_active", true).maybeSingle(),
    sourceType === "ACCOUNT"
      ? supabase.from("accounts").select("id").eq("id", sourceId)
        .eq("user_id", user.id).eq("is_active", true).maybeSingle()
      : supabase.from("cards").select("id").eq("id", sourceId)
        .eq("user_id", user.id).eq("is_active", true).maybeSingle(),
  ]);
  const dependencyError = categoryResult.error ?? sourceResult.error;
  if (dependencyError) return fail(dependencyError.message);
  if (!categoryResult.data || !sourceResult.data) {
    return fail("La categoría o el origen seleccionado no están disponibles.");
  }

  const anchorDay = frequency === "MONTHLY" || frequency === "YEARLY"
    ? Number(nextOn.slice(8, 10)) : null;
  const { error } = await supabase.from("recurring_transactions").insert({
    user_id: user.id,
    name, kind, category_id: categoryId, amount,
    account_id: sourceType === "ACCOUNT" ? sourceId : null,
    card_id: sourceType === "CARD" ? sourceId : null,
    frequency, anchor_day: anchorDay, next_on: nextOn,
    status: "ACTIVE", notes: notes || null,
  });
  if (error) return fail(error.message);
  refresh();
  return done("Recurrencia creada. Sus vencimientos se mostrarán como pendientes.");
}

/** Pausar detiene generación futura; los pendientes existentes permanecen. Finalizar es definitivo. */
export async function changeRecurringStatus(
  _previous: RecurringActionState,
  form: FormData,
): Promise<RecurringActionState> {
  const id = field(form, "rule_id");
  const target = field(form, "status");
  if (!UUID.test(id) || !["ACTIVE", "PAUSED", "ENDED"].includes(target)) {
    return fail("Solicitud inválida.");
  }
  const { supabase, user } = await context();
  if (!user) return fail("Tu sesión expiró.");
  const { data: current, error: readError } = await supabase
    .from("recurring_transactions").select("status")
    .eq("id", id).eq("user_id", user.id).maybeSingle();
  if (readError) return fail(readError.message);
  if (!current || current.status === "ENDED") return fail("La regla no está disponible.");
  if (current.status === target) return fail("La regla ya tiene ese estado.");

  const { data, error } = await supabase.from("recurring_transactions")
    .update({ status: target })
    .eq("id", id).eq("user_id", user.id).eq("status", current.status)
    .select("id").maybeSingle();
  if (error) return fail(error.message);
  if (!data) return fail("La regla cambió mientras la editabas. Actualizá la página.");
  refresh();
  return done(target === "PAUSED" ? "Recurrencia pausada. Los pendientes anteriores continúan disponibles."
    : target === "ENDED" ? "Recurrencia finalizada. Los pendientes antiguos podrán omitirse."
      : "Recurrencia reactivada.");
}

/** Contabilización únicamente al confirmar: ledger mediante el RPC existente. */
export async function confirmOccurrence(
  _previous: RecurringActionState,
  form: FormData,
): Promise<RecurringActionState> {
  const occurrenceId = field(form, "occurrence_id");
  if (!UUID.test(occurrenceId)) return fail("Vencimiento inválido.");
  const { supabase, user } = await context();
  if (!user) return fail("Tu sesión expiró.");
  const { data: occurrence, error: readError } = await supabase
    .from("recurring_occurrences")
    .select("id,recurring_id,status,scheduled_on")
    .eq("id", occurrenceId).eq("user_id", user.id).maybeSingle();
  if (readError) return fail(readError.message);
  if (!occurrence) return fail("No se encontró el vencimiento.");
  if (occurrence.status !== "PENDING") return fail("El vencimiento ya fue procesado.");
  if (occurrence.scheduled_on > todayInElSalvador()) {
    return fail("Este vencimiento todavía no llega. No adelantamos cargos futuros a los saldos actuales.");
  }

  const { data: rule, error: ruleError } = await supabase
    .from("recurring_transactions")
    .select("name,status")
    .eq("id", occurrence.recurring_id).eq("user_id", user.id).maybeSingle();
  if (ruleError) return fail(ruleError.message);
  if (!rule || rule.status === "ENDED") return fail("La recurrencia terminó. Omití el pendiente.");

  const { error } = await supabase.rpc("post_recurring_occurrence", {
    p_occurrence: occurrenceId,
    p_note: `Recurrente: ${rule.name}`,
    // Llave estable por vencimiento: reintentos no duplican operaciones.
    p_idempotency_key: `recurring-${occurrenceId}`,
  });
  if (error) return fail(error.message);
  refresh();
  return done("Pago confirmado y contabilizado. Se actualizó el saldo correspondiente.");
}

/** Omitir no crea movimientos, asientos ni cargos. */
export async function skipOccurrence(
  _previous: RecurringActionState,
  form: FormData,
): Promise<RecurringActionState> {
  const occurrenceId = field(form, "occurrence_id");
  if (!UUID.test(occurrenceId)) return fail("Vencimiento inválido.");
  const { supabase, user } = await context();
  if (!user) return fail("Tu sesión expiró.");
  const { error } = await supabase.rpc("skip_recurring_occurrence", {
    p_occurrence: occurrenceId,
  });
  if (error) return fail(error.message);
  refresh();
  return done("Vencimiento omitido sin modificar ningún saldo.");
}

/** Útil para forzar una actualización sin esperar a cambiar de ruta. */
export async function generateUpcoming(
  _previous: RecurringActionState,
  _form: FormData,
): Promise<RecurringActionState> {
  const { supabase, user } = await context();
  if (!user) return fail("Tu sesión expiró.");
  const today = todayInElSalvador();
  const date = new Date(`${today}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 45);
  const { data, error } = await supabase.rpc("generate_pending_occurrences", {
    p_through: date.toISOString().slice(0, 10),
  });
  if (error) return fail(error.message);
  refresh();
  return done(`Calendario actualizado. ${Number(data ?? 0)} vencimiento(s) nuevos.`);
}
