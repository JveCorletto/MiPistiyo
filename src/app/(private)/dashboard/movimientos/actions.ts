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
  const occurredTime = String(formData.get("occurred_time") ?? "").trim();
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

  if (occurredTime && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(occurredTime)) {
    return fail("La hora debe tener formato HH:MM.");
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
  const { data: savedMovementId, error } =
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

  // La RPC financiera devuelve el UUID registrado. La hora, si existe,
  // se guarda por la función de metadatos (migración 007), sin tocar el ledger.
  // Si falla, NO se revierte ni se repite automáticamente el movimiento: ya se guardó.
  let timeWarning = "";
  if (occurredTime) {
    if (!savedMovementId || typeof savedMovementId !== "string") {
      timeWarning = " La hora no pudo guardarse; agregala luego desde Editar detalles.";
    } else {
      const { error: timeError } = await supabase.rpc("update_movement_metadata", {
        p_id: savedMovementId,
        p_origin: recordMode === "HISTORICAL" ? "HISTORICAL" : "OPERATION",
        p_description: note || null,
        p_category_id: categoryId,
        p_occurred_time: occurredTime,
      });
      if (timeError) {
        console.error("Movimiento guardado, fallo al almacenar hora:", timeError.message);
        timeWarning = " La hora no pudo guardarse; agregala luego desde Editar detalles.";
      }
    }
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
        ? `Movimiento histórico registrado sin afectar el saldo.${timeWarning}`
        : `Movimiento registrado correctamente.${timeWarning}`,
  };
}
export type CancelMovementState = { error: string | null; success: string | null };

/** Solo se anulan movimientos propios mediante las RPC auditables del esquema. */
export async function cancelMovement(
  _previous: CancelMovementState,
  formData: FormData
): Promise<CancelMovementState> {
  const fail = (error: string): CancelMovementState => ({ error, success: null });
  const id = String(formData.get("id") ?? "");
  const origin = String(formData.get("origin") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  const key = String(formData.get("idempotency_key") ?? "");
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  if (!uuid.test(id) || !["OPERATION", "HISTORICAL"].includes(origin))
    return fail("Movimiento no válido.");
  if (reason.length < 5 || reason.length > 1000)
    return fail("Explicá el motivo de la anulación (entre 5 y 1000 caracteres).");
  if (origin === "OPERATION" && !uuid.test(key))
    return fail("Clave de confirmación inválida.");

  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return fail("Tu sesión ha expirado.");

  let error: { message: string } | null = null;
  if (origin === "HISTORICAL") {
    ({ error } = await supabase.rpc("void_historical_transaction", {
      p_historical: id,
      p_reason: reason,
    }));
  } else {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/El_Salvador", year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(new Date());
    const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
    const today = `${part("year")}-${part("month")}-${part("day")}`;
    ({ error } = await supabase.rpc("reverse_operation", {
      p_original: id,
      p_effective_on: today,
      p_reason: reason,
      p_idempotency_key: key,
    }));
  }
  if (error) return fail(error.message);

  for (const path of [
    "/dashboard", "/dashboard/movimientos", "/dashboard/cuentas",
    "/dashboard/tarjetas", "/dashboard/prestamos", "/dashboard/presupuestos",
    "/dashboard/transferencias", "/dashboard/recurrentes",
  ]) revalidatePath(path);

  return { error: null, success: "Movimiento anulado correctamente." };
}

export type EditMovementMetadataState = { error: string | null; success: string | null };

/** Solo edita descripción, categoría compatible y hora opcional; nunca ledger ni saldos. */
export async function saveMovementMetadata(
  _previous: EditMovementMetadataState,
  formData: FormData,
): Promise<EditMovementMetadataState> {
  const fail = (error: string): EditMovementMetadataState => ({ error, success: null });
  const id = String(formData.get("id") ?? "");
  const origin = String(formData.get("origin") ?? "");
  const description = String(formData.get("description") ?? "").trim();
  const category = String(formData.get("category_id") ?? "");
  const occurredTime = String(formData.get("occurred_time") ?? "").trim();
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  if (!uuid.test(id) || !["OPERATION", "HISTORICAL"].includes(origin))
    return fail("Movimiento inválido.");
  if (description.length > 1000) return fail("La descripción supera 1000 caracteres.");
  if (category && !uuid.test(category)) return fail("Categoría inválida.");
  if (occurredTime && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(occurredTime))
    return fail("Ingresá una hora válida en formato HH:MM.");

  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return fail("Tu sesión ha expirado.");

  const { error } = await supabase.rpc("update_movement_metadata", {
    p_id: id,
    p_origin: origin,
    p_description: description || null,
    p_category_id: category || null,
    p_occurred_time: occurredTime || null,
  });
  if (error) return fail(error.message);

  for (const path of [
    "/dashboard", "/dashboard/movimientos", "/dashboard/presupuestos",
    "/dashboard/transferencias", "/dashboard/cuentas", "/dashboard/tarjetas",
    "/dashboard/prestamos", "/dashboard/recurrentes",
  ]) revalidatePath(path);

  return { error: null, success: "Detalles actualizados sin alterar los saldos." };
}
