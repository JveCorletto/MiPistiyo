"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type CardState = {
  success: string | null;
  error: string | null;
};

export async function createCard(
  _previous: CardState,
  formData: FormData
): Promise<CardState> {
  const fail = (message: string): CardState => ({
    success: null,
    error: message,
  });

  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return fail("Debes iniciar sesión nuevamente.");
  }

  const kind = String(formData.get("kind") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const issuer = String(formData.get("issuer") ?? "").trim();
  const lastFour = String(formData.get("last_four") ?? "").trim();

  if (kind !== "CREDIT" && kind !== "DEBIT") {
    return fail("Tipo de tarjeta inválido.");
  }

  if (!name || name.length > 120) {
    return fail("El nombre debe tener entre 1 y 120 caracteres.");
  }

  if (issuer.length > 150) {
    return fail("El banco emisor es demasiado largo.");
  }

  if (lastFour && !/^\d{4}$/.test(lastFour)) {
    return fail("Los últimos dígitos deben ser exactamente cuatro números.");
  }

  const common = {
    user_id: user.id,
    kind,
    name,
    issuer: issuer || null,
    last_four: lastFour || null,
  };

  let payload;

  if (kind === "DEBIT") {
    const accountId = String(formData.get("account_id") ?? "");

    if (!/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(accountId)) {
      return fail("Selecciona una cuenta bancaria válida.");
    }

    // Las tarjetas de débito solamente se vinculan
    // a cuentas bancarias activas del mismo usuario.
    const { data: account, error } = await supabase
      .from("accounts")
      .select("id")
      .eq("id", accountId)
      .eq("user_id", user.id)
      .eq("kind", "BANK")
      .eq("is_active", true)
      .maybeSingle();

    if (error || !account) {
      return fail("La cuenta bancaria seleccionada no está disponible.");
    }

    payload = {
      ...common,
      account_id: account.id,
    };
  } else {
    const limit = String(formData.get("credit_limit") ?? "").trim();
    const openingDebt = String(formData.get("opening_debt") ?? "").trim();

    const moneyPattern = /^\d{1,16}(\.\d{1,2})?$/;

    if (
      !moneyPattern.test(limit) ||
      !moneyPattern.test(openingDebt)
    ) {
      return fail("Revisa los importes de crédito y deuda inicial.");
    }

    if (Number(limit) <= 0) {
      return fail("El límite de crédito debe ser mayor que cero.");
    }

    const cutoffDay = Number(formData.get("cutoff_day"));
    const dueDay = Number(formData.get("due_day"));
    const monthOffset = Number(formData.get("due_month_offset"));

    if (
      !Number.isInteger(cutoffDay) ||
      cutoffDay < 1 ||
      cutoffDay > 31 ||
      !Number.isInteger(dueDay) ||
      dueDay < 1 ||
      dueDay > 31 ||
      !Number.isInteger(monthOffset) ||
      monthOffset < 0 ||
      monthOffset > 2
    ) {
      return fail("Las fechas de corte y pago no son válidas.");
    }

    payload = {
      ...common,
      credit_limit: limit,
      opening_debt: openingDebt,
      cutoff_day: cutoffDay,
      due_day: dueDay,
      due_month_offset: monthOffset,
      enforce_credit_limit:
        formData.get("enforce_credit_limit") === "on",
    };
  }

  const { error } = await supabase.from("cards").insert(payload);

  if (error) {
    console.error("MiPistiyo cards:", error.message);
    return fail("No se pudo registrar la tarjeta: " + error.message);
  }

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/tarjetas");

  return {
    success: "Tarjeta registrada correctamente.",
    error: null,
  };
}

export async function updateCard(
  _previous: CardState,
  formData: FormData
): Promise<CardState> {
  const fail = (message: string): CardState => ({
    success: null,
    error: message,
  });

  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return fail("Tu sesión ha expirado.");
  }

  const id = String(formData.get("id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const issuer = String(formData.get("issuer") ?? "").trim();
  const lastFour = String(formData.get("last_four") ?? "").trim();

  if (!/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(id)) {
    return fail("Identificador inválido.");
  }

  if (!name || name.length > 120) {
    return fail("Nombre inválido.");
  }

  if (issuer.length > 150) {
    return fail("El banco emisor es demasiado largo.");
  }

  if (lastFour && !/^\d{4}$/.test(lastFour)) {
    return fail("Los últimos dígitos deben ser cuatro números.");
  }

  const { data: existing, error: lookupError } =
    await supabase
      .from("cards")
      .select("id, kind")
      .eq("id", id)
      .eq("user_id", user.id)
      .single();

  if (lookupError || !existing) {
    return fail("No se encontró la tarjeta.");
  }

  const changes: Record<string, string | number | boolean | null> = {
    name,
    issuer: issuer || null,
    last_four: lastFour || null,
  };

  if (existing.kind === "CREDIT") {
    const limit = String(formData.get("credit_limit") ?? "").trim();
    const cutoffDay = Number(formData.get("cutoff_day"));
    const dueDay = Number(formData.get("due_day"));
    const monthOffset = Number(formData.get("due_month_offset"));

    if (
      !/^\d{1,16}(\.\d{1,2})?$/.test(limit) ||
      Number(limit) <= 0
    ) {
      return fail("El límite de crédito no es válido.");
    }

    if (
      !Number.isInteger(cutoffDay) ||
      cutoffDay < 1 ||
      cutoffDay > 31 ||
      !Number.isInteger(dueDay) ||
      dueDay < 1 ||
      dueDay > 31 ||
      !Number.isInteger(monthOffset) ||
      monthOffset < 0 ||
      monthOffset > 2
    ) {
      return fail("Revisa las fechas de corte y pago.");
    }

    changes.credit_limit = limit;
    changes.cutoff_day = cutoffDay;
    changes.due_day = dueDay;
    changes.due_month_offset = monthOffset;
    changes.enforce_credit_limit =
      formData.get("enforce_credit_limit") === "on";
  }

  const { data, error } = await supabase
    .from("cards")
    .update(changes)
    .eq("id", id)
    .eq("user_id", user.id)
    .select("id")
    .single();

  if (error || !data) {
    return fail(error?.message ?? "No se pudo actualizar la tarjeta.");
  }

  revalidatePath("/dashboard/tarjetas");
  revalidatePath("/dashboard");

  return {
    success: "Tarjeta actualizada correctamente.",
    error: null,
  };
}

export async function toggleCard(
  _previous: CardState,
  formData: FormData
): Promise<CardState> {
  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { success: null, error: "Sesión no válida." };
  }

  const id = String(formData.get("id") ?? "");
  const currentState =
    String(formData.get("is_active")) === "true";

  if (!/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(id)) {
    return { success: null, error: "Tarjeta inválida." };
  }

  const { data, error } = await supabase
    .from("cards")
    .update({ is_active: !currentState })
    .eq("id", id)
    .eq("user_id", user.id)
    .eq("is_active", currentState)
    .select("id")
    .single();

  if (error || !data) {
    return {
      success: null,
      error: error?.message ?? "No se pudo cambiar el estado.",
    };
  }

  revalidatePath("/dashboard/tarjetas");

  return {
    success: currentState
      ? "Tarjeta desactivada correctamente."
      : "Tarjeta activada correctamente.",
    error: null,
  };
}