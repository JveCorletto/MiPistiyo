"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type MovementState = {
  error: string | null;
  success: string | null;
};

export async function createMovement(
  _previous: MovementState,
  formData: FormData
): Promise<MovementState> {
  const fail = (message: string): MovementState => ({
    error: message,
    success: null,
  });

  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return fail("Tu sesión ha expirado.");
  }

  const recordMode = String(
    formData.get("record_mode") ?? "CURRENT"
  );

  const kind = String(formData.get("kind") ?? "");
  const categoryId = String(formData.get("category_id") ?? "");
  const amount = String(formData.get("amount") ?? "").trim();
  const date = String(formData.get("date") ?? "");
  const sourceType = String(formData.get("source_type") ?? "");
  const sourceId = String(formData.get("source_id") ?? "");
  const note = String(formData.get("note") ?? "").trim();
  const key = String(formData.get("idempotency_key") ?? "");

  const uuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  if (!["CURRENT", "HISTORICAL"].includes(recordMode)) {
    return fail("Modo de registro inválido.");
  }

  if (!["INCOME", "EXPENSE"].includes(kind)) {
    return fail("Tipo de movimiento inválido.");
  }

  if (
    !uuid.test(categoryId) ||
    !uuid.test(sourceId) ||
    !uuid.test(key)
  ) {
    return fail("Selecciona los datos requeridos.");
  }

  if (
    !/^\d{1,16}(\.\d{1,2})?$/.test(amount) ||
    Number(amount) <= 0
  ) {
    return fail("Ingresa un monto válido.");
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return fail("Fecha inválida.");
  }

  const parsedDate = new Date(`${date}T00:00:00Z`);

  if (
    Number.isNaN(parsedDate.getTime()) ||
    parsedDate.toISOString().slice(0, 10) !== date
  ) {
    return fail("La fecha ingresada no existe.");
  }

  if (note.length > 1000) {
    return fail("La descripción es demasiado extensa.");
  }

  if (!["ACCOUNT", "CARD"].includes(sourceType)) {
    return fail("Selecciona una cuenta o tarjeta.");
  }

  if (kind === "INCOME" && sourceType !== "ACCOUNT") {
    return fail("Los ingresos deben depositarse en una cuenta.");
  }

  const parameters = {
    p_kind: kind,
    p_category_id: categoryId,
    p_amount: amount,
    p_account_id: sourceType === "ACCOUNT" ? sourceId : null,
    p_card_id: sourceType === "CARD" ? sourceId : null,
    p_effective_on: date,
    p_note: note || null,
    p_idempotency_key: key,
  };

  // Los movimientos históricos no afectan el libro mayor.
  // Los movimientos normales sí afectan los saldos.
  const { error } =
    recordMode === "HISTORICAL"
      ? await supabase.rpc(
          "post_historical_transaction",
          parameters
        )
      : await supabase.rpc(
          "post_transaction",
          parameters
        );

  if (error) {
    console.error("Error registrando movimiento:", error.message);

    return fail(error.message);
  }

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/cuentas");
  revalidatePath("/dashboard/tarjetas");
  revalidatePath("/dashboard/movimientos");
  revalidatePath("/dashboard/presupuestos");

  return {
    error: null,
    success:
      recordMode === "HISTORICAL"
        ? "Movimiento histórico registrado sin afectar el saldo."
        : "Movimiento registrado correctamente.",
  };
}