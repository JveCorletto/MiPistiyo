"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type AccountState = {
  error: string | null;
  success: string | null;
};

export async function createAccount(
  _previousState: AccountState,
  formData: FormData
): Promise<AccountState> {
  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return {
      error: "Tu sesión ha expirado. Inicia sesión nuevamente.",
      success: null,
    };
  }

  const name = String(formData.get("name") ?? "").trim();
  const kind = String(formData.get("kind") ?? "");
  const balanceText = String(
    formData.get("opening_balance") ?? ""
  ).trim();

  const description = String(
    formData.get("description") ?? ""
  ).trim();

  const allowOverdraft =
    formData.get("allow_overdraft") === "on";

  if (!name || name.length > 120) {
    return {
      error: "El nombre debe tener entre 1 y 120 caracteres.",
      success: null,
    };
  }

  if (!["CASH", "BANK", "WALLET"].includes(kind)) {
    return {
      error: "Selecciona un tipo de cuenta válido.",
      success: null,
    };
  }

  if (
    !/^\d{1,16}(\.\d{1,2})?$/.test(balanceText)
  ) {
    return {
      error: "Ingresa un saldo válido con máximo dos decimales.",
      success: null,
    };
  }

  if (description.length > 1000) {
    return {
      error: "La descripción es demasiado extensa.",
      success: null,
    };
  }

  const { error } = await supabase
    .from("accounts")
    .insert({
      user_id: user.id,
      name,
      kind,
      currency: "USD",
      opening_balance: balanceText,
      allow_overdraft: allowOverdraft,
      description: description || null,
    });

  if (error) {
    console.error("Error creando cuenta:", error.message);

    return {
      error: "No se pudo guardar la cuenta. Verifica sus datos.",
      success: null,
    };
  }

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/cuentas");

  return {
    error: null,
    success: "¡Cuenta creada correctamente!",
  };
}

export async function toggleAccount(
  formData: FormData
): Promise<void> {
  const id = String(formData.get("id") ?? "");
  const currentState =
    String(formData.get("is_active")) === "true";

  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)
  ) {
    throw new Error("Identificador de cuenta inválido.");
  }

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("Sesión no válida.");
  }

  const { error } = await supabase
    .from("accounts")
    .update({ is_active: !currentState })
    .eq("id", id)
    .eq("user_id", user.id)
    .eq("is_active", currentState)
    .select("id")
    .single();

  if (error) {
    throw new Error("No se pudo actualizar la cuenta.");
  }

  revalidatePath("/dashboard/cuentas");
}

export async function updateAccount(
  _previousState: AccountState,
  formData: FormData
): Promise<AccountState> {
  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return {
      error: "Debes iniciar sesión nuevamente.",
      success: null,
    };
  }

  const id = String(formData.get("id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const description = String(
    formData.get("description") ?? ""
  ).trim();

  if (!/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(id)) {
    return {
      error: "Identificador de cuenta inválido.",
      success: null,
    };
  }

  if (name.length < 1 || name.length > 120) {
    return {
      error: "El nombre debe tener entre 1 y 120 caracteres.",
      success: null,
    };
  }

  const { data, error } = await supabase
    .from("accounts")
    .update({
      name,
      description: description || null,
    })
    .eq("id", id)
    .eq("user_id", user.id)
    .select("id")
    .maybeSingle();

  if (error || !data) {
    return {
      error: "No se pudo actualizar la cuenta.",
      success: null,
    };
  }

  revalidatePath("/dashboard/cuentas");

  return {
    error: null,
    success: "Cuenta actualizada correctamente.",
  };
}