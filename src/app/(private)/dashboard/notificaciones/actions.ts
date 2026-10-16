"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

async function currentUser() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) throw new Error("Sesión no válida.");
  return { supabase, user };
}

export async function markNotificationRead(formData: FormData) {
  const id = String(formData.get("notification_id") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("Aviso inválido.");
  const { supabase, user } = await currentUser();
  const { error } = await supabase.from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", id).eq("user_id", user.id).is("read_at", null);
  if (error) throw new Error("No se pudo marcar el aviso como leído.");
  revalidatePath("/dashboard/notificaciones");
}

export async function markAllNotificationsRead() {
  const { supabase, user } = await currentUser();
  const { error } = await supabase.from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("user_id", user.id).is("read_at", null);
  if (error) throw new Error("No se pudieron actualizar los avisos.");
  revalidatePath("/dashboard/notificaciones");
}

export async function saveNotificationPreferences(formData: FormData) {
  const remindDays = Number(formData.get("remind_days"));
  if (!Number.isInteger(remindDays) || remindDays < 0 || remindDays > 14) {
    throw new Error("Anticipación inválida.");
  }
  const { supabase, user } = await currentUser();
  // Asegura la fila con valores por defecto sin conceder UPDATE(user_id).
  const setup = await supabase.rpc("refresh_due_notifications");
  if (setup.error) throw new Error("No se pudieron preparar las preferencias.");
  const { data, error } = await supabase.from("notification_preferences").update({
    remind_days: remindDays,
    recurring_enabled: formData.get("recurring_enabled") === "on",
    cards_enabled: formData.get("cards_enabled") === "on",
    loans_enabled: formData.get("loans_enabled") === "on",
    email_enabled: formData.get("email_enabled") === "on",
    updated_at: new Date().toISOString(),
  }).eq("user_id", user.id).select("user_id").maybeSingle();
  if (error || !data) throw new Error("No se pudo guardar la configuración.");
  const refresh = await supabase.rpc("refresh_due_notifications");
  if (refresh.error) throw new Error("Preferencias guardadas, pero no se pudieron actualizar los avisos.");
  revalidatePath("/dashboard/notificaciones");
}
